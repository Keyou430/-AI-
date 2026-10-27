import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http, { type Server } from 'node:http';
import { createAuthServer } from '../server/authServer';
import { RemoteAuthService, validateAuthUrl } from '../electron/services/remoteAuthService';
import { createDesktopAuth } from '../electron/services/desktopAuth';
import { LocalSQLiteManager } from '../electron/db/sqliteService';

const adminPassword = 'Admin-test-12345';
const memberPassword = 'Member-test-12345';
async function fixture(options: { sessionTtlMs?: number; loginLimit?: number } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-remote-'));
  const server = await createAuthServer({ dataDirectory: directory, adminPassword, ...options });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = 'http://127.0.0.1:' + address.port;
  const client = () => new RemoteAuthService(url, 1000, true);
  const api = async (route: string, body?: unknown, token?: string) => {
    const result = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: result.status, data: await result.json() };
  };
  let closed = false;
  const stop = async () => { if (!closed) { closed = true; await close(server); } };
  const dispose = async () => { await stop(); await fs.rm(directory, { recursive: true, force: true }); };
  return { directory, server, url, client, api, stop, dispose };
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
}
async function member(f: Awaited<ReturnType<typeof fixture>>) {
  const admin = f.client(); await admin.login(1, 'admin', adminPassword);
  const user = await admin.createUser(1, { username: 'employee', displayName: '测试员工', password: memberPassword, role: 'member' });
  return { admin, user };
}

test('跨客户端停用撤销所有会话，重新启用不会恢复旧凭据，审计日志不含密码或令牌', async () => {
  const f = await fixture();
  try {
    const { admin, user } = await member(f);
    const one = f.client(); const two = f.client();
    assert.deepEqual(await one.status(2), { needsSetup: false, user: null });
    await assert.rejects(one.setup(2, adminPassword, '越权管理员'), { code: 'FORBIDDEN' });
    await one.login(2, 'employee', memberPassword); await two.login(3, 'employee', memberPassword);
    const raw = await f.api('/v1/login', { username: 'employee', password: memberPassword });
    assert.equal((await one.requireUser(2)).id, user.id);
    await assert.rejects(one.listUsers(2), { code: 'FORBIDDEN' });
    await assert.rejects(one.setActive(2, user.id, false), { code: 'FORBIDDEN' });
    const root = await admin.requireUser(1);
    await assert.rejects(admin.setActive(1, root.id, false), { code: 'PROTECTED_ACCOUNT' });
    await admin.setActive(1, user.id, false);
    await admin.setActive(1, user.id, true);
    await assert.rejects(one.requireUser(2), { code: 'AUTH_REQUIRED' });
    await assert.rejects(two.requireUser(3), { code: 'AUTH_REQUIRED' });
    assert.equal((await f.api('/v1/me', undefined, raw.data.token)).status, 401);
    await one.login(2, 'employee', memberPassword);
    await admin.setActive(1, user.id, false);
    await assert.rejects(two.login(3, 'employee', memberPassword), { code: 'ACCOUNT_DISABLED' });
    const logs = (await Promise.all((await fs.readdir(path.join(f.directory, 'logs'))).map(name => fs.readFile(path.join(f.directory, 'logs', name), 'utf8')))).join('');
    for (const secret of [adminPassword, memberPassword, raw.data.token]) assert.ok(!logs.includes(secret));
    assert.ok(logs.includes('"targetId":"' + user.id + '"'));
  } finally { await f.dispose(); }
});

test('重置密码和退出登录撤销服务端会话', async () => {
  const f = await fixture();
  try {
    const { admin, user } = await member(f);
    const employee = f.client(); await employee.login(2, 'employee', memberPassword);
    await admin.resetPassword(1, user.id, 'Changed-test-12345');
    await assert.rejects(employee.requireUser(2), { code: 'AUTH_REQUIRED' });
    await assert.rejects(employee.login(2, 'employee', memberPassword), { code: 'INVALID_CREDENTIALS' });
    await employee.login(2, 'employee', 'Changed-test-12345');
    const loggedIn = await f.api('/v1/login', { username: 'employee', password: 'Changed-test-12345' });
    assert.equal((await f.api('/v1/logout', {}, loggedIn.data.token)).status, 200);
    assert.equal((await f.api('/v1/me', undefined, loggedIn.data.token)).status, 401);
  } finally { await f.dispose(); }
});

