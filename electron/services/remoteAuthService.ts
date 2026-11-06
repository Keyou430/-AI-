import { setTimeout as delay } from 'node:timers/promises';
import { AccountDisabledError, AuthError, type AuthLifecycle } from './authError';
import type { AuthService, AuthUser } from './authService';
import type { RuntimeLogger } from './runtimeLogger';

export function validateAuthUrl(value: string, allowLoopback = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AuthError('AUTH_CONFIG_INVALID', '授权服务地址未正确配置'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new AuthError('AUTH_CONFIG_INVALID', '授权服务必须使用 HTTPS 根地址');
  }
  return url.origin;
}

const authMessages: Record<string, string> = {
  INVALID_CONFIG: '服务配置无效，请检查 HTTPS 地址及模型名称', PROVIDER_NOT_CONFIGURED: '请联系管理员配置公司接口密钥',
  SERVICE_BUSY: '服务繁忙，请稍后再试', INTERNAL_ERROR: '服务器调用失败，请联系管理员检查配置',
  INVALID_CREDENTIALS: '账号或密码错误', ACCOUNT_DISABLED: '当前账号已被管理员停用',
  AUTH_REQUIRED: '登录已失效，请重新登录', FORBIDDEN: '仅管理员可执行此操作',
  INVALID_PASSWORD: '密码长度须为 8 至 128 位', USERNAME_EXISTS: '账号已存在',
  INVALID_USER: '账号或姓名格式无效', INVALID_ROLE: '角色无效',
  INVALID_STATUS: '账号状态无效', USER_NOT_FOUND: '账号不存在',
  PROTECTED_ACCOUNT: '不能停用或删除内置管理员及当前登录账号', RATE_LIMITED: '登录尝试过于频繁，请稍后再试',
};

