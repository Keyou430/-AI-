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
  let nextFailure: Failure | null = null;
  const requests: Array<{ method: string; route: string }> = [];
  let logins = 0;
  let logouts = 0;
  const token = 'a'.repeat(64);
  const password = 'Network-test-12345';
  const user = { id: 'test-user', role: 'member', isActive: true };
  const server = http.createServer((req, res) => {
    const currentFailure = nextFailure ?? failure; nextFailure = null;
    requests.push({ method: req.method || '', route: req.url || '' });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/login') {
      logins++;
      res.end(JSON.stringify({ success: true, token, user }));
    } else if (req.url === '/v1/logout') {
      logouts++;
      res.end(JSON.stringify({ success: true }));
    } else if (currentFailure === 'network') {
      req.socket.destroy();
    } else if (currentFailure === 'timeout') {
      // 保持连接，交由客户端请求超时取消。
    } else if (currentFailure === 'malformed') {
      res.statusCode = 502;
      res.end('invalid upstream response');
    } else if (currentFailure) {
      res.statusCode = currentFailure === 'busy' ? 503 : 401;
      res.end(JSON.stringify({ success: false, errorCode: currentFailure === 'busy'
        ? 'SERVICE_BUSY' : currentFailure === 'disabled' ? 'ACCOUNT_DISABLED' : 'AUTH_REQUIRED' }));
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
    failNext: (value: Failure) => { nextFailure = value; },
    requests: () => requests.slice(),
    counters: () => ({ logins, logouts }),
    dispose: async () => {
      await client.logout(1);
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
      await assert.rejects(f.client.runAuthorizedTask(1, async () => { started = true; }, undefined, 20, 900), { code });
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
      }), AbortSignal.timeout(3000), 20, 900);
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

for (const failure of ['network', 'timeout'] as const) {
  test('AUTH-NET-01 单次 ' + failure + ' 恢复后校验成功，仅重查身份且日志脱敏', async () => {
    const f = await fixture();
    try {
      f.failNext(failure);
      assert.equal((await f.client.requireUser(1)).id, 'test-user');
      assert.equal(f.requests().filter(request => request.route === '/v1/me').length, 2);
      assert.deepEqual(f.counters(), { logins: 1, logouts: 0 });
      const rows = (await Promise.all((await fs.readdir(f.directory)).map(name => fs.readFile(path.join(f.directory, name), 'utf8'))))
        .join('').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(rows.filter(row => row.event === 'auth.verification-retry').length, 1);
      const attempts = rows.filter(row => row.channel === 'auth:me' && row.event.startsWith('auth.request-'));
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts.map(row => row.kind), ['initial', 'retry']);
      assert.deepEqual(attempts.map(row => row.outcome), ['failed', 'success']);
      assert.ok(attempts.every(row => Number.isFinite(row.durationMs) && row.durationMs >= 0));
      for (const secret of [f.token, f.password, 'invalid upstream response']) assert.equal(JSON.stringify(rows).includes(secret), false);
    } finally { await f.dispose(); }
  });
}

test('AUTH-NET-02 任务中的单次授权超时恢复后继续原任务，不重复提交任务', async () => {
  const f = await fixture();
  try {
    let markStarted!: () => void; let taskStarts = 0;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const running = f.client.runAuthorizedTask(1, async signal => {
      taskStarts++; markStarted();
      await new Promise(resolve => setTimeout(resolve, 800));
      signal.throwIfAborted();
      return 'same-task-completed';
    }, AbortSignal.timeout(3000), 20);
    await started; f.failNext('timeout');
    assert.equal(await running, 'same-task-completed');
    assert.equal(taskStarts, 1);
    assert.equal(f.client.hasSession(1), true);
  } finally { await f.dispose(); }
});

test('AUTH-NET-03 连续授权超时最多请求两次，失败时保留会话', async () => {
  const f = await fixture();
  try {
    f.fail('timeout');
    await assert.rejects(f.client.requireUser(1), { code: 'AUTH_UNAVAILABLE' });
    assert.equal(f.requests().filter(request => request.route === '/v1/me').length, 2);
    assert.equal(f.client.hasSession(1), true);
  } finally { await f.dispose(); }
});

for (const failure of ['expired', 'disabled'] as const) {
  test('AUTH-NET-04 ' + failure + ' 立即失效，不重试身份查询', async () => {
    const f = await fixture();
    try {
      f.fail(failure);
      await assert.rejects(f.client.requireUser(1), { code: failure === 'disabled' ? 'ACCOUNT_DISABLED' : 'AUTH_REQUIRED' });
      assert.equal(f.requests().filter(request => request.route === '/v1/me').length, 1);
      assert.equal(f.client.hasSession(1), false);
    } finally { await f.dispose(); }
  });
}

