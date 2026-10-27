import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { RemoteAuthService } from '../electron/services/remoteAuthService';
import { RuntimeLogger } from '../electron/services/runtimeLogger';

type Failure = 'network' | 'timeout' | 'malformed' | 'busy' | 'expired' | 'disabled';

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-auth-network-'));
  let failure: Failure | null = null;
  let logins = 0;
  let logouts = 0;
  const token = 'a'.repeat(64);
  const password = 'Network-test-12345';
  const user = { id: 'test-user', role: 'member', isActive: true };
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/login') {
      logins++;
      res.end(JSON.stringify({ success: true, token, user }));
    } else if (req.url === '/v1/logout') {
      logouts++;
      res.end(JSON.stringify({ success: true }));
    } else if (failure === 'network') {
      req.socket.destroy();
    } else if (failure === 'timeout') {
      // 保持连接，交由客户端请求超时取消。
    } else if (failure === 'malformed') {
      res.statusCode = 502;
      res.end('invalid upstream response');
    } else if (failure) {
      res.statusCode = failure === 'busy' ? 503 : 401;
      res.end(JSON.stringify({ success: false, errorCode: failure === 'busy'
        ? 'SERVICE_BUSY' : failure === 'disabled' ? 'ACCOUNT_DISABLED' : 'AUTH_REQUIRED' }));
    } else {
      res.end(JSON.stringify({ success: true, user }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const client = new RemoteAuthService(url, 200, true, new RuntimeLogger(directory));
  await client.login(1, 'employee', password);
  return {
    client, directory, token, password,
    fail: (value: Failure | null) => { failure = value; },
    counters: () => ({ logins, logouts }),
    dispose: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

for (const failure of ['network', 'timeout', 'malformed', 'busy'] as const) {
  test('授权 ' + failure + ' 时阻止操作、保留会话，恢复后无需重新登录', async () => {
    const f = await fixture();
    try {
      f.fail(failure);
      const code = failure === 'busy' ? 'SERVICE_BUSY' : 'AUTH_UNAVAILABLE';
      await assert.rejects(f.client.requireUser(1), { code });
      assert.equal(f.client.hasSession(1), true);
      let started = false;
      await assert.rejects(f.client.runAuthorizedTask(1, async () => { started = true; }), { code });
      assert.equal(started, false);
      f.fail(null);
      assert.equal((await f.client.requireUser(1)).id, 'test-user');
      assert.equal(await f.client.runAuthorizedTask(1, async () => 'done'), 'done');
      assert.deepEqual(f.counters(), { logins: 1, logouts: 0 });
      const logs = (await Promise.all((await fs.readdir(f.directory)).map(name => fs.readFile(path.join(f.directory, name), 'utf8')))).join('');
      assert.ok(logs.includes('auth.verification-failed'));
      assert.ok(logs.includes(code));
      if (failure === 'timeout') assert.ok(logs.includes('TimeoutError'));
      if (failure === 'network' || failure === 'malformed') assert.ok(logs.includes('"cause":'));
      for (const secret of [f.token, f.password, 'invalid upstream response']) assert.equal(logs.includes(secret), false);
    } finally { await f.dispose(); }
  });
}

test('空闲校验连接失败不触发退出，恢复后重试成功，真实过期才退出', async () => {
  const f = await fixture();
  let invalidations = 0;
  const watch = f.client.watchSession(1, () => { invalidations++; });
  try {
    f.fail('network');
    await watch.check();
    assert.equal(invalidations, 0);
    assert.equal(f.client.hasSession(1), true);
    f.fail(null);
    await watch.check();
    assert.equal((await f.client.requireUser(1)).id, 'test-user');
    f.fail('expired');
    await watch.check();
    assert.equal(invalidations, 1);
    assert.equal(f.client.hasSession(1), false);
  } finally { watch.stop(); await f.dispose(); }
});

for (const failure of ['network', 'expired', 'disabled'] as const) {
  test('任务中授权 ' + failure + ' 时停止任务并保留真实错误原因', async () => {
    const f = await fixture();
    try {
      let markStarted!: () => void;
      const started = new Promise<void>(resolve => { markStarted = resolve; });
      const running = f.client.runAuthorizedTask(1, signal => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        markStarted();
      }), AbortSignal.timeout(3000), 20);
      const code = failure === 'network' ? 'AUTH_UNAVAILABLE' : failure === 'disabled' ? 'ACCOUNT_DISABLED' : 'AUTH_REQUIRED';
      const rejected = assert.rejects(running, { code });
      await started;
      f.fail(failure);
      await rejected;
      assert.equal(f.client.hasSession(1), failure === 'network');
      const logs = (await Promise.all((await fs.readdir(f.directory)).map(name => fs.readFile(path.join(f.directory, name), 'utf8')))).join('');
      assert.ok(logs.includes(code));
      assert.ok(logs.includes('auth.verification-failed'));
      if (failure === 'network') {
        f.fail(null);
        assert.equal(await f.client.runAuthorizedTask(1, async () => 'retried'), 'retried');
        assert.deepEqual(f.counters(), { logins: 1, logouts: 0 });
      }
    } finally { await f.dispose(); }
  });
}