// 员工版只使用服务端账号；凭据和令牌均不写入本地数据库。
export class RemoteAuthService implements Pick<AuthService,
  'status' | 'setup' | 'login' | 'requireUser' | 'listUsers' | 'createUser' | 'setActive' | 'resetPassword' | 'deleteUser'> {
  private readonly sessions = new Map<number, { token: string; user: AuthUser; generation: number; controller: AbortController; verifiedAt: number; verification?: Promise<AuthUser> }>();
  private readonly generations = new Map<number, number>();
  private readonly baseUrl: string;
  constructor(url: string, private readonly timeoutMs = 5000, allowLoopback = false,
    private readonly logger?: Pick<RuntimeLogger, 'write'>, private readonly lifecycle?: AuthLifecycle) {
    this.baseUrl = validateAuthUrl(url, allowLoopback);
  }

  private async request(route: string, input?: unknown, token?: string, kind: 'initial' | 'retry' = 'initial', signal?: AbortSignal): Promise<any> {
    const startedAt = Date.now();
    try {
      const response = await fetch(this.baseUrl + '/v1/' + route, {
        method: input === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: input === undefined ? undefined : JSON.stringify(input), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
      });
      if (route === 'users/delete' && response.status === 404) {
        throw new AuthError('SERVICE_UPDATE_REQUIRED', '授权服务尚未支持删除账号，请联系管理员更新服务后重试');
      }
      const data = await response.json();
      if (!response.ok || !data.success) {
        const code = typeof data.errorCode === 'string' && authMessages[data.errorCode] ? data.errorCode : 'AUTH_UNAVAILABLE';
        if (code === 'ACCOUNT_DISABLED' && typeof data.disabledUser?.id === 'string' &&
            ['admin', 'member'].includes(data.disabledUser.role) && Number.isSafeInteger(data.disabledUser.apiResetVersion) && data.disabledUser.apiResetVersion >= 0) {
          throw new AccountDisabledError({ id: data.disabledUser.id, role: data.disabledUser.role, apiResetVersion: data.disabledUser.apiResetVersion });
        }
        throw new AuthError(code, authMessages[code] || '授权服务暂时不可用，请稍后重试', { cause: { status: response.status } });
      }
      this.logger?.write('info', 'auth.request-completed', {
        channel: 'auth:' + route, durationMs: Date.now() - startedAt, kind, outcome: 'success',
      });
      return data;
    } catch (error) {
      const failure = error instanceof AuthError ? error : new AuthError('AUTH_UNAVAILABLE',
        error instanceof Error && error.name === 'TimeoutError'
          ? '授权服务响应超时，请稍后重试' : '暂时无法连接授权服务，请检查网络后重试', { cause: error });
      this.logger?.write('warn', 'auth.request-failed', {
        channel: 'auth:' + route, durationMs: Date.now() - startedAt, kind, outcome: 'failed',
        errorCode: failure.code, error: failure,
      });
      throw failure;
    }
  }

  hasSession(senderId: number): boolean { return this.sessions.has(senderId); }

  watchSession(senderId: number, onInvalidated: (error: unknown) => void, intervalMs = 30000,
    onCheckFailed?: (error: unknown) => void) {
    let checking = false;
    let stopped = false;
    const check = async () => {
      if (stopped || checking || !this.hasSession(senderId)) return;
      checking = true;
      try { await this.requireUser(senderId); }
      catch (error) {
        if (!stopped) {
          onCheckFailed?.(error);
          if (!this.hasSession(senderId)) onInvalidated(error);
        }
      }
      finally { checking = false; }
    };
    const timer = setInterval(() => { void check(); }, intervalMs);
    timer.unref();
    return { check, stop: () => { stopped = true; clearInterval(timer); } };
  }

  async status(senderId: number) {
    return { needsSetup: false, user: this.sessions.has(senderId) ? await this.requireUser(senderId) : null };
  }
  async setup(_senderId: number, _password: string, _displayName: string): Promise<AuthUser> {
    throw new AuthError('FORBIDDEN', '员工版账号由管理员统一创建');
  }
  async login(senderId: number, username: string, password: string): Promise<AuthUser> {
    const logout = this.logout(senderId);
    const generation = this.generations.get(senderId) || 0;
    await logout;
    if (this.generations.get(senderId) !== generation) throw new AuthError('AUTH_REQUIRED', '登录已取消，请重新登录');
    let result;
    try { result = await this.request('login', { username, password }); }
    catch (error) {
      if (this.generations.get(senderId) !== generation) throw new AuthError('AUTH_REQUIRED', '登录已取消，请重新登录');
      if (error instanceof AccountDisabledError) this.lifecycle?.disabled(error.user, this.baseUrl);
      throw error;
    }
    if (this.generations.get(senderId) !== generation) {
      void this.request('logout', {}, result.token).catch(() => {});
      throw new AuthError('AUTH_REQUIRED', '登录已取消，请重新登录');
    }
    if (typeof result.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.token) || !result.user?.id ||
        result.user.isActive !== true || !['admin', 'member'].includes(result.user.role)) {
      throw new AuthError('AUTH_UNAVAILABLE', '授权服务返回无效登录信息');
    }
    try { this.lifecycle?.signedIn(result.user, this.baseUrl); }
    catch (error) { void this.request('logout', {}, result.token).catch(() => {}); throw error; }
    this.sessions.set(senderId, { token: result.token, user: result.user, generation, controller: new AbortController(), verifiedAt: performance.now() });
    return result.user;
  }
  async logout(senderId: number, reason?: AuthError): Promise<void> {
    const session = this.sessions.get(senderId);
    session?.controller.abort(reason);
    this.sessions.delete(senderId);
    this.generations.set(senderId, (this.generations.get(senderId) || 0) + 1);
    if (session) await Promise.allSettled([this.request('logout', {}, session.token), session.verification]);
  }
  private async authorized(senderId: number, route: string, input?: unknown): Promise<any> {
    const session = this.sessions.get(senderId);
    if (!session) throw new AuthError('AUTH_REQUIRED', '请先登录');
    try {
      let result;
      try { result = await this.request(route, input, session.token, 'initial', session.controller.signal); }
      catch (error) {
        if (route !== 'me' || !(error instanceof AuthError) || error.code !== 'AUTH_UNAVAILABLE' ||
            this.sessions.get(senderId) !== session) throw error;
        this.logger?.write('warn', 'auth.verification-retry', {
          senderId, channel: 'auth:' + route, errorCode: error.code, kind: 'retry',
        });
        await delay(250, undefined, { signal: session.controller.signal });
        if (this.sessions.get(senderId) !== session) throw new AuthError('AUTH_REQUIRED', '登录已失效，请重新登录');
        result = await this.request(route, input, session.token, 'retry', session.controller.signal);
      }
      if (this.sessions.get(senderId) !== session) throw new AuthError('AUTH_REQUIRED', '登录已失效，请重新登录');
      return result;
    } catch (error) {
      if (this.sessions.get(senderId) !== session) {
        const reason = session.controller.signal.reason;
        throw reason instanceof AuthError ? reason : new AuthError('AUTH_REQUIRED', '登录已失效，请重新登录');
      }
      this.logger?.write('warn', 'auth.verification-failed', {
        senderId, channel: 'auth:' + route, error,
        errorCode: error instanceof AuthError ? error.code : 'AUTH_UNAVAILABLE',
      });
      if (error instanceof AuthError && ['AUTH_REQUIRED', 'ACCOUNT_DISABLED'].includes(error.code) &&
          this.sessions.get(senderId) === session) {
        let failure = error;
        try {
          if (error.code === 'ACCOUNT_DISABLED') {
            const user = error instanceof AccountDisabledError ? error.user : session.user;
            if (user.id === session.user.id && user.role === session.user.role) this.lifecycle?.disabled(user, this.baseUrl);
          }
        } catch (cleanupError) {
          failure = cleanupError instanceof AuthError ? cleanupError : new AuthError('API_RESET_FAILED', '管理员已停用账号，但本地 API 配置清理失败，请重试登录。', { cause: cleanupError });
        } finally { void this.logout(senderId, failure); }
        throw failure;
      }
      throw error;
    }
  }
  async requireUser(senderId: number, adminOnly = false): Promise<AuthUser> {
    const session = this.sessions.get(senderId);
    if (!session) throw new AuthError('AUTH_REQUIRED', '请先登录');
    // 只合并在途查询；完成后下一次操作仍须向服务端实时校验。
    const verification = session.verification ??= (async () => {
      const { user } = await this.authorized(senderId, 'me');
      if (!user?.id || user.isActive !== true || !['admin', 'member'].includes(user.role)) {
        const error = new AuthError('AUTH_REQUIRED', '登录已失效，请重新登录');
        void this.logout(senderId, error); throw error;
      }
      session.verifiedAt = performance.now();
      return user as AuthUser;
    })();
    let user: AuthUser;
    try { user = await verification; }
    finally { if (session.verification === verification) session.verification = undefined; }
    if (this.sessions.get(senderId) !== session) throw new AuthError('AUTH_REQUIRED', '登录已失效，请重新登录');
    if (adminOnly && user.role !== 'admin') throw new AuthError('FORBIDDEN', '仅管理员可执行此操作');
    return user;
  }
  async listUsers(senderId: number): Promise<AuthUser[]> { return (await this.authorized(senderId, 'users')).users; }
  async createUser(senderId: number, input: { username: string; password: string; displayName: string; role: 'admin' | 'member' }): Promise<AuthUser> {
    return (await this.authorized(senderId, 'users/create', input)).user;
  }
  async setActive(senderId: number, userId: string, active: boolean): Promise<void> {
    await this.authorized(senderId, 'users/status', { userId, active });
  }
  async runAuthorizedTask<T>(senderId: number, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal,
    intervalMs = 15000, graceMs = 60000): Promise<T> {
    const session = this.sessions.get(senderId);
    if (!session) throw new AuthError('AUTH_REQUIRED', '请先登录');
    const verification = new AbortController();
    const combined = AbortSignal.any([session.controller.signal, verification.signal, AbortSignal.timeout(180000), ...(signal ? [signal] : [])]);
    const remaining = () => session.verifiedAt + graceMs - performance.now();
    const temporary = (error: unknown) => error instanceof AuthError && error.code === 'AUTH_UNAVAILABLE';
    const verify = async () => {
      combined.throwIfAborted();
      let onAbort!: () => void;
      const canceled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(combined.reason);
        combined.addEventListener('abort', onAbort, { once: true });
      });
      try { return await Promise.race([this.requireUser(senderId), canceled]); }
      finally { combined.removeEventListener('abort', onAbort); }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watch: ReturnType<RemoteAuthService['watchSession']> | undefined;
    let recovering = false;
    const defer = (error: unknown) => {
      if (!temporary(error) || remaining() <= 0) { verification.abort(error); return; }
      if (!recovering) {
        recovering = true;
        this.logger?.write('warn', 'auth.grace-started', { senderId, errorCode: 'AUTH_UNAVAILABLE' });
      }
      if (!timer) enforceDeadline();
    };
    const enforceDeadline = () => {
      clearTimeout(timer); timer = undefined;
      if (combined.aborted) return;
      const left = remaining();
      if (left <= 0) {
        this.logger?.write('warn', 'auth.grace-expired', { senderId, errorCode: 'AUTH_UNAVAILABLE' });
        verification.abort(new AuthError('AUTH_UNAVAILABLE', '授权连接未在宽限期内恢复，已停止处理；草稿和已保存图片已保留，请恢复网络后继续。'));
      } else { timer = setTimeout(enforceDeadline, Math.ceil(left)); timer.unref(); }
    };
    try {
      // 等待期间只查询身份，实时校验成功前不调用业务或供应商接口。
      for (;;) {
        try { await verify(); break; }
        catch (error) {
          combined.throwIfAborted();
          if (!temporary(error) || remaining() <= 0) throw error;
          defer(error);
          await delay(Math.min(intervalMs, Math.ceil(remaining())), undefined, { signal: combined });
          if (remaining() <= 0) throw error;
        }
      }
      combined.throwIfAborted();
      enforceDeadline();
      watch = this.watchSession(senderId, () => {}, intervalMs, defer);
      const result = await task(combined);
      combined.throwIfAborted();
      try { await verify(); }
      catch (error) {
        combined.throwIfAborted();
        if (!temporary(error) || remaining() <= 0) throw error;
        // 业务已经完成，宽限内返回成功结果；下一任务仍必须实时校验。
        defer(error);
        this.logger?.write('warn', 'auth.result-preserved', { senderId, errorCode: 'AUTH_UNAVAILABLE' });
      }
      combined.throwIfAborted();
      return result;
    } catch (error) {
      const reason = session.controller.signal.reason ?? verification.signal.reason;
      if (reason instanceof AuthError) throw reason;
      if (session.controller.signal.aborted || this.sessions.get(senderId) !== session) {
        throw new AuthError('AUTH_REQUIRED', '登录已失效，任务已取消');
      }
      throw error;
    } finally { watch?.stop(); clearTimeout(timer); }
  }
  async deleteUser(senderId: number, userId: string): Promise<void> {
    await this.authorized(senderId, 'users/delete', { userId });
  }
  async resetPassword(senderId: number, userId: string, password: string): Promise<void> {
    await this.authorized(senderId, 'users/password', { userId, password });
  }
}