test('定时校验在没有业务操作时发现停用并锁定，停止监控后无回调', async () => {
  const f = await fixture();
  let watch: ReturnType<RemoteAuthService['watchSession']> | undefined;
  try {
    const { admin, user } = await member(f);
    const employee = f.client(); await employee.login(2, 'employee', memberPassword);
    let invalidations = 0;
    const lost = new Promise<void>((resolve) => { watch = employee.watchSession(2, () => { invalidations++; resolve(); }, 20); });
    await admin.setActive(1, user.id, false);
    await Promise.race([lost, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('未检测到停用')), 1500); t.unref(); })]);
    assert.equal(employee.hasSession(2), false); assert.equal(invalidations, 1);
    watch!.stop(); await watch!.check(); assert.equal(invalidations, 1);
  } finally { watch?.stop(); await f.dispose(); }
});

test('授权服务不可达时撤销本地会话并锁定，恢复服务后须重新登录', async () => {
  const f = await fixture();
  try {
    const employee = f.client(); await employee.login(1, 'admin', adminPassword);
    await f.stop();
    await assert.rejects(employee.requireUser(1), { code: 'AUTH_UNAVAILABLE' });
    assert.equal(employee.hasSession(1), false);
    assert.equal((await employee.status(1)).user, null);
    await assert.rejects(employee.requireUser(1), { code: 'AUTH_REQUIRED' });
  } finally { await f.dispose(); }
});

test('账号持久化且服务重启后旧会话失效', async () => {
  const f = await fixture();
  let restarted: Server | undefined;
  try {
    await member(f);
    const login = await f.api('/v1/login', { username: 'employee', password: memberPassword });
    await f.stop();
    restarted = await createAuthServer({ dataDirectory: f.directory });
    await new Promise<void>(resolve => restarted!.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + (restarted.address() as { port: number }).port;
    const res = await fetch(url + '/v1/me', { headers: { Authorization: 'Bearer ' + login.data.token } });
    assert.equal(res.status, 401);
    const client = new RemoteAuthService(url, 1000, true);
    assert.equal((await client.login(2, 'employee', memberPassword)).username, 'employee');
  } finally { if (restarted) await close(restarted); await f.dispose(); }
});

test('会话到期、登录限流和无效请求均明确拒绝', async () => {
  const f = await fixture({ sessionTtlMs: 1, loginLimit: 2 });
  try {
    const login = await f.api('/v1/login', { username: 'admin', password: adminPassword });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await f.api('/v1/me', undefined, login.data.token)).status, 401);
    for (let i = 0; i < 2; i++) assert.equal((await f.api('/v1/login', { username: 'admin', password: 'wrong' })).status, 401);
    assert.equal((await f.api('/v1/login', { username: 'admin', password: 'wrong' })).status, 429);
    assert.equal((await f.api('/v1/setup', { password: 'attacker' })).status, 404);
    const malformed = await fetch(f.url + '/v1/login', { method: 'POST', body: 'not-json' });
    assert.equal(malformed.status, 400);
  } finally { await f.dispose(); }
});