test('AUTH-NET-05 超时重试发现账号停用时仍立即中断', async () => {
  const f = await fixture();
  try {
    f.failNext('timeout'); f.fail('disabled');
    await assert.rejects(f.client.requireUser(1), { code: 'ACCOUNT_DISABLED' });
    assert.equal(f.requests().filter(request => request.route === '/v1/me').length, 2);
    assert.equal(f.client.hasSession(1), false);
  } finally { await f.dispose(); }
});

test('AUTH-NET-06 修改账号请求失败不重提', async () => {
  const f = await fixture();
  try {
    f.fail('network');
    await assert.rejects(f.client.setActive(1, 'other-user', false), { code: 'AUTH_UNAVAILABLE' });
    assert.equal(f.requests().filter(request => request.route === '/v1/users/status').length, 1);
    assert.equal(f.client.hasSession(1), true);
  } finally { await f.dispose(); }
});

test('AUTH-NET-07 重试等待期间退出登录后不再查询旧身份', async () => {
  const f = await fixture();
  try {
    f.failNext('network');
    const checking = f.client.requireUser(1);
    const outcome = checking.then(() => 'success', error => error.code);
    await new Promise(resolve => setTimeout(resolve, 50));
    await f.client.logout(1);
    assert.equal(await outcome, 'AUTH_REQUIRED');
    assert.equal(f.requests().filter(request => request.route === '/v1/me').length, 1);
    assert.equal(f.client.hasSession(1), false);
  } finally { await f.dispose(); }
});


test('AUTH-GRACE-01 任务默认 15 秒检查，空闲默认 30 秒', async context => {
  const f = await fixture(); const intervals: number[] = [];
  const original = globalThis.setInterval;
  context.mock.method(globalThis, 'setInterval', (...args: Parameters<typeof setInterval>) => {
    intervals.push(Number(args[1])); return original(...args);
  });
  const watch = f.client.watchSession(1, () => {});
  try {
    assert.equal(await f.client.runAuthorizedTask(1, async () => 'done'), 'done');
    assert.deepEqual(intervals, [30000, 15000]);
  } finally { watch.stop(); await f.dispose(); }
});

test('AUTH-GRACE-02 连续连接故障在宽限内恢复，原任务只提交一次', async () => {
  const f = await fixture(); let starts = 0; let signalSeen: AbortSignal | undefined;
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  let recovery: ReturnType<typeof setTimeout> | undefined;
  try {
    const running = f.client.runAuthorizedTask(1, async signal => {
      starts++; signalSeen = signal; started();
      await new Promise(resolve => setTimeout(resolve, 1300)); signal.throwIfAborted(); return 'original-result';
    }, AbortSignal.timeout(4000), 20, 1800);
    const result = running.then(value => ({ value }), error => ({ error }));
    await ready; f.fail('network'); recovery = setTimeout(() => f.fail(null), 700);
    assert.deepEqual(await result, { value: 'original-result' });
    assert.equal(starts, 1); assert.equal(signalSeen?.aborted, false);
    assert.equal(f.client.hasSession(1), true);
    assert.ok(f.requests().filter(request => request.route === '/v1/me').length >= 4);
  } finally { clearTimeout(recovery); await f.dispose(); }
});

test('AUTH-GRACE-03 已完成结果在结束校验临时故障时返回，新任务仍需实时校验', async () => {
  const f = await fixture(); let starts = 0;
  try {
    assert.equal(await f.client.runAuthorizedTask(1, async () => {
      starts++; f.fail('network'); return 'saved-image';
    }, undefined, 20, 1200), 'saved-image');
    const pending = f.client.runAuthorizedTask(1, async () => { starts++; }, undefined, 20, 1200);
    await assert.rejects(pending, { code: 'AUTH_UNAVAILABLE' });
    assert.equal(starts, 1); assert.equal(f.client.hasSession(1), true);
  } finally { await f.dispose(); }
});

test('AUTH-GRACE-04 连续失败不延长宽限，到期取消在途任务并保留会话', async () => {
  const f = await fixture(); let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }); let canceled = false;
  try {
    const begin = performance.now();
    const running = f.client.runAuthorizedTask(1, signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { canceled = true; reject(signal.reason); }, { once: true }); started();
    }), AbortSignal.timeout(3000), 20, 900);
    const rejection = assert.rejects(running, { code: 'AUTH_UNAVAILABLE' });
    await ready; f.fail('network'); await rejection;
    const elapsed = performance.now() - begin;
    assert.ok(elapsed >= 800 && elapsed < 2000, '实际宽限耗时 ' + elapsed);
    assert.equal(canceled, true); assert.equal(f.client.hasSession(1), true);
  } finally { await f.dispose(); }
});

