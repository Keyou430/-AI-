// 真实 Electron / safeStorage / IPC 验收；仅使用临时账号、配置与数据库，不调用模型供应商。
const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const sourceRoot = path.resolve(__dirname, '..');
const application = path.resolve(process.argv[2] || sourceRoot);
const metadata = require(path.join(application, 'package.json'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-provider-reset-smoke-'));
const dataDirectory = path.join(temporary, 'employee'); fs.mkdirSync(dataDirectory);
app.setPath('userData', dataDirectory);
const evidence = path.join(sourceRoot, 'release', application.endsWith('.asar') ? 'provider-reset-' + metadata.version : 'provider-reset-smoke');
fs.mkdirSync(evidence, { recursive: true });
const checks = [];
const password = 'Test-' + randomUUID();
let server;
let finishing = false;
const finish = async error => {
  if (finishing) return; finishing = true; clearTimeout(timer);
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ passed: !error, version: metadata.version, application, checks, temporaryDirectory: temporary, error: error?.stack || null }, null, 2));
  if (error) console.error(error); else console.log(JSON.stringify({ passed: true, checks }));
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  process.exitCode = error ? 1 : 0; app.quit();
};
const timer = setTimeout(() => { void finish(new Error('停用配置桌面验收超时')); }, 60000);
dialog.showErrorBox = (_title, message) => { void finish(new Error(message)); };
// Windows 的 Chromium 缓存句柄在进程退出后才释放；运行器随后清理 temporaryDirectory。
const waitFor = async (window, expression) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('界面未达到预期状态：' + expression);
};
app.whenReady().then(async () => {
  const SQL = await require('sql.js')();
  const legacy = new SQL.Database();
  legacy.run(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    salt TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, last_login_at TEXT)`);
  fs.writeFileSync(path.join(dataDirectory, 'video-remix-history.sqlite'), legacy.export()); legacy.close();
  const { createAuthServer } = require('../dist-server/server/authServer.js');
  const { RemoteAuthService } = require(path.join(application, 'dist-electron', 'services', 'remoteAuthService.js'));
  const { LocalProviderService } = require(path.join(application, 'dist-electron', 'services', 'localProviderService.js'));
  const { safeStorage } = require('electron');
  const config = { llmBaseUrl: 'https://text.example/v1', llmModel: 'test', llmApiKey: 'smoke-text-secret',
    videoParserProvider: 'custom', videoParserEndpoint: 'https://extract.example/read', videoParserApiKey: 'smoke-extract-secret',
    imageProtocol: 'agnes', imageEndpoint: 'https://image.example/v1', imageModel: 'test-image', imageApiKey: 'smoke-image-secret' };
  const adminDirectory = path.join(temporary, 'admin'); fs.mkdirSync(adminDirectory);
  const adminProviders = new LocalProviderService(adminDirectory, safeStorage); adminProviders.save(config);
  const adminFile = path.join(adminDirectory, 'providers.encrypted'); const adminConfig = fs.readFileSync(adminFile);
  server = await createAuthServer({ dataDirectory: path.join(temporary, 'server'), adminPassword: password });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fixtureOrigin = 'http://127.0.0.1:' + server.address().port;
  const admin = new RemoteAuthService(fixtureOrigin, 1000, true); await admin.login(1, 'admin', password);
  const employee = await admin.createUser(1, { username: 'employee', password, displayName: '验收员工', role: 'member' });
  await admin.createUser(1, { username: 'other', password, displayName: '同事', role: 'member' });
  const configDirectory = path.join(temporary, 'config'); fs.mkdirSync(configDirectory);
  fs.writeFileSync(path.join(configDirectory, 'auth-config.json'), JSON.stringify({ url: 'https://auth.smoke.test' }));
  // 在验收进程中接入正式员工入口，保持源码、安装配置与真实授权服务不变。
  const desktopAuth = require(path.join(application, 'dist-electron', 'services', 'desktopAuth.js'));
  const employeeAuth = require(path.join(application, 'dist-electron', 'services', 'employeeAuth.js'));
  desktopAuth.createDesktopAuth = (db, directory, _config, device, logger, lifecycle) =>
    employeeAuth.createDesktopAuth(db, directory, configDirectory, device, logger, lifecycle);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === 'https://auth.smoke.test') return originalFetch(fixtureOrigin + url.pathname + url.search, init);
    if (url.origin === fixtureOrigin) return originalFetch(input, init);
    throw new Error('验收拒绝非测试授权请求：' + url.origin);
  };
  app.on('browser-window-created', (_event, window) => {
    window.show = () => {}; window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', async () => {
      try {
        const call = (method, input) => window.webContents.executeJavaScript('window.electronAPI[' + JSON.stringify(method) + '](' + (input === undefined ? '' : JSON.stringify(input)) + ')');
        const login = async (username, secret = password) => {
          await waitFor(window, 'Boolean(document.querySelector("[name=username]"))');
          await window.webContents.executeJavaScript('document.querySelector("[name=username]").value=' + JSON.stringify(username) + ';document.querySelector("[name=password]").value=' + JSON.stringify(secret) + ';document.querySelector("form").requestSubmit();');
          await waitFor(window, 'Boolean(document.querySelector("[aria-label=退出登录]"))');
        };
        const logout = async () => {
          await window.webContents.executeJavaScript('document.querySelector("[aria-label=退出登录]").click()');
          await waitFor(window, 'Boolean(document.querySelector("[name=username]"))');
        };
        await login('employee');
        assert.equal((await call('getDatabaseInfo')).info.engine, 'sqlite3-wasm'); checks.push('Electron 按现有兼容路径使用 WASM SQLite 并升级旧用户表');
        assert.equal((await call('saveProviderSettings', config)).success, true);
        const file = path.join(dataDirectory, 'providers.encrypted'); const original = fs.readFileSync(file);
        await logout(); assert.deepEqual(fs.readFileSync(file), original); checks.push('点击退出登录保留设备配置');
        await login('other'); assert.deepEqual(fs.readFileSync(file), original); checks.push('同设备切换员工账号保留配置');
        await logout(); await login('employee'); assert.deepEqual(fs.readFileSync(file), original); checks.push('重新登录保留三类配置');
        await admin.resetPassword(1, employee.id, password + '-new');
        assert.equal((await call('verifyActive')).errorCode, 'AUTH_REQUIRED');
        await waitFor(window, 'Boolean(document.querySelector("[name=username]"))');
        assert.deepEqual(fs.readFileSync(file), original); checks.push('管理员重置密码仅撤销会话，保留配置');
        await login('employee', password + '-new');
        const marker = path.join(dataDirectory, 'business.keep'); fs.writeFileSync(marker, '保留业务资料');
        fs.writeFileSync(file + '.tmp', 'unfinished');
        await admin.setActive(1, employee.id, false);
        assert.equal((await call('verifyActive')).errorCode, 'ACCOUNT_DISABLED');
        await waitFor(window, 'Boolean(document.querySelector("[name=username]")) && document.body.innerText.includes("停用")');
        assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(file + '.tmp'), false); checks.push('停用触发员工文件清理和登录界面提示');
        assert.deepEqual(fs.readFileSync(adminFile), adminConfig); assert.equal(fs.readFileSync(marker, 'utf8'), '保留业务资料'); checks.push('管理员设备配置及员工业务资料保留');
        await admin.setActive(1, employee.id, true); await login('employee', password + '-new');
        const settings = (await call('getProviderSettings')).config;
        assert.equal(settings.llmKeyConfigured, false); assert.equal(settings.videoKeyConfigured, false); assert.equal(settings.imageKeyConfigured, false); checks.push('重新启用不会恢复旧密钥');
        const migrated = new SQL.Database(fs.readFileSync(path.join(dataDirectory, 'video-remix-history.sqlite')));
        assert.ok(migrated.exec('PRAGMA table_info(users)')[0].values.some(column => column[1] === 'api_reset_version')); migrated.close();
        const serverDb = new SQL.Database(fs.readFileSync(path.join(temporary, 'server', 'video-remix-history.sqlite')));
        assert.equal(serverDb.exec('SELECT api_reset_version FROM users WHERE id = "' + employee.id + '"')[0].values[0][0], 1); serverDb.close(); checks.push('WASM SQLite 持久保存停用清理版本');
        await finish();
      } catch (error) { await finish(error); }
    });
  });
  require(path.join(application, 'dist-electron', 'main.js'));
}).catch(error => { void finish(error); });