test('员工版配置丢失或无效时拒绝启动，不回退本机管理员初始化', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-employee-config-'));
  const db = new LocalSQLiteManager(directory);
  try {
    await fs.writeFile(path.join(directory, 'package.json'), '{}');
    assert.throws(() => createDesktopAuth(db, directory, directory), { code: 'AUTH_CONFIG_INVALID' });
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ authMode: 'remote' }));
    assert.throws(() => createDesktopAuth(db, directory, directory), { code: 'AUTH_CONFIG_INVALID' });
    await fs.writeFile(path.join(directory, 'auth-config.json'), JSON.stringify({ url: 'http://114.132.186.95' }));
    assert.throws(() => createDesktopAuth(db, directory, directory), { code: 'AUTH_CONFIG_INVALID' });
    await fs.writeFile(path.join(directory, 'auth-config.json'), JSON.stringify({ url: 'https://auth.example.com' }));
    assert.ok(createDesktopAuth(db, directory, directory) instanceof RemoteAuthService);
  } finally { db.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('授权服务强制 HTTPS，拒绝嵌入密码、重定向参数和无效地址', () => {
  assert.equal(validateAuthUrl('https://auth.example.com/'), 'https://auth.example.com');
  for (const value of ['http://114.132.186.95', 'http://127.0.0.1', 'https://user:secret@auth.example.com',
    'https://auth.example.com/path', 'https://auth.example.com?key=secret', 'https://auth.example.com#secret', 'invalid']) {
    assert.throws(() => validateAuthUrl(value), { code: 'AUTH_CONFIG_INVALID' });
  }
});


test('登录请求返回前退出，不恢复已撤销的本地登录状态', async () => {
  let arrived!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let remoteLogout = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/logout') { remoteLogout = true; res.end(JSON.stringify({ success: true })); return; }
    arrived(); await gate;
    res.end(JSON.stringify({ success: true, token: 'a'.repeat(64), user: { id: 'cancelled-user' } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new RemoteAuthService('http://127.0.0.1:' + (server.address() as { port: number }).port, 1000, true);
  try {
    const login = client.login(1, 'employee', memberPassword);
    const rejected = assert.rejects(login, { code: 'AUTH_REQUIRED' });
    await started; await client.logout(1); release(); await rejected;
    assert.equal(client.hasSession(1), false);
    const deadline = Date.now() + 1000;
    while (!remoteLogout && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(remoteLogout, true);
  } finally { release(); await close(server); }
});


test('远程删除账号撤销全部会话，保护管理员与当前账号，拒绝成员越权', async () => {
  const f = await fixture();
  try {
    const { admin, user } = await member(f);
    const one = f.client(); const two = f.client();
    await one.login(2, 'employee', memberPassword); await two.login(3, 'employee', memberPassword);
    const root = await admin.requireUser(1);
    await assert.rejects(one.deleteUser(2, root.id), { code: 'FORBIDDEN' });
    await assert.rejects(admin.deleteUser(1, root.id), { code: 'PROTECTED_ACCOUNT' });
    await admin.deleteUser(1, user.id);
    assert.ok(!(await admin.listUsers(1)).some(item => item.id === user.id));
    await assert.rejects(one.requireUser(2), { code: 'AUTH_REQUIRED' });
    await assert.rejects(two.requireUser(3), { code: 'AUTH_REQUIRED' });
    await assert.rejects(two.login(3, 'employee', memberPassword), { code: 'INVALID_CREDENTIALS' });
    await assert.rejects(admin.deleteUser(1, user.id), { code: 'USER_NOT_FOUND' });
  } finally { await f.dispose(); }
});

test('旧授权服务不支持删除时给出升级提示，保留管理员会话', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/login') res.end(JSON.stringify({success:true,token:'a'.repeat(64),user:{id:'admin-id',role:'admin',isActive:true}}));
    else { res.statusCode = 404; res.end(JSON.stringify({success:false,errorCode:'NOT_FOUND'})); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new RemoteAuthService('http://127.0.0.1:' + (server.address() as {port:number}).port, 1000, true);
    await client.login(1, 'admin', adminPassword);
    await assert.rejects(client.deleteUser(1, 'target-id'), {code:'SERVICE_UPDATE_REQUIRED',message:'授权服务尚未支持删除账号，请联系管理员更新服务后重试'});
    assert.equal(client.hasSession(1), true);
  } finally { await close(server); }
});
