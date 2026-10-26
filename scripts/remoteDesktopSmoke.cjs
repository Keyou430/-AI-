const { app } = require('electron');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAuthServer } = require('../dist-server/server/authServer.js');

const applicationPath = path.resolve(process.argv[2]);
const config = JSON.parse(fs.readFileSync(path.join(applicationPath, 'dist-electron/auth-config.json'), 'utf8'));
const endpoint = new URL(config.url);
assert.equal(endpoint.hostname, '127.0.0.1', '此验证脚本只连接本机测试授权服务');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-remote-desktop-'));
const desktopDirectory = path.join(directory, 'desktop');
fs.mkdirSync(desktopDirectory);
app.setPath('userData', desktopDirectory);
const password = 'Smoke-' + randomUUID();
let server;
let proxy;
let completed = false;
const timer = setTimeout(() => { console.error('员工版桌面验证超时'); app.exit(1); }, 80000);
const listen = (s, port) => new Promise((resolve, reject) => { s.once('error', reject); s.listen(port, '127.0.0.1', resolve); });
const close = s => new Promise(resolve => { if (!s?.listening) return resolve(); s.close(resolve); s.closeAllConnections(); });
const waitFor = async (window, expression, timeout = 12000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('员工版界面未达到预期状态');
};

async function start() {
  server = await createAuthServer({ dataDirectory: path.join(directory, 'server'), adminPassword: password });
  await listen(server, 0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const api = async (route, body, token) => {
    const response = await fetch(base + '/v1/' + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(result.success, true); return result;
  };
  const admin = await api('login', { username: 'admin', password });
  const member = await api('users/create', { username: 'desktop_member', displayName: '桌面员工', password, role: 'member' }, admin.token);
  proxy = https.createServer({ key: fs.readFileSync(process.env.REMIX_TEST_TLS_KEY), cert: fs.readFileSync(process.env.REMIX_TEST_TLS_CERT) }, (req, res) => {
    const upstream = http.request(base + req.url, { method: req.method, headers: req.headers }, upstreamResponse => {
      res.writeHead(upstreamResponse.statusCode, upstreamResponse.headers); upstreamResponse.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(503); res.end(); });
    req.pipe(upstream);
  });
  await listen(proxy, Number(endpoint.port));
  app.on('browser-window-created', (_event, window) => {
    window.show = () => {};
    window.webContents.once('did-finish-load', async () => {
      try {
        const call = (method, payload) => window.webContents.executeJavaScript('window.electronAPI[' + JSON.stringify(method) + '](' + (payload === undefined ? '' : JSON.stringify(payload)) + ')');
        const signIn = async () => {
          await window.webContents.executeJavaScript('document.querySelector("[name=username]").value="desktop_member";document.querySelector("[name=password]").value=' + JSON.stringify(password) + ';document.querySelector("form").requestSubmit();');
          await waitFor(window, "document.body.innerText.includes('一键提取并二创')");
        };
        await waitFor(window, "document.body.innerText.includes('登录视频二创 AI 助手')");
        assert.equal((await call('getAuthStatus')).mode, 'remote');
        assert.equal((await call('setupAdmin', { password, displayName: '非法管理员' })).errorCode, 'FORBIDDEN');
        assert.equal((await call('listHistoryFromDB')).errorCode, 'AUTH_REQUIRED');
        await signIn();
        assert.equal((await call('listUsers')).errorCode, 'FORBIDDEN');
        await api('users/status', { userId: member.user.id, active: false }, admin.token);
        assert.equal((await call('parseVideo', { rawInput: 'https://v.douyin.com/demo/', enableMockFallback: true })).success, false);
        await waitFor(window, "document.body.innerText.includes('登录视频二创 AI 助手')");
        await api('users/status', { userId: member.user.id, active: true }, admin.token);
        assert.equal((await call('verifyActive')).errorCode, 'AUTH_REQUIRED');
        await signIn();
        // 不触发业务 IPC，验证真实 30 秒后台监控把已登录界面退回登录页。
        await api('users/status', { userId: member.user.id, active: false }, admin.token);
        await waitFor(window, "document.body.innerText.includes('登录视频二创 AI 助手')", 40000);
        await api('users/status', { userId: member.user.id, active: true }, admin.token);
        await signIn();
        await close(proxy);
        assert.equal((await call('listHistoryFromDB')).errorCode, 'AUTH_UNAVAILABLE');
        await waitFor(window, "document.body.innerText.includes('登录视频二创 AI 助手')");
        assert.equal((await call('getAuthStatus')).needsSetup, false);
        await close(server);
        completed = true; clearTimeout(timer);
        console.log('员工版打包桌面验证通过：HTTPS 登录、禁止本地初始化、成员权限、跨客户端停用、旧会话撤销、真实 30 秒空闲锁定及断网锁定。');
        app.quit();
      } catch (error) { console.error(error); clearTimeout(timer); await close(proxy); await close(server); app.exit(1); }
    });
  });
  require(path.join(applicationPath, 'dist-electron/main.js'));
}
app.on('quit', () => {
  const resolved = path.resolve(directory);
  const expectedRoot = path.resolve(os.tmpdir()) + path.sep;
  if (resolved.startsWith(expectedRoot) && path.basename(resolved).startsWith('remix-remote-desktop-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch {}
  }
  if (!completed) process.exitCode = 1;
});
start().catch(async error => { console.error(error); clearTimeout(timer); await close(proxy); await close(server); app.exit(1); });