test('AUTH-GRACE-05 实时成功校验刷新期限，长任务不会按最初时间误取消', async () => {
  const f = await fixture();
  try {
    assert.equal(await f.client.runAuthorizedTask(1, async signal => {
      await new Promise(resolve => setTimeout(resolve, 1100)); signal.throwIfAborted(); return 'long-result';
    }, AbortSignal.timeout(3000), 40, 500), 'long-result');
  } finally { await f.dispose(); }
});

test('AUTH-GRACE-06 下一任务等待授权恢复，校验成功前不提交业务', async () => {
  const f = await fixture(); let submitted = 0; let restored = false;
  let recovery: ReturnType<typeof setTimeout> | undefined;
  try {
    await f.client.requireUser(1); f.fail('network');
    const running = f.client.runAuthorizedTask(1, async () => {
      assert.equal(restored, true); submitted++; return 'next-page';
    }, AbortSignal.timeout(3000), 20, 1800);
    const result = running.then(value => ({ value }), error => ({ error }));
    recovery = setTimeout(() => { restored = true; f.fail(null); }, 600);
    assert.deepEqual(await result, { value: 'next-page' }); assert.equal(submitted, 1);
  } finally { clearTimeout(recovery); await f.dispose(); }
});

test('AUTH-GRACE-07 等待授权时取消，不启动业务任务', async () => {
  const f = await fixture(); let submitted = 0; const controller = new AbortController();
  let cancel: ReturnType<typeof setTimeout> | undefined;
  try {
    await f.client.requireUser(1); f.fail('network');
    const running = f.client.runAuthorizedTask(1, async () => { submitted++; }, controller.signal, 20, 1800);
    const rejection = assert.rejects(running, { name: 'AbortError' });
    cancel = setTimeout(() => controller.abort(), 400); await rejection;
    assert.equal(submitted, 0); assert.equal(f.client.hasSession(1), true);
  } finally { clearTimeout(cancel); await f.dispose(); }
});

for (const failure of ['expired', 'disabled'] as const) {
  test('AUTH-GRACE-08 宽限期间收到 ' + failure + ' 仍立即取消', async () => {
    const f = await fixture(); let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let invalidate: ReturnType<typeof setTimeout> | undefined;
    try {
      const running = f.client.runAuthorizedTask(1, signal => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }); started();
      }), AbortSignal.timeout(3000), 20, 1800);
      const rejection = assert.rejects(running, { code: failure === 'disabled' ? 'ACCOUNT_DISABLED' : 'AUTH_REQUIRED' });
      await ready; f.fail('network'); invalidate = setTimeout(() => f.fail(failure), 350);
      await rejection; assert.equal(f.client.hasSession(1), false);
    } finally { clearTimeout(invalidate); await f.dispose(); }
  });
}

test('AUTH-GRACE-09 并发身份查询只发一次请求，各自权限判断保持有效', async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.client.requireUser(1), f.client.requireUser(1), f.client.requireUser(1, true)]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'rejected']);
    assert.equal((results[2] as PromiseRejectedResult).reason.code, 'FORBIDDEN');
    assert.equal(f.requests().filter(request => request.route === '/v1/me').length, 1);
    await f.client.requireUser(1);
    assert.equal(f.requests().filter(request => request.route === '/v1/me').length, 2, '完成后不复用缓存授权');
  } finally { await f.dispose(); }
});

test('AUTH-GRACE-10 宽限等待期间退出立即取消，旧身份不能启动任务', async () => {
  const f = await fixture(); let submitted = 0;
  let logout: ReturnType<typeof setTimeout> | undefined;
  try {
    await f.client.requireUser(1); f.fail('network');
    const running = f.client.runAuthorizedTask(1, async () => { submitted++; }, AbortSignal.timeout(3000), 20, 1800);
    const rejection = assert.rejects(running, { code: 'AUTH_REQUIRED' });
    logout = setTimeout(() => { void f.client.logout(1); }, 400); await rejection;
    assert.equal(submitted, 0); assert.equal(f.client.hasSession(1), false);
  } finally { clearTimeout(logout); await f.dispose(); }
});


test('AUTH-GRACE-12 预检中的慢查询也不能跨越剩余宽限再启动任务', async () => {
  const f = await fixture(); let submitted = 0;
  try {
    await f.client.requireUser(1); f.fail('timeout');
    const begin = performance.now();
    await assert.rejects(f.client.runAuthorizedTask(1, async () => { submitted++; }, undefined, 20, 900), { code: 'AUTH_UNAVAILABLE' });
    const elapsed = performance.now() - begin;
    assert.ok(elapsed >= 800 && elapsed < 1250, '慢查询仍须遵守宽限，实际 ' + elapsed);
    assert.equal(submitted, 0); assert.equal(f.client.hasSession(1), true);
  } finally { await f.dispose(); }
});
