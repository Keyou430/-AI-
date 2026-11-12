// Run: node --import tsx scripts/authConcurrency.cjs [report.json]
const assert = require('node:assert/strict');
const { fork, execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const userCount = 100;
const timeoutMs = 5000;

async function serve(directory) {
  const { LocalSQLiteManager } = require('../electron/db/sqliteService.ts');
  const { AuthService } = require('../electron/services/authService.ts');
  const { createAuthServer } = require('../server/authServer.ts');
  const password = 'Concurrency-' + randomUUID();
  const db = new LocalSQLiteManager(directory, undefined, false);
  let database;
  try {
    await db.ensureInitialized();
    const auth = new AuthService(db);
    await auth.setup(0, password, '并发测试管理员');
    for (let i = 0; i < userCount; i++) {
      await auth.createUser(0, { username: 'load_' + i, displayName: '并发测试 ' + i, password, role: 'member' });
    }
    database = (await db.getDatabaseInfo()).engine;
  } finally { db.close(); }
  const server = await createAuthServer({ dataDirectory: directory, trustLoopbackProxy: true });
  const stop = () => { server.close(() => process.disconnect?.()); server.closeAllConnections(); };
  process.on('message', message => { if (message === 'stop') stop(); });
  process.once('disconnect', () => { if (server.listening) stop(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  process.send({ port: server.address().port, password, database });
}

async function parallel(count, concurrency, task) {
  const results = Array(count);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, async () => {
    while (next < count) { const index = next++; results[index] = await task(index); }
  }));
  return results;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] * 100) / 100;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
  const report = {
    version, startedAt: new Date().toISOString(),
    scope: 'Isolated loopback HTTP authorization service; separate server and load-generator processes; no production, TLS or paid provider requests.',
    environment: { node: process.version, platform: os.platform(), release: os.release(), cpu: os.cpus()[0].model,
      logicalProcessors: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 1024 ** 3), userCount, timeoutMs },
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceSha256: {}, scenarios: [], checks: [],
  };
  for (const file of ['server/authServer.ts', 'electron/services/authService.ts', 'electron/db/sqliteService.ts']) {
    report.sourceSha256[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
  }
  const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'auth-concurrency-' + version + '.json'));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remix-auth-concurrency-'));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 600, maxFreeSockets: 600 });
  const child = fork(__filename, ['--server', directory], { cwd: root, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const check = (name, passed) => report.checks.push({ name, passed: Boolean(passed) });
  let allTokens = [];
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('测试服务初始化超时')), 60000);
      child.once('message', value => { clearTimeout(timer); resolve(value); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('测试服务退出: ' + code + ' ' + stderr)); });
    });
    report.environment.database = ready.database;
    let sourceSequence = 0;
    const nextSource = () => {
      const value = sourceSequence++;
      return '198.18.' + Math.floor(value / 250) + '.' + (value % 250 + 1);
    };
    function request(route, body, token, source, validate = data => data.success === true) {
      const started = performance.now();
      return new Promise(resolve => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request({ host: '127.0.0.1', port: ready.port, path: route,
          method: payload === undefined ? 'GET' : 'POST', agent, signal: AbortSignal.timeout(timeoutMs),
          headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
            ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(source ? { 'X-Real-IP': source } : {}) } },
        res => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { text += chunk; });
          res.on('error', error => resolve({ ms: performance.now() - started, status: 0, error: error.code || error.name, ok: false }));
          res.on('end', () => {
            try {
              const data = JSON.parse(text);
              resolve({ ms: performance.now() - started, status: res.statusCode, data,
                ok: res.statusCode === 200 && validate(data) });
            } catch { resolve({ ms: performance.now() - started, status: res.statusCode, error: 'INVALID_JSON', ok: false }); }
          });
        });
        req.on('error', error => resolve({ ms: performance.now() - started, status: 0, error: error.code || error.name, ok: false }));
        req.end(payload);
      });
    }
    function record(name, concurrency, rows, elapsedMs) {
      const statuses = {}, errorCodes = {};
      for (const row of rows) {
        statuses[row.status] = (statuses[row.status] || 0) + 1;
        const code = row.error || row.data?.errorCode || (!row.ok ? 'UNEXPECTED_RESPONSE' : undefined);
        if (code) errorCodes[code] = (errorCodes[code] || 0) + 1;
      }
      const successes = rows.filter(row => row.ok);
      const summary = { name, concurrency, requests: rows.length, successful: successes.length, statuses, errorCodes,
        elapsedMs: Math.round(elapsedMs * 100) / 100,
        completedPerSecond: Math.round(rows.length / (elapsedMs / 1000) * 100) / 100,
        successfulPerSecond: Math.round(successes.length / (elapsedMs / 1000) * 100) / 100,
        latencyMs: { p50: percentile(rows.map(row => row.ms), 0.5), p95: percentile(rows.map(row => row.ms), 0.95),
          max: percentile(rows.map(row => row.ms), 1), successP95: percentile(successes.map(row => row.ms), 0.95) } };
      report.scenarios.push(summary);
      console.log(JSON.stringify(summary));
    }
    async function measure(name, count, concurrency, task) {
      const started = performance.now();
      const rows = await parallel(count, concurrency, task);
      record(name, concurrency, rows, performance.now() - started);
      return rows;
    }
    async function login(index, source = nextSource()) {
      const username = 'load_' + (index % userCount);
      const row = await request('/v1/login', { username, password: ready.password }, undefined, source,
        data => data.success === true && data.user?.username === username && data.user?.role === 'member' && /^[a-f0-9]{64}$/.test(data.token));
      if (row.ok) allTokens.push(row.data.token);
      return row;
    }
    async function logoutAll() {
      const tokens = allTokens;
      allTokens = [];
      const rows = await parallel(tokens.length, 20, i => request('/v1/logout', {}, tokens[i]));
      check('退出全部测试会话: ' + tokens.length, rows.every(row => row.ok));
    }
    const warm = concurrency => parallel(concurrency, concurrency, () => request('/health'));
    for (const concurrency of [1, 4]) {
      await warm(concurrency);
      const rows = await measure('login-steady', concurrency === 1 ? 20 : 80, concurrency, i => login(i));
      check(concurrency + ' 路持续登录全部成功且身份正确', rows.every(row => row.ok));
      await logoutAll();
    }
    for (const concurrency of [10, 20, 50, 100]) {
      await warm(concurrency);
      const rows = [];
      let elapsedMs = 0;
      for (let round = 0; round < 3; round++) {
        const started = performance.now();
        rows.push(...await parallel(concurrency, concurrency, i => login(i)));
        elapsedMs += performance.now() - started;
      }
      record('login-burst-3-rounds', concurrency, rows, elapsedMs);
      check(concurrency + ' 路突发仅出现正常登录或 SERVICE_BUSY',
        rows.some(row => row.ok) && rows.some(row => row.data?.errorCode === 'SERVICE_BUSY') &&
        rows.every(row => row.ok || (row.status === 503 && row.data?.errorCode === 'SERVICE_BUSY')));
      check(concurrency + ' 路突发后健康检查成功', (await request('/health')).ok);
      await logoutAll();
    }
    const sessions = await measure('provision-online-sessions', userCount, 4, i => login(i));
    assert.ok(sessions.every(row => row.ok), '在线测试所需的 100 个独立会话未全部建立');
    for (const concurrency of [10, 50, 100, 200, 500]) {
      await warm(concurrency);
      const rows = await measure('online-identity', Math.max(1000, concurrency * 5), concurrency, i => {
        const index = i % userCount;
        return request('/v1/me', undefined, sessions[index].data.token, undefined,
          data => data.success === true && data.user?.username === 'load_' + index && data.user?.role === 'member');
      });
      check(concurrency + ' 路在线校验全部成功且会话未串号', rows.every(row => row.ok));
    }
    await warm(120);
    const mixedStarted = performance.now();
    const [identities, burst] = await Promise.all([
      parallel(1000, 100, i => request('/v1/me', undefined, sessions[i % userCount].data.token, undefined,
        data => data.success === true && data.user?.username === 'load_' + (i % userCount))),
      parallel(20, 20, i => login(i)),
    ]);
    record('mixed-online-identity', 100, identities, performance.now() - mixedStarted);
    record('mixed-login-burst', 20, burst, Math.max(...burst.map(row => row.ms)));
    check('登录突发时在线校验全部成功', identities.every(row => row.ok));
    check('混合负载登录仅返回成功或 SERVICE_BUSY', burst.every(row => row.ok || (row.status === 503 && row.data?.errorCode === 'SERVICE_BUSY')));
    const natRows = await measure('same-ip-61-sequential-logins', 61, 1, i => login(i, '198.19.254.1'));
    check('同 IP 前 60 次成功，第 61 次触发限流', natRows.slice(0, 60).every(row => row.ok) &&
      natRows[60].status === 429 && natRows[60].data?.errorCode === 'RATE_LIMITED');
    await logoutAll();
    const revoked = await parallel(userCount, 50, i => request('/v1/me', undefined, sessions[i].data.token));
    check('100 个已退出会话均被撤销', revoked.every(row => row.status === 401 && row.data?.errorCode === 'AUTH_REQUIRED'));
    check('测试结束后健康检查成功', (await request('/health')).ok);
    check('所有场景均无网络错误或 INTERNAL_ERROR', report.scenarios.every(scenario =>
      !scenario.statuses['0'] && !scenario.errorCodes.INTERNAL_ERROR && !scenario.errorCodes.INVALID_JSON));
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    agent.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      const timer = setTimeout(() => child.kill(), 10000);
      if (child.connected) child.send('stop'); else child.kill();
      await exited;
      clearTimeout(timer);
    }
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('remix-auth-concurrency-'));
    await fs.rm(directory, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    report.fixtureRemoved = true;
    report.passed = !report.error && report.checks.every(item => item.passed);
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
    if (!report.passed) process.exitCode = 1;
    console.log(JSON.stringify({ report: output, passed: report.passed, checks: report.checks.length, failed: report.checks.filter(item => !item.passed) }));
  }
}

if (process.argv[2] === '--server') {
  serve(process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; process.disconnect?.(); });
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
