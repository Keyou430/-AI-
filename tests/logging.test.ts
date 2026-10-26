import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RuntimeLogger } from '../electron/services/runtimeLogger';

function directory(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'video-remix-logs-')); }
function cleanup(target: string): void {
  assert.equal(path.dirname(path.resolve(target)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith('video-remix-logs-'));
  fs.rmSync(target, { recursive: true, force: true });
}
function records(target: string): any[] {
  return fs.readdirSync(target).filter(name => name.endsWith('.log')).flatMap(name =>
    fs.readFileSync(path.join(target, name), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
}

test('运行日志使用 UTF-8 JSONL，重启后保留旧记录并区分启动会话', () => {
  const target = directory();
  try {
    const first = new RuntimeLogger(target);
    first.write('info', 'app.start', { appVersion: '中文版本', operationId: 'first-operation' });
    new RuntimeLogger(target).write('warn', 'operation.failed', { errorCode: 'AUTH_REQUIRED' });
    const entries = records(target);
    assert.equal(entries.length, 2);
    assert.equal(new Set(entries.map(entry => entry.sessionId)).size, 2);
    assert.ok(entries.some(entry => entry.appVersion === '中文版本'));
    assert.ok(entries.every(entry => Number.isFinite(Date.parse(entry.timestamp)) && entry.pid === process.pid));
  } finally { cleanup(target); }
});

test('日志按大小轮转并限制保留数量，每个文件均可完整解析', () => {
  const target = directory();
  try {
    const logger = new RuntimeLogger(target, { maxFileBytes: 1024, maxFiles: 3 });
    for (let index = 0; index < 40; index++) logger.write('info', 'operation.completed', { operationId: String(index) });
    const files = fs.readdirSync(target);
    assert.equal(files.length, 3);
    assert.ok(files.every(name => fs.statSync(path.join(target, name)).size <= 1024));
    assert.ok(records(target).some(entry => entry.operationId === '39'));
  } finally { cleanup(target); }
});

test('只清理过期的运行日志，不删除目录内的其他文件', () => {
  const target = directory();
  try {
    const expired = path.join(target, 'runtime-2020-01-01-1234abcd-0.log');
    fs.writeFileSync(expired, 'old', 'utf8');
    fs.utimesSync(expired, new Date(0), new Date(0));
    fs.writeFileSync(path.join(target, 'user-notes.txt'), '保留文件', 'utf8');
    new RuntimeLogger(target).write('info', 'app.start');
    assert.equal(fs.existsSync(expired), false);
    assert.equal(fs.readFileSync(path.join(target, 'user-notes.txt'), 'utf8'), '保留文件');
  } finally { cleanup(target); }
});

test('错误日志保留错误码、HTTP 状态和位置，排除凭据、正文与 URL 查询参数', () => {
  const target = directory();
  try {
    const secret = 'private-key-password-prompt-body';
    const error = Object.assign(new Error(secret), { code: 'ENOSPC', status: 429,
      stack: 'Error: ' + secret + '\n    at request (https://user:pass@example.com/client.js?token=' + secret + ':10:20)',
      cause: Object.assign(new Error(secret), { code: 'ECONNRESET' }) });
    new RuntimeLogger(target).write('error', 'service.failed', { error,
      password: secret, apiKey: secret, content: secret, requestBody: secret } as any);
    const [entry] = records(target);
    const raw = JSON.stringify(entry);
    assert.equal(raw.includes(secret), false);
    assert.equal(raw.includes('user:pass'), false);
    assert.equal(entry.error.code, 'ENOSPC');
    assert.equal(entry.error.status, 429);
    assert.equal(entry.error.cause.code, 'ECONNRESET');
    assert.deepEqual(entry.error.locations, ['https://example.com/client.js:10:20']);
    assert.equal('message' in entry.error, false);
  } finally { cleanup(target); }
});

test('日志目录不可写时不打断业务，目录恢复后继续写入', () => {
  const target = directory();
  const originalError = console.error;
  const warnings: unknown[][] = [];
  console.error = (...args) => { warnings.push(args); };
  try {
    const blocked = path.join(target, 'blocked');
    fs.writeFileSync(blocked, 'occupied', 'utf8');
    const logger = new RuntimeLogger(blocked);
    assert.doesNotThrow(() => logger.write('error', 'app.start'));
    logger.write('info', 'app.retry');
    assert.equal(warnings.length, 1);
    fs.unlinkSync(blocked);
    logger.write('info', 'app.recovered');
    assert.equal(records(blocked)[0].event, 'app.recovered');
  } finally { console.error = originalError; cleanup(target); }
});

test('未捕获异常和未处理 Promise 拒绝在退出前落盘，退出码为 1', () => {
  const target = directory();
  try {
    for (const [name, trigger] of [
      ['uncaught-exception', 'setTimeout(() => { throw new Error("private-fatal-body"); }, 0);'],
      ['unhandled-rejection', 'Promise.reject(new Error("private-fatal-body"));'],
    ]) {
      const logPath = path.join(target, name);
      const source = 'const { RuntimeLogger, installProcessErrorLogging } = require("./electron/services/runtimeLogger.ts");' +
        'installProcessErrorLogging(new RuntimeLogger(' + JSON.stringify(logPath) + '), code => process.exit(code));' + trigger;
      const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', source], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 1, result.stderr);
      const [entry] = records(logPath);
      assert.equal(entry.event, 'process.' + name);
      assert.equal(entry.error.name, 'Error');
      assert.equal(JSON.stringify(entry).includes('private-fatal-body'), false);
    }
  } finally { cleanup(target); }
});


test('跨 UTC 日期写入新文件并保留前一天的日志', () => {
  const target = directory();
  const OriginalDate = Date;
  let time = OriginalDate.now();
  globalThis.Date = class extends OriginalDate { constructor() { super(time); } } as DateConstructor;
  try {
    const logger = new RuntimeLogger(target);
    logger.write('info', 'app.first-day');
    time += 24 * 60 * 60 * 1000;
    logger.write('info', 'app.second-day');
    assert.equal(fs.readdirSync(target).length, 2);
    assert.deepEqual(new Set(records(target).map(entry => entry.event)), new Set(['app.first-day','app.second-day']));
  } finally { globalThis.Date = OriginalDate; cleanup(target); }
});
