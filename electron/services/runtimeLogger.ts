import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface RuntimeLogDetails {
  operationId?: string;
  channel?: string;
  senderId?: number;
  actorId?: string;
  targetId?: string;
  durationMs?: number;
  outcome?: 'success' | 'failed' | 'canceled';
  errorCode?: string;
  error?: unknown;
  engine?: string;
  appVersion?: string;
  electronVersion?: string;
  nodeVersion?: string;
  platform?: string;
  arch?: string;
  reason?: string;
  exitCode?: number;
  processType?: string;
  kind?: string;
}

// 不接收请求/响应正文；只写入这些诊断字段。
const DETAIL_KEYS = ['operationId', 'channel', 'senderId', 'actorId', 'durationMs',
  'targetId', 'outcome', 'errorCode', 'engine', 'appVersion', 'electronVersion', 'nodeVersion',
  'platform', 'arch', 'reason', 'exitCode', 'processType', 'kind'] as const;
const LOG_FILENAME = /^runtime-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}-\d+\.log$/;
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'AuthError', 'AbortError',
  'TimeoutError', 'DOMException', 'APIError', 'AuthenticationError', 'PermissionDeniedError',
  'RateLimitError', 'InternalServerError', 'APIConnectionError', 'APIConnectionTimeoutError',
  'BadRequestError', 'NotFoundError', 'ConflictError', 'UnprocessableEntityError']);

export function summarizeRuntimeError(error: unknown, includeCause = true): Record<string, unknown> {
  // 原始错误消息可能包含上游接口回显的 Key、请求或响应正文，故只保留类型/码/位置。
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const summary: Record<string, unknown> = {
    name: typeof value.name === 'string' && ERROR_NAMES.has(value.name) ? value.name : 'Error',
  };
  if (typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value.code)) summary.code = value.code;
  if (typeof value.code === 'number' && Number.isFinite(value.code)) summary.code = value.code;
  if (typeof value.status === 'number' && Number.isFinite(value.status)) summary.status = value.status;
  if (typeof value.stack === 'string') {
    const locations = value.stack.slice(0, 16384).split('\n').slice(0, 20).flatMap((line) => {
      // 忽略消息行和函数正文，只提取 JS 堆栈中的文件、行、列。
      const match = line.match(/(?:\(|\s)((?:file:\/\/\/|https?:\/\/|[A-Za-z]:[\\/]|\/)[^()\r\n]+):(\d+):(\d+)\)?$/);
      if (!match) return [];
      let location = match[1].split(/[?#]/, 1)[0];
      if (/^https?:\/\//.test(location)) {
        try { const url = new URL(location); url.username = ''; url.password = ''; location = url.origin + url.pathname; }
        catch { return []; }
      }
      return [location.slice(0, 512) + ':' + match[2] + ':' + match[3]];
    }).slice(0, 12);
    if (locations.length) summary.locations = locations;
  }
  if (includeCause && value.cause && value.cause !== error) summary.cause = summarizeRuntimeError(value.cause, false);
  return summary;
}

export class RuntimeLogger {
  readonly directory: string;
  readonly sessionId = randomUUID();
  private day = '';
  private index = 0;
  private filePath = '';
  private fileBytes = 0;
  private reportedFailure = false;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly retentionDays: number;

  constructor(directory: string, options: { maxFileBytes?: number; maxFiles?: number; retentionDays?: number } = {}) {
    this.directory = path.resolve(directory);
    this.maxFileBytes = options.maxFileBytes ?? 5 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 20;
    this.retentionDays = options.retentionDays ?? 14;
  }

  write(level: 'info' | 'warn' | 'error', event: string, details: RuntimeLogDetails = {}): void {
    try {
      const now = new Date();
      const fields: Record<string, unknown> = {};
      for (const key of DETAIL_KEYS) {
        const value = details[key];
        if (typeof value === 'string') fields[key] = value.slice(0, 128);
        else if (typeof value === 'number' && Number.isFinite(value)) fields[key] = value;
      }
      if (details.error !== undefined) fields.error = summarizeRuntimeError(details.error);
      const line = JSON.stringify({ timestamp: now.toISOString(), level, event: event.slice(0, 80),
        sessionId: this.sessionId, pid: process.pid, ...fields }) + '\n';
      const bytes = Buffer.byteLength(line, 'utf8');
      const day = now.toISOString().slice(0, 10);
      const newFile = !this.filePath || this.day !== day || this.fileBytes + bytes > this.maxFileBytes;
      if (newFile) {
        fs.mkdirSync(this.directory, { recursive: true });
        this.index = this.day === day ? this.index + 1 : 0;
        this.day = day;
        this.filePath = path.join(this.directory, 'runtime-' + day + '-' + this.sessionId.slice(0, 8) + '-' + this.index + '.log');
        this.fileBytes = 0;
      }
      // 同步追加使退出/致命异常前的记录及时交给文件系统；不拦截 console，避免递归。
      fs.appendFileSync(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
      this.fileBytes += bytes;
      if (newFile) this.prune(now.getTime());
      this.reportedFailure = false;
    } catch (error) {
      if (!this.reportedFailure) {
        console.error('运行日志写入失败，错误类型：' + summarizeRuntimeError(error).name);
        this.reportedFailure = true;
      }
    }
  }

  private prune(now: number): void {
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LOG_FILENAME.test(entry.name))
      .map((entry) => {
        const filePath = path.resolve(this.directory, entry.name);
        if (path.dirname(filePath) !== this.directory) throw new Error('日志清理路径无效');
        return { filePath, modified: fs.statSync(filePath).mtimeMs };
      }).sort((a, b) => b.modified - a.modified || b.filePath.localeCompare(a.filePath));
    const retained = files.filter((file) => file.filePath !== this.filePath && file.modified >= cutoff);
    const keep = new Set([this.filePath, ...retained.slice(0, this.maxFiles - 1).map((file) => file.filePath)]);
    for (const file of files) if (!keep.has(file.filePath)) fs.unlinkSync(file.filePath);
  }
}

export function installProcessErrorLogging(logger: RuntimeLogger, exit: (code: number) => void): void {
  process.on('uncaughtException', (error) => {
    logger.write('error', 'process.uncaught-exception', { error });
    exit(1);
  });
  process.on('unhandledRejection', (error) => {
    logger.write('error', 'process.unhandled-rejection', { error });
    exit(1);
  });
}
