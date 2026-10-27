import http, { type IncomingMessage } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { AuthError, AuthService } from '../electron/services/authService';
import { LocalSQLiteManager } from '../electron/db/sqliteService';
import { RuntimeLogger } from '../electron/services/runtimeLogger';
import path from 'node:path';
import fs from 'node:fs';

interface ServerOptions {
  dataDirectory: string;
  adminPassword?: string;
  adminName?: string;
  sessionTtlMs?: number;
  loginLimit?: number;
  sourceLoginLimit?: number;
  trustLoopbackProxy?: boolean;
}

function readBody(request: IncomingMessage, limit = 16384): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { chunks.length = 0; reject(new AuthError('INVALID_REQUEST', '请求过大')); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > limit) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch { reject(new AuthError('INVALID_REQUEST', '请求格式无效')); }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new AuthError('INVALID_REQUEST', '请求已中断')));
  });
}

export async function createAuthServer(options: ServerOptions) {
  fs.mkdirSync(options.dataDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(options.dataDirectory, 0o700);
  const logger = new RuntimeLogger(path.join(options.dataDirectory, 'logs'));
  const db = new LocalSQLiteManager(options.dataDirectory, (error) => logger.write('warn', 'database.engine-fallback', { error }), false);
  try {
    await db.ensureInitialized();
    if (!db.listUsers().length && !options.adminPassword) throw new Error('首次启动须通过密码文件设置管理员密码');
    const auth = new AuthService(db);
    if (!db.listUsers().length) {
      await auth.setup(0, options.adminPassword!, options.adminName || '管理员');
      auth.logout(0);
      logger.write('info', 'auth.admin-initialized');
    }
    type Session = { id: number; userId: string; expiresAt: number };
    const sessions = new Map<string, Session>();
    const failures = new Map<string, { count: number; expiresAt: number }>();
    const sources = new Map<string, { count: number; expiresAt: number }>();
    const hash = (token: string) => createHash('sha256').update(token).digest('hex');
    let nextId = 1;
    let stopping = false;
    const removeSession = (key: string) => {
      const session = sessions.get(key);
      if (!session) return;
      sessions.delete(key);
      auth.logout(session.id);
    };
    const revokeUser = (userId: string) => {
      for (const [key, session] of sessions) if (session.userId === userId) removeSession(key);
    };
    const cleanup = () => {
      const now = Date.now();
      for (const [key, session] of sessions) if (session.expiresAt <= now) removeSession(key);
      for (const entries of [failures, sources]) for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
    };
    const timer = setInterval(cleanup, 1000);
    timer.unref();
    const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const route = req.method + ' ' + req.url;
      let actorId: string | undefined;
      let targetId: string | undefined;
      let sessionKey: string | undefined;
      const send = (status: number, body: unknown) => {
        if (res.destroyed || res.writableEnded) return;
        if (res.headersSent) { res.end(JSON.stringify(body) + '\n'); return; }
        res.writeHead(status); res.end(JSON.stringify(body));
      };
      try {
        cleanup();
        if (stopping) throw new AuthError('SERVICE_BUSY', '服务正在重启');
        if (route === 'GET /health') { send(200, { success: true }); return; }
        if (route === 'POST /v1/login') {
          let address = req.socket.remoteAddress || 'unknown';
          const realIp = req.headers['x-real-ip'];
          if (options.trustLoopbackProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) &&
              typeof realIp === 'string' && isIP(realIp)) address = realIp;
          const source = sources.get(address);
          if ((!source && sources.size >= 10000) || (source && source.count >= (options.sourceLoginLimit ?? 60))) {
            throw new AuthError('RATE_LIMITED', '登录尝试过于频繁');
          }
          sources.set(address, { count: (source?.count || 0) + 1, expiresAt: source?.expiresAt || Date.now() + 15 * 60000 });
          const input = await readBody(req);
          const key = JSON.stringify([address, typeof input.username === 'string' ? input.username.trim().slice(0, 128) : '']);
          const failure = failures.get(key);
          if ((!failure && failures.size >= 10000) || (failure && failure.count >= (options.loginLimit ?? 10))) {
            throw new AuthError('RATE_LIMITED', '登录尝试过于频繁');
          }
          if (sessions.size >= 10000) throw new AuthError('SERVICE_BUSY', '服务繁忙');
          failures.set(key, { count: (failure?.count || 0) + 1, expiresAt: failure?.expiresAt || Date.now() + 15 * 60000 });
          const id = nextId++;
          const user = await auth.login(id, input.username, input.password);
          if (stopping || res.destroyed || sessions.size >= 10000) { auth.logout(id); throw new AuthError('SERVICE_BUSY', '请重新登录'); }
          failures.delete(key);
          const token = randomBytes(32).toString('hex');
          sessions.set(hash(token), { id, userId: user.id, expiresAt: Date.now() + (options.sessionTtlMs ?? 12 * 60 * 60000) });
          logger.write('info', 'auth.login', { actorId: user.id, outcome: 'success' });
          send(200, { success: true, token, user });
          return;
        }
        const knownRoutes = ['GET /v1/me', 'POST /v1/logout', 'GET /v1/users', 'POST /v1/users/create',
          'POST /v1/users/status', 'POST /v1/users/password', 'POST /v1/users/delete'];
        if (!knownRoutes.includes(route)) { send(404, { success: false, errorCode: 'NOT_FOUND' }); return; }
        const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        sessionKey = token ? hash(token) : undefined;
        const session = sessionKey ? sessions.get(sessionKey) : undefined;
        if (!session) throw new AuthError('AUTH_REQUIRED', '请重新登录');
        const adminOnly = req.url?.startsWith('/v1/users');
        const ensureSession = async () => {
          if (sessions.get(sessionKey!) !== session || session.expiresAt <= Date.now()) throw new AuthError('AUTH_REQUIRED', '请重新登录');
          return auth.requireUser(session.id, adminOnly);
        };
        const actor = await ensureSession();
        actorId = actor.id;
        if (route === 'GET /v1/me') { send(200, { success: true, user: actor }); return; }
        if (route === 'POST /v1/logout') {
          removeSession(sessionKey!);
          send(200, { success: true });
        } else if (route === 'GET /v1/users') {
          send(200, { success: true, users: await auth.listUsers(session.id) });
        } else {
          const input = await readBody(req);
          await ensureSession();
          targetId = typeof input.userId === 'string' && /^[a-f0-9-]{36}$/.test(input.userId) ? input.userId : undefined;
          if (route === 'POST /v1/users/create') {
            const user = await auth.createUser(session.id, input as Parameters<AuthService['createUser']>[1]);
            targetId = user.id; send(200, { success: true, user });
          } else if (route === 'POST /v1/users/status') {
            await auth.setActive(session.id, input.userId, input.active);
            if (!input.active) revokeUser(input.userId);
            send(200, { success: true });
          } else if (route === 'POST /v1/users/delete') {
            await auth.deleteUser(session.id, input.userId);
            revokeUser(input.userId); send(200, { success: true });
          } else {
            await auth.resetPassword(session.id, input.userId, input.password);
            revokeUser(input.userId); send(200, { success: true });
          }
        }
        logger.write('info', 'auth.operation', { channel: route, actorId, targetId, outcome: 'success' });
      } catch (error) {
        const code = error instanceof AuthError ? error.code : 'INTERNAL_ERROR';
        if (sessionKey && ['AUTH_REQUIRED', 'ACCOUNT_DISABLED'].includes(code)) removeSession(sessionKey);
        logger.write('warn', 'auth.failed', { actorId, targetId, channel: route, errorCode: code, error });
        const status = code === 'RATE_LIMITED' ? 429 : code === 'INTERNAL_ERROR' || code === 'SERVICE_BUSY' ? 503 :
          ['AUTH_REQUIRED', 'INVALID_CREDENTIALS', 'ACCOUNT_DISABLED'].includes(code) ? 401 : code === 'FORBIDDEN' ? 403 : 400;
        send(status, { success: false, type: 'error', errorCode: code });
      }
    });
    // 关闭服务时撤销全部会话。
    const close = server.close.bind(server);
    server.close = ((callback?: (error?: Error) => void) => {
      stopping = true;
      for (const key of sessions.keys()) removeSession(key);
      return close(callback);
    }) as typeof server.close;
    server.on('close', () => { clearInterval(timer); db.close(); logger.write('info', 'auth.stopping'); });
    logger.write('info', 'auth.ready');
    return server;
  } catch (error) { db.close(); throw error; }
}
