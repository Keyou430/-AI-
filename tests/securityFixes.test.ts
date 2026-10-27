import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createAuthServer } from '../server/authServer';
import { RemoteAuthService } from '../electron/services/remoteAuthService';
import { createDesktopAuth as createEmployeeAuth } from '../electron/services/employeeAuth';
import { LocalSQLiteManager } from '../electron/db/sqliteService';
import { AuthService } from '../electron/services/authService';
import { streamGenerateScript } from '../electron/services/llmService';

const password = 'Security-fixture-12345';
const generation = { requestId: 'regression', config: { apiKey: 'client-key', baseURL: 'https://attacker.invalid', model: 'client-model' },
  systemPrompt: 'system', userPrompt: 'user', targetDurationSec: 18, userCameraWork: '近景' };
async function streamingProvider() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const timer = setInterval(() => response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '接口片段' } }] }) + '\n\n'), 20);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { config: { apiKey: 'fixture-key', baseURL: 'http://127.0.0.1:' + (server.address() as { port: number }).port, model: 'fixture-model' },
    dispose: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }) };
}

async function fixture(options: Partial<Parameters<typeof createAuthServer>[0]> = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-security-fix-'));
  const upstream = await streamingProvider();
  const server = await createAuthServer({ dataDirectory: directory, adminPassword: password, ...options });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const request = async (route: string, input?: unknown, token?: string, address?: string) => fetch(url + '/v1/' + route, {
    method: input === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(address ? { 'X-Real-IP': address } : {}) },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const client = new RemoteAuthService(url, 2000, true);
  await client.login(1, 'admin', password);
  const user = await client.createUser(1, { username: 'employee', password, displayName: '测试员工', role: 'member' });
  const member = new RemoteAuthService(url, 2000, true);
  await member.login(2, 'employee', password);
  const dispose = async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); await fs.rm(directory, { recursive: true, force: true }); };
  return { directory, server, url, request, client, member, user, generation: { ...generation, config: upstream.config },
    dispose: async () => { await upstream.dispose(); await dispose(); } };
}

test('员工入口忽略可篡改的本机模式标记，禁止本机初始化', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-fixed-entry-'));
  const db = new LocalSQLiteManager(directory);
  try {
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ authMode: 'local' }));
    await fs.writeFile(path.join(directory, 'auth-config.json'), JSON.stringify({ url: 'https://auth.example.com' }));
    const employee = createEmployeeAuth(db, directory, directory);
    assert.ok(employee instanceof RemoteAuthService);
    await assert.rejects(employee.setup(1, password, '本机管理员'), { code: 'FORBIDDEN' });
    await fs.writeFile(path.join(directory, 'auth-config.json'), '{}');
    assert.throws(() => createEmployeeAuth(db, directory, directory), { code: 'AUTH_CONFIG_INVALID' });
  } finally { db.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('可信代理区分来源，大小写账号不共用失败计数，轮换用户名仍受来源预算限制', async () => {
  const f = await fixture({ trustLoopbackProxy: true, loginLimit: 2, sourceLoginLimit: 5 });
  try {
    const login = (username: string, pass: string, ip: string) => f.request('login', { username, password: pass }, undefined, ip);
    for (let i = 0; i < 2; i++) assert.equal((await login('ADMIN', 'wrong', '192.0.2.1')).status, 401);
    assert.equal((await login('ADMIN', 'wrong', '192.0.2.1')).status, 429);
    assert.equal((await login('admin', password, '192.0.2.1')).status, 200);
    assert.equal((await login('ADMIN', password, '192.0.2.2')).status, 401);
    assert.equal((await login('admin', password, '192.0.2.2')).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await login('unknown' + i, 'wrong', '192.0.2.3')).status, 401);
    assert.equal((await login('another', 'wrong', '192.0.2.3')).status, 429);
  } finally { await f.dispose(); }
});

test('未信任代理时伪造来源地址不能重置限流预算', async () => {
  const f = await fixture({ sourceLoginLimit: 5 });
  try {
    // fixture 的管理员和员工各登录一次。
    for (let i = 0; i < 3; i++) assert.equal((await f.request('login', { username: 'random' + i, password: 'wrong' }, undefined, '192.0.2.' + i)).status, 401);
    assert.equal((await f.request('login', { username: 'different', password: 'wrong' }, undefined, '192.0.2.99')).status, 429);
  } finally { await f.dispose(); }
});

test('授权服务器拒绝密钥配置和业务代理端点，不创建供应商配置文件', async () => {
  const f = await fixture();
  try {
    const login = await f.request('login', { username: 'admin', password });
    const { token } = await login.json();
    for (const route of ['providers', 'business/generate', 'business/parse', 'business/test']) {
      assert.equal((await f.request(route, {}, token)).status, 404);
    }
    assert.equal((await f.request('providers', undefined, token)).status, 404);
    assert.equal((await fs.readdir(f.directory)).some(name => name.includes('provider')), false);
  } finally { await f.dispose(); }
});

