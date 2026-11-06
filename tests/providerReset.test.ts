import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { AuthService } from '../electron/services/authService';
import { LocalSQLiteManager } from '../electron/db/sqliteService';
import { LocalProviderService } from '../electron/services/localProviderService';
import { ProviderResetService } from '../electron/services/providerResetService';
import { RemoteAuthService } from '../electron/services/remoteAuthService';
import { createAuthServer } from '../server/authServer';

const password = 'Reset-test-12345';
const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value).reverse(),
  decryptString: (value: Buffer) => Buffer.from(value).reverse().toString() };
const config = { llmBaseUrl: 'https://text.example/v1', llmModel: 'test', llmApiKey: 'text-secret',
  videoParserProvider: 'custom' as const, videoParserEndpoint: 'https://extract.example/read', videoParserApiKey: 'extract-secret',
  imageProtocol: 'agnes' as const, imageEndpoint: 'https://image.example/v1', imageModel: 'test-image', imageApiKey: 'image-secret' };
async function device(directory: string) {
  await fs.mkdir(directory, { recursive: true });
  const providers = new LocalProviderService(directory, storage);
  providers.save(config);
  return { providers, reset: new ProviderResetService(directory, () => providers.reset()),
    file: path.join(directory, 'providers.encrypted') };
}
async function close(server: http.Server) {
  await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
}
async function listen(server: http.Server, port = 0) {
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + (server.address() as { port: number }).port;
}
async function remoteFixture(sessionTtlMs?: number) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-api-reset-'));
  const options = { dataDirectory: path.join(directory, 'server'), adminPassword: password, sessionTtlMs };
  let server = await createAuthServer(options);
  const url = await listen(server);
  const adminDevice = await device(path.join(directory, 'admin'));
  const employeeDevice = await device(path.join(directory, 'employee'));
  const client = (reset = employeeDevice.reset) => new RemoteAuthService(url, 1000, true, undefined, reset);
  const admin = client(adminDevice.reset);
  await admin.login(1, 'admin', password);
  const user = await admin.createUser(1, { username: 'employee', password, displayName: '员工', role: 'member' });
  return { directory, url, admin, user, client, adminDevice, employeeDevice,
    restart: async () => { const port = (server.address() as { port: number }).port; await close(server); server = await createAuthServer(options); await listen(server, port); await admin.login(1, 'admin', password); },
    dispose: async () => { await close(server); await fs.rm(directory, { recursive: true, force: true }); } };
}

