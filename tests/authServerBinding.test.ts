import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readAuthServerUrl } from '../electron/services/authServerBinding';
import { createDesktopAuth as createEmployeeAuth } from '../electron/services/employeeAuth';
import { LocalSQLiteManager } from '../electron/db/sqliteService';
import { RemoteAuthService } from '../electron/services/remoteAuthService';

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-auth-binding-'));
  const config = path.join(directory, 'package');
  const device = path.join(directory, 'device');
  await fs.mkdir(config); await fs.mkdir(device);
  await fs.writeFile(path.join(config, 'auth-config.json'), JSON.stringify({ binding: 'installation', url: 'https://legacy.example.com' }));
  const bindingFile = path.join(device, 'auth-server-binding.json');
  return { directory, config, device, bindingFile, dispose: () => fs.rm(directory, { recursive: true, force: true }) };
}

test('首次绑定模式缺失或损坏时拒绝启动，不回退默认地址', async () => {
  const f = await fixture();
  try {
    assert.throws(() => readAuthServerUrl(f.config, f.device), { code: 'AUTH_CONFIG_INVALID' });
    assert.throws(() => readAuthServerUrl(f.config), { code: 'AUTH_CONFIG_INVALID' });
    for (const value of ['{', '{}', JSON.stringify({ version: 2, url: 'https://new.example.com' }),
      JSON.stringify({ version: 1, url: 'http://new.example.com' }),
      JSON.stringify({ version: 1, url: 'https://new.example.com/v1' }),
      JSON.stringify({ version: 1, url: 'https://user:password@new.example.com' })]) {
      await fs.writeFile(f.bindingFile, value);
      assert.throws(() => readAuthServerUrl(f.config, f.device), { code: 'AUTH_CONFIG_INVALID' });
    }
  } finally { await f.dispose(); }
});

test('员工入口读取一次性安装绑定，启动不探测网络、不修改绑定', async () => {
  const f = await fixture(); const db = new LocalSQLiteManager(f.device);
  try {
    const contents = JSON.stringify({ version: 1, url: 'https://company.example.com:8443' });
    await fs.writeFile(f.bindingFile, contents);
    assert.equal(readAuthServerUrl(f.config, f.device), 'https://company.example.com:8443');
    const auth = createEmployeeAuth(db, f.directory, f.config, f.device);
    assert.ok(auth instanceof RemoteAuthService);
    assert.equal(Reflect.get(auth, 'baseUrl'), 'https://company.example.com:8443');
    assert.equal(await fs.readFile(f.bindingFile, 'utf8'), contents);
    await fs.unlink(f.bindingFile);
    assert.throws(() => createEmployeeAuth(db, f.directory, f.config, f.device), { code: 'AUTH_CONFIG_INVALID' });
  } finally { db.close(); await f.dispose(); }
});

test('旧版固定地址配置继续兼容，安装绑定模式不受旧默认地址覆盖', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(f.bindingFile, JSON.stringify({ version: 1, url: 'https://company.example.com' }));
    assert.equal(readAuthServerUrl(f.config, f.device), 'https://company.example.com');
    await fs.writeFile(path.join(f.config, 'auth-config.json'), JSON.stringify({ url: 'https://old.example.com' }));
    assert.equal(readAuthServerUrl(f.config, f.device), 'https://old.example.com');
  } finally { await f.dispose(); }
});

test('Windows 安装脚本验证接口、禁止覆盖绑定、卸载清理及保留业务资料', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.resolve('tests/helpers/authInstallerFixture.ps1'), '-Directory', f.directory], { encoding: 'utf8', timeout: 30000 });
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.success, true);
    assert.equal(report.cases, 12);
  } finally { await f.dispose(); }
});

test('公开通用包只携带安装绑定模式，不嵌入环境中的服务器地址', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-public-config-'));
  try {
    await fs.mkdir(path.join(directory, 'scripts'));
    await fs.mkdir(path.join(directory, 'dist-electron/services'), { recursive: true });
    await fs.copyFile(path.resolve('scripts/prepareUniversalConfig.cjs'), path.join(directory, 'scripts/prepareUniversalConfig.cjs'));
    await fs.writeFile(path.join(directory, 'dist-electron/services/employeeAuth.js'), 'module.exports = {};');
    const result = await promisify(execFile)(process.execPath, [path.join(directory, 'scripts/prepareUniversalConfig.cjs')], {
      env: { ...process.env, REMIX_AUTH_URL: 'https://private.example.com' },
    });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'dist-electron/auth-config.json'), 'utf8')), { binding: 'installation' });
    assert.equal(result.stdout.includes('private.example.com'), false);
    assert.equal(await fs.readFile(path.join(directory, 'dist-electron/services/desktopAuth.js'), 'utf8'), 'module.exports = {};');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