for (const action of ['disable', 'password', 'logout', 'expiry'] as const) {
  test('本机在途任务在 ' + action + ' 后取消，上游不再输出', async () => {
    const f = await fixture(action === 'expiry' ? { sessionTtlMs: 800 } : {});
    try {
      let arrived!: () => void; const first = new Promise<void>(resolve => { arrived = resolve; });
      let chunks = 0;
      const running = f.member.runAuthorizedTask(2, signal => streamGenerateScript(f.generation, () => { chunks++; arrived(); }, signal), undefined, 20);
      const rejected = assert.rejects(running, { code: 'AUTH_REQUIRED' });
      await first;
      if (action === 'disable') await f.client.setActive(1, f.user.id, false);
      if (action === 'password') await f.client.resetPassword(1, f.user.id, password + '-new');
      if (action === 'logout') await f.member.logout(2);
      await rejected; const stopped = chunks;
      await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(chunks, stopped);
      assert.equal(f.member.hasSession(2), false);
    } finally { await f.dispose(); }
  });
}

test('客户端退出后旧任务不把结果交给新会话', async () => {
  const f = await fixture();
  try {
    let arrived!: () => void; const first = new Promise<void>(resolve => { arrived = resolve; });
    let chunks = 0;
    const running = f.member.runAuthorizedTask(2, signal => streamGenerateScript(f.generation, () => { chunks++; arrived(); }, signal));
    const rejected = assert.rejects(running, { code: 'AUTH_REQUIRED' });
    await first; await f.member.logout(2); const stopped = chunks; await rejected;
    await f.member.login(2, 'employee', password);
    await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(chunks, stopped);
  } finally { await f.dispose(); }
});

test('取消信号中断真实 SSE 请求，不产生后续片段', async () => {
  const upstream = await streamingProvider();
  try {
    const controller = new AbortController(); let chunks = 0;
    await assert.rejects(streamGenerateScript({ ...generation, config: upstream.config }, () => { chunks++; controller.abort(); }, controller.signal), { name: 'AbortError' });
    assert.equal(chunks, 1);
  } finally { await upstream.dispose(); }
});

test('异步密码计算期间退出或停用再启用，不恢复旧登录；计算不会阻塞事件循环', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-hash-'));
  const db = new LocalSQLiteManager(directory); const auth = new AuthService(db);
  try {
    await auth.setup(1, password, '管理员');
    const member = await auth.createUser(1, { username: 'employee', password, displayName: '员工', role: 'member' });
    let ticked = false;
    const login = auth.login(2, 'employee', password).then(() => { assert.equal(ticked, true); });
    setImmediate(() => { ticked = true; }); await login;
    const cancelled = auth.login(3, 'employee', password);
    const rejection = assert.rejects(cancelled, { code: 'AUTH_REQUIRED' });
    await new Promise<void>(resolve => setImmediate(resolve)); auth.logout(3); await rejection;
    const race = auth.login(4, 'employee', password);
    const disabled = assert.rejects(race, { code: 'AUTH_REQUIRED' });
    await new Promise<void>(resolve => setImmediate(resolve));
    await auth.setActive(1, member.id, false); await auth.setActive(1, member.id, true); await disabled;
  } finally { db.close(); await fs.rm(directory, { recursive: true, force: true }); }
});


test('停用账号会将取消信号传递到正在生成的上游请求', async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch;
  let upstreamAborted = false;
  try {
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      if (!String(url).startsWith('https://provider.example/')) return originalFetch(url, init);
      let timer: ReturnType<typeof setInterval>;
      const stream = new ReadableStream({ start(controller) {
        timer = setInterval(() => controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: '片段' } }] }) + '\n\n')), 20);
        init?.signal?.addEventListener('abort', () => { upstreamAborted = true; clearInterval(timer); controller.error(init.signal?.reason); }, { once: true });
      }, cancel() { clearInterval(timer); } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;
    let arrived!: () => void; const first = new Promise<void>(resolve => { arrived = resolve; });
    const running = f.member.runAuthorizedTask(2, signal => streamGenerateScript({ ...generation,
      config: { apiKey: 'local-fixture-key', baseURL: 'https://provider.example/v1', model: 'local-model' } }, () => arrived(), signal), undefined, 20);
    const rejected = assert.rejects(running, { code: 'AUTH_REQUIRED' });
    await first; await f.client.setActive(1, f.user.id, false); await rejected;
    assert.equal(upstreamAborted, true);
  } finally { globalThis.fetch = originalFetch; await f.dispose(); }
});