test('本机主动退出、同设备换号、重登及重置密码保留原有三类 API 配置', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-local-reset-'));
  const db = new LocalSQLiteManager(directory);
  try {
    const d = await device(directory); const auth = new AuthService(db, d.reset);
    await auth.setup(1, password, '管理员');
    await auth.createUser(1, { username: 'employee', password, displayName: '员工', role: 'member' });
    const other = await auth.createUser(1, { username: 'other', password, displayName: '同事', role: 'member' });
    const original = await fs.readFile(d.file);
    auth.logout(1); await auth.login(1, 'employee', password); auth.logout(1);
    await auth.login(1, 'other', password); auth.logout(1); await auth.login(1, 'other', password);
    await auth.login(2, 'admin', password); await auth.resetPassword(2, other.id, password + '-new');
    await assert.rejects(auth.requireUser(1), { code: 'AUTH_REQUIRED' });
    await auth.login(1, 'other', password + '-new');
    assert.deepEqual(await fs.readFile(d.file), original);
    assert.equal(d.providers.read().llmApiKey, config.llmApiKey);
    assert.equal(d.providers.read().videoParserApiKey, config.videoParserApiKey);
    assert.equal(d.providers.read().imageApiKey, config.imageApiKey);
  } finally { db.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('本机管理员停用当前员工清除配置及临时文件，保留知识库和历史；重复停用不增加版本', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-local-disabled-'));
  const db = new LocalSQLiteManager(directory, undefined, true);
  try {
    const d = await device(directory); const auth = new AuthService(db, d.reset);
    await auth.setup(1, password, '管理员');
    const user = await auth.createUser(1, { username: 'employee', password, displayName: '员工', role: 'member' });
    await db.upsertKnowledgeDoc({ id: 'keep', name: '保留.txt', filePath: '', fileType: 'txt', sizeBytes: 6,
      uploadedAt: new Date().toISOString(), fullContent: '业务资料', contentSnippet: '业务资料', charCount: 4, enabled: true });
    const history = await db.listRecords(); const docs = await db.listKnowledgeDocs();
    await auth.login(2, 'employee', password); await fs.writeFile(d.file + '.tmp', 'unfinished-config');
    await auth.setActive(1, user.id, false);
    await assert.rejects(fs.stat(d.file), { code: 'ENOENT' });
    await assert.rejects(fs.stat(d.file + '.tmp'), { code: 'ENOENT' });
    assert.equal(d.providers.publicSettings().llmKeyConfigured, false);
    assert.deepEqual(await db.listRecords(), history); assert.deepEqual(await db.listKnowledgeDocs(), docs);
    assert.equal(db.findUser('id', user.id)!.api_reset_version, 1);
    await auth.setActive(1, user.id, false); assert.equal(db.findUser('id', user.id)!.api_reset_version, 1);
    await assert.rejects(auth.requireUser(2), { code: 'AUTH_REQUIRED' });
    await auth.setActive(1, user.id, true); await auth.login(2, 'employee', password);
    assert.equal(d.providers.publicSettings().imageKeyConfigured, false);
  } finally { db.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('本机管理员停用已退出员工不清管理员配置，员工再次验证密码后才执行清理', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-local-deferred-'));
  const db = new LocalSQLiteManager(directory);
  try {
    const d = await device(directory); const auth = new AuthService(db, d.reset);
    await auth.setup(1, password, '管理员');
    const user = await auth.createUser(1, { username: 'employee', password, displayName: '员工', role: 'member' });
    await auth.login(2, 'employee', password); auth.logout(2);
    await auth.setActive(1, user.id, false);
    const original = await fs.readFile(d.file);
    await assert.rejects(auth.login(2, 'employee', 'wrong-password'), { code: 'INVALID_CREDENTIALS' });
    assert.deepEqual(await fs.readFile(d.file), original);
    await assert.rejects(auth.login(2, 'employee', password), { code: 'ACCOUNT_DISABLED' });
    await assert.rejects(fs.stat(d.file), { code: 'ENOENT' });
  } finally { db.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('远程管理员停用仅清员工设备三类配置；管理员设备、员工历史和素材保留', async () => {
  const f = await remoteFixture();
  try {
    const employee = f.client(); await employee.login(2, 'employee', password);
    const originalAdmin = await fs.readFile(f.adminDevice.file);
    const marker = path.join(f.directory, 'employee', 'history-and-assets.keep'); await fs.writeFile(marker, '业务成果');
    await fs.writeFile(f.employeeDevice.file + '.tmp', 'unfinished');
    await f.admin.setActive(1, f.user.id, false);
    await assert.rejects(employee.requireUser(2), { code: 'ACCOUNT_DISABLED' });
    assert.equal(employee.hasSession(2), false);
    await assert.rejects(fs.stat(f.employeeDevice.file), { code: 'ENOENT' });
    await assert.rejects(fs.stat(f.employeeDevice.file + '.tmp'), { code: 'ENOENT' });
    const settings = f.employeeDevice.providers.publicSettings();
    assert.equal(settings.llmKeyConfigured, false); assert.equal(settings.videoKeyConfigured, false); assert.equal(settings.imageKeyConfigured, false);
    assert.deepEqual(await fs.readFile(f.adminDevice.file), originalAdmin); assert.equal(await fs.readFile(marker, 'utf8'), '业务成果');
  } finally { await f.dispose(); }
});

test('远程退出换号、重置密码、账号删除和网络异常均不清配置', async () => {
  const f = await remoteFixture();
  try {
    const employee = f.client(); const original = await fs.readFile(f.employeeDevice.file);
    await employee.login(2, 'employee', password); await employee.logout(2);
    await employee.login(2, 'admin', password); await employee.login(2, 'employee', password);
    await f.admin.resetPassword(1, f.user.id, password + '-new');
    await assert.rejects(employee.requireUser(2), { code: 'AUTH_REQUIRED' });
    await employee.login(2, 'employee', password + '-new');
    await f.admin.deleteUser(1, f.user.id); await assert.rejects(employee.requireUser(2), { code: 'AUTH_REQUIRED' });
    await employee.login(2, 'admin', password);
    await f.restart(); await assert.rejects(employee.requireUser(2), { code: 'AUTH_REQUIRED' });
    assert.deepEqual(await fs.readFile(f.employeeDevice.file), original);
    const offline = new RemoteAuthService('http://127.0.0.1:1', 100, true, undefined, f.employeeDevice.reset);
    await assert.rejects(offline.login(2, 'employee', password), { code: 'AUTH_UNAVAILABLE' });
    assert.deepEqual(await fs.readFile(f.employeeDevice.file), original);
  } finally { await f.dispose(); }
});

test('远程会话自然到期不清配置', async () => {
  const f = await remoteFixture(1000);
  try {
    const employee = f.client(); await employee.login(2, 'employee', password);
    const original = await fs.readFile(f.employeeDevice.file);
    await new Promise(resolve => setTimeout(resolve, 1050));
    await assert.rejects(employee.requireUser(2), { code: 'AUTH_REQUIRED' });
    assert.deepEqual(await fs.readFile(f.employeeDevice.file), original);
  } finally { await f.dispose(); }
});

test('离线错过停用后重新启用，服务及客户端重启后仍按持久版本清理，重登不重复清理', async () => {
  const f = await remoteFixture();
  try {
    const employee = f.client(); await employee.login(2, 'employee', password); await employee.logout(2);
    await f.admin.setActive(1, f.user.id, false); await f.admin.setActive(1, f.user.id, true); await f.restart();
    const d = await device(path.join(f.directory, 'employee')); const restarted = f.client(d.reset);
    await restarted.login(2, 'employee', password); await assert.rejects(fs.stat(d.file), { code: 'ENOENT' });
    d.providers.save(config); await restarted.logout(2); await restarted.login(2, 'employee', password);
    assert.equal(d.providers.read().imageApiKey, config.imageApiKey);
  } finally { await f.dispose(); }
});

test('首次换入已有停用历史的账号仅建立基线，不误清同设备配置；授权来源各自记录', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-reset-baseline-'));
  try {
    const d = await device(directory); const original = await fs.readFile(d.file);
    const user = { id: 'same-id', role: 'member' as const, apiResetVersion: 3 };
    d.reset.signedIn(user, 'https://first.example'); d.reset.signedIn({ ...user, apiResetVersion: 8 }, 'https://second.example');
    assert.deepEqual(await fs.readFile(d.file), original);
    d.reset.disabled({ ...user, role: 'admin', apiResetVersion: 4 }, 'https://first.example');
    assert.deepEqual(await fs.readFile(d.file), original);
    d.reset.signedIn({ ...user, apiResetVersion: 4 }, 'https://first.example');
    await assert.rejects(fs.stat(d.file), { code: 'ENOENT' });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('清理失败仍撤销员工会话，不确认完成；修复文件权限条件后可重试清理', async () => {
  const f = await remoteFixture();
  try {
    const employee = f.client(); await employee.login(2, 'employee', password);
    const progressFile = path.join(f.directory, 'employee', 'provider-reset-versions.json');
    const before = await fs.readFile(progressFile);
    await fs.mkdir(f.employeeDevice.file + '.tmp'); await fs.writeFile(path.join(f.employeeDevice.file + '.tmp', 'blocked'), 'simulate-failure');
    await f.admin.setActive(1, f.user.id, false);
    await assert.rejects(employee.requireUser(2), { code: 'API_RESET_FAILED' }); assert.equal(employee.hasSession(2), false);
    assert.deepEqual(await fs.readFile(progressFile), before);
    assert.equal(f.employeeDevice.providers.read().llmApiKey, config.llmApiKey);
    await fs.rm(f.employeeDevice.file + '.tmp', { recursive: true });
    await f.admin.setActive(1, f.user.id, true); await employee.login(2, 'employee', password);
    await assert.rejects(fs.stat(f.employeeDevice.file), { code: 'ENOENT' });
  } finally { await f.dispose(); }
});

for (const delayed of ['login', 'me'] as const) {
  test('A 的停用 ' + delayed + ' 响应迟到时不清理已切换的 B 配置', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-reset-race-'));
    let arrived!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { arrived = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const server = http.createServer(async (req, res) => {
      let input = ''; for await (const chunk of req) input += chunk;
      const username = input ? JSON.parse(input).username : undefined;
      res.setHeader('Content-Type', 'application/json');
      if ((delayed === 'login' && username === 'a') || (delayed === 'me' && req.url === '/v1/me')) {
        arrived(); await gate; res.statusCode = 401;
        res.end(JSON.stringify({ success: false, errorCode: 'ACCOUNT_DISABLED', disabledUser: { id: 'a', role: 'member', apiResetVersion: 1 } }));
      } else if (req.url === '/v1/login') {
        res.end(JSON.stringify({ success: true, token: (username === 'a' ? 'a' : 'b').repeat(64),
          user: { id: username, role: 'member', isActive: true, apiResetVersion: 0 } }));
      } else res.end(JSON.stringify({ success: true }));
    });
    try {
      const url = await listen(server); const d = await device(directory);
      const client = new RemoteAuthService(url, 2000, true, undefined, d.reset);
      if (delayed === 'me') await client.login(1, 'a', password);
      const pending = delayed === 'login' ? client.login(1, 'a', password) : client.requireUser(1);
      const rejected = assert.rejects(pending, { code: 'AUTH_REQUIRED' });
      await started; await client.logout(1); await client.login(1, 'b', password);
      const original = await fs.readFile(d.file); release(); await rejected;
      assert.equal(client.hasSession(1), true); assert.deepEqual(await fs.readFile(d.file), original);
    } finally { release(); await close(server); await fs.rm(directory, { recursive: true, force: true }); }
  });
}

test('远程停用账号须密码验证成功才清配置，旧令牌重新启用后仍不可用', async () => {
  const f = await remoteFixture();
  try {
    const employee = f.client(); await employee.login(2, 'employee', password);
    const login = await fetch(f.url + '/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'employee', password }) });
    const raw = await login.json();
    await f.admin.setActive(1, f.user.id, false);
    await assert.rejects(employee.login(2, 'employee', 'wrong-password'), { code: 'INVALID_CREDENTIALS' });
    assert.equal(f.employeeDevice.providers.read().imageApiKey, config.imageApiKey);
    await assert.rejects(employee.login(2, 'employee', password), { code: 'ACCOUNT_DISABLED' });
    await assert.rejects(fs.stat(f.employeeDevice.file), { code: 'ENOENT' });
    await f.admin.setActive(1, f.user.id, true);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(f.url + '/v1/me', { headers: { Authorization: 'Bearer ' + raw.token } });
      assert.equal(response.status, 401); assert.equal((await response.json()).errorCode, 'ACCOUNT_DISABLED');
    }
  } finally { await f.dispose(); }
});

test('旧版 SQLite 用户表升级并持久化停用版本，重复打开不会重复迁移或清零', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-reset-migration-'));
  let db = new LocalSQLiteManager(directory);
  try {
    const initSqlJs = (await import('sql.js')).default; const SQL = await initSqlJs(); const legacy = new SQL.Database();
    legacy.run(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      salt TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, last_login_at TEXT)`);
    await fs.writeFile(path.join(directory, 'video-remix-history.sqlite'), legacy.export()); legacy.close();
    const auth = new AuthService(db); await auth.setup(1, password, '管理员');
    const user = await auth.createUser(1, { username: 'employee', password, displayName: '员工', role: 'member' });
    assert.equal(db.findUser('id', user.id)!.api_reset_version, 0);
    await auth.setActive(1, user.id, false); await auth.setActive(1, user.id, true); db.close();
    db = new LocalSQLiteManager(directory); await db.ensureInitialized();
    assert.equal(db.findUser('id', user.id)!.api_reset_version, 1); db.close();
    db = new LocalSQLiteManager(directory); await db.ensureInitialized();
    assert.equal(db.findUser('id', user.id)!.api_reset_version, 1);
  } finally { db.close(); await fs.rm(directory, { recursive: true, force: true }); }
});
