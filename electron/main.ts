import { LocalProviderService } from './services/localProviderService';
import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } from 'electron';
import { AuthError } from './services/authError';
import { createDesktopAuth } from './services/desktopAuth';
import { RemoteAuthService } from './services/remoteAuthService';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { RuntimeLogger, installProcessErrorLogging } from './services/runtimeLogger';
import fs from 'fs/promises';
import { parseShortVideoLink, VideoParseRequest } from './services/videoParser';
import {
  streamGenerateScript,
  testLLMConnection,
  LLMGenerateRequest,
  LLMConnectionConfig,
} from './services/llmService';
import {
  LocalSQLiteManager,
  DBHistoryRecord,
  HistoryQueryFilter,
} from './db/sqliteService';
import {
  parseLocalKnowledgeFile,
  parseKnowledgeBuffer,
} from './services/knowledgeParser';

let mainWindow: BrowserWindow | null = null;

const runtimeLogger = new RuntimeLogger(path.join(app.getPath('userData'), 'logs'));
installProcessErrorLogging(runtimeLogger, (code) => app.exit(code));
runtimeLogger.write('info', 'app.start', {
  appVersion: app.getVersion(), electronVersion: process.versions.electron,
  nodeVersion: process.versions.node, platform: process.platform, arch: process.arch,
});
app.on('child-process-gone', (_event, details) => {
  runtimeLogger.write('error', 'process.child-gone', {
    processType: details.type, reason: details.reason, exitCode: details.exitCode,
  });
});

const sqliteService = new LocalSQLiteManager(app.getPath('userData'), (error) => {
  runtimeLogger.write('warn', 'database.engine-fallback', { error, engine: 'sqlite3-wasm' });
});
const authService = createDesktopAuth(sqliteService, path.join(__dirname, '..'), __dirname, app.getPath('userData'));
const localProviders = new LocalProviderService(app.getPath('userData'), safeStorage);

const activeTasks = new Map<number, Set<AbortController>>();
function cancelTasks(senderId: number) {
  for (const controller of activeTasks.get(senderId) || []) controller.abort();
}
async function withTask<T>(senderId: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let tasks = activeTasks.get(senderId);
  if (!tasks) { tasks = new Set(); activeTasks.set(senderId, tasks); }
  tasks.add(controller);
  try { return authService instanceof RemoteAuthService ?
    await authService.runAuthorizedTask(senderId, task, controller.signal) : await task(controller.signal); }
  finally { tasks.delete(controller); if (!tasks.size) activeTasks.delete(senderId); }
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, payload: any, operationId: string) => any,
  options: { public?: boolean; admin?: boolean } = {}) {
  ipcMain.handle(channel, async (event, payload) => {
    const operationId = randomUUID();
    const started = performance.now();
    const context = { operationId, channel, senderId: event.sender.id };
    runtimeLogger.write('info', 'operation.started', context);
    try {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
        throw new AuthError('FORBIDDEN', '请求来源无效');
      }
      const actor = !options.public ? await authService.requireUser(event.sender.id, options.admin) : undefined;
      const result = await listener(event, payload, operationId);
      const outcome = result?.canceled ? 'canceled' : result?.success === false ? 'failed' : 'success';
      runtimeLogger.write(outcome === 'failed' ? 'warn' : 'info', 'operation.completed', {
        ...context, actorId: actor?.id || result?.user?.id, outcome,
        durationMs: Math.round(performance.now() - started),
        errorCode: outcome === 'failed' ? result?.errorCode || 'OPERATION_FAILED' : undefined,
      });
      return result;
    } catch (error: any) {
      const code = error instanceof AuthError ? error.code : 'INTERNAL_ERROR';
      const message = error?.message || '操作失败';
      runtimeLogger.write(error instanceof AuthError ? 'warn' : 'error', 'operation.failed', {
        ...context, outcome: 'failed', errorCode: code, error,
        durationMs: Math.round(performance.now() - started),
      });
      if (['AUTH_REQUIRED', 'ACCOUNT_DISABLED', 'AUTH_UNAVAILABLE'].includes(code) &&
          (!(authService instanceof RemoteAuthService) || !authService.hasSession(event.sender.id))) {
        cancelTasks(event.sender.id);
        event.sender.send('auth:required', { message });
      }
      return { success: false, errorCode: code, error: message, errorMessage: message, message };
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1460,
    height: 940,
    minWidth: 1200,
    minHeight: 780,
    title: '视频二创AI助手',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('did-finish-load', () => runtimeLogger.write('info', 'window.loaded'));
  mainWindow.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame) runtimeLogger.write('error', 'window.load-failed', { error: { code } });
  });
  mainWindow.webContents.on('preload-error', (_event, _preloadPath, error) => {
    runtimeLogger.write('error', 'window.preload-error', { error });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    runtimeLogger.write('error', 'window.renderer-gone', { reason: details.reason, exitCode: details.exitCode });
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  const senderId = mainWindow.webContents.id;
  const authorizationWatch = authService instanceof RemoteAuthService ? authService.watchSession(senderId, (error) => {
    if (mainWindow?.webContents.id === senderId && !mainWindow.webContents.isDestroyed()) {
      cancelTasks(senderId);
      runtimeLogger.write('warn', 'auth.authorization-lost', { senderId, error });
      mainWindow.webContents.send('auth:required', { message: error instanceof Error ? error.message : '授权校验失败，请重新登录' });
    }
  }) : undefined;
  mainWindow.on('focus', () => { void authorizationWatch?.check(); });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    cancelTasks(senderId);
    authorizationWatch?.stop();
    void authService.logout(senderId);
    runtimeLogger.write('info', 'window.closed', { senderId });
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await sqliteService.ensureInitialized();
  const database = await sqliteService.getDatabaseInfo();
  runtimeLogger.write('info', 'database.ready', { engine: database.engine });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  runtimeLogger.write('error', 'app.startup-failed', { error });
  dialog.showErrorBox('启动失败', '应用初始化失败，请查看运行日志：' + runtimeLogger.directory);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================================================
// [Phase 1] IPC: 第三方短视频解析 & 大模型流式生成
// ============================================================================
handle('video:parse', async (event, payload: VideoParseRequest, operationId) => withTask(event.sender.id, async signal => {
  const result = await parseShortVideoLink({ ...payload, ...(() => { const config = localProviders.read(); return ['yaoan', 'linkdigest'].includes(config.videoParserProvider || '') || config.videoParserEndpoint ?
      { apiKey: config.videoParserApiKey, apiEndpoint: config.videoParserEndpoint, apiOptions: config.videoParserOptions, apiProvider: config.videoParserProvider, linkDigestMaxCredits: config.linkDigestMaxCredits } : {}; })() }, error => runtimeLogger.write('error', 'service.video-failed', { operationId, error }), signal);
  signal.throwIfAborted(); return result;
}));

handle('llm:test-connection', async (event, config: LLMConnectionConfig, operationId) => withTask(event.sender.id, async signal => {
  const result = await testLLMConnection((() => { const stored = localProviders.read(); return stored.llmApiKey ?
      { apiKey: stored.llmApiKey, baseURL: stored.llmBaseUrl, model: stored.llmModel } : config; })(), error => runtimeLogger.write('error', 'service.llm-connection-failed', { operationId, error }), signal);
  signal.throwIfAborted(); return result;
}));

handle('providers:get', async () => ({ success: true, config: localProviders.publicSettings() }));
handle('providers:save', async (_event, input) => ({ success: true, config: localProviders.save(input) }));

handle('llm:generate-stream', async (event, payload: LLMGenerateRequest, operationId) => withTask(event.sender.id, async signal => {
  const sender = event.sender;
  try {
    const onChunk = (chunk: string) => {
      signal.throwIfAborted();
      if (!sender.isDestroyed()) sender.send('llm:stream-chunk', { requestId: payload.requestId, chunk });
    };
    const fullText = await streamGenerateScript({ ...payload, config: (() => { const stored = localProviders.read(); return stored.llmApiKey ?
        { apiKey: stored.llmApiKey, baseURL: stored.llmBaseUrl, model: stored.llmModel } : payload.config; })() }, onChunk, signal);
    signal.throwIfAborted();
    await authService.requireUser(sender.id);
    signal.throwIfAborted();
    if (!sender.isDestroyed()) sender.send('llm:stream-done', { requestId: payload.requestId, fullText });
    return { success: true, fullText };
  } catch (err: any) {
    runtimeLogger.write('error', 'service.llm-generation-failed', { operationId, error: err });
    const errorMessage = signal.aborted ? '任务已取消' : err?.message || '调用大模型生成二创脚本失败';
    if (!signal.aborted && !sender.isDestroyed()) sender.send('llm:stream-error', { requestId: payload.requestId, error: errorMessage });
    if (err instanceof AuthError) throw err;
    return { success: false, error: errorMessage };
  }
}));

// ============================================================================
// [Phase 2] IPC: SQLite 历史记录保存、读取与管理
// ============================================================================
handle('db:history:list', async (_event, filter?: HistoryQueryFilter) => {
  const records = await sqliteService.listRecords(filter);
  return { success: true, records };
});

handle('db:history:save', async (_event, record: DBHistoryRecord) => {
  const saved = await sqliteService.upsertRecord(record);
  return { success: true, record: saved };
});

handle('db:history:delete', async (_event, id: string) => {
  const ok = await sqliteService.deleteRecord(id);
  return { success: ok };
});

handle('db:history:info', async () => {
  const info = await sqliteService.getDatabaseInfo();
  return { success: true, info };
});

handle('db:history:open-folder', async () => {
  const info = await sqliteService.getDatabaseInfo();
  if (info.dbPath) {
    shell.showItemInFolder(info.dbPath);
    return { success: true, dbPath: info.dbPath };
  }
  return { success: false };
});

// ============================================================================
// [Phase 3] IPC: 本地知识库文件读取解析 (pdf-parse / mammoth / utf-8) 与持久化
// ============================================================================
handle('kb:list', async () => {
  const docs = await sqliteService.listKnowledgeDocs();
  return { success: true, docs };
});

handle('kb:select-and-parse-files', async () => {
  if (!mainWindow) return { success: false, docs: [] };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择本地企业知识库文件 (.pdf, .docx, .txt, .md)',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: '知识库文档 (.pdf, .docx, .txt, .md, .csv)',
        extensions: ['pdf', 'docx', 'txt', 'md', 'csv', 'json'],
      },
    ],
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { success: false, canceled: true, docs: [] };
  }

  const savedDocs = [];
  for (const fp of filePaths) {
    const parsed = await parseLocalKnowledgeFile(fp);
    const saved = await sqliteService.upsertKnowledgeDoc({
      id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: parsed.name,
      filePath: parsed.filePath,
      fileType: parsed.fileType,
      sizeBytes: parsed.sizeBytes,
      uploadedAt: new Date().toISOString(),
      contentSnippet: parsed.contentSnippet,
      fullContent: parsed.fullContent,
      charCount: parsed.charCount,
      enabled: true,
    });
    savedDocs.push(saved);
  }

  return { success: true, docs: savedDocs };
});

handle(
  'kb:parse-buffer',
  async (
    _event,
    payload: { name: string; sizeBytes: number; base64Data: string }
  ) => {
    const buffer = Buffer.from(payload.base64Data, 'base64');
    const parsed = await parseKnowledgeBuffer({
      name: payload.name,
      sizeBytes: payload.sizeBytes,
      buffer,
    });
    const saved = await sqliteService.upsertKnowledgeDoc({
      id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: parsed.name,
      filePath: parsed.filePath,
      fileType: parsed.fileType,
      sizeBytes: parsed.sizeBytes,
      uploadedAt: new Date().toISOString(),
      contentSnippet: parsed.contentSnippet,
      fullContent: parsed.fullContent,
      charCount: parsed.charCount,
      enabled: true,
    });
    return { success: true, doc: saved };
  }
);

handle('kb:toggle', async (_event, payload: { id: string; enabled: boolean }) => {
  const ok = await sqliteService.toggleKnowledgeDoc(payload.id, payload.enabled);
  return { success: ok };
});

handle('kb:delete', async (_event, id: string) => {
  const ok = await sqliteService.deleteKnowledgeDoc(id);
  return { success: ok };
});

// ============================================================================
// IPC: 本地导出文件（支持 TXT / Word 兼容文档导出）
// ============================================================================
handle(
  'file:export',
  async (
    _event,
    payload: { defaultFilename: string; content: string; format: 'txt' | 'doc' }
  ) => {
    if (!mainWindow) {
      return { success: false, error: '主窗口未就绪' };
    }
    const filters =
      payload.format === 'doc'
        ? [{ name: 'Word 文档 (.doc)', extensions: ['doc'] }]
        : [{ name: '纯文本文件 (.txt)', extensions: ['txt'] }];

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出二创脚本',
      defaultPath: payload.defaultFilename,
      filters,
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    await fs.writeFile(filePath, payload.content, 'utf-8');
    return { success: true, filePath };
  }
);

// 登录会话仅保存在主进程中，并绑定实际发起请求的窗口。
handle('auth:status', async (event) => ({ ...await authService.status(event.sender.id), mode: authService instanceof RemoteAuthService ? 'remote' : 'local' }), { public: true });
handle('auth:setup', async (event, input) => ({ success: true,
  user: await authService.setup(event.sender.id, input.password, input.displayName) }), { public: true });
handle('auth:login', async (event, input) => {
  cancelTasks(event.sender.id);
  return { success: true, user: await authService.login(event.sender.id, input.username, input.password) };
}, { public: true });
handle('auth:logout', async (event) => { cancelTasks(event.sender.id); await authService.logout(event.sender.id); return { success: true }; }, { public: true });
handle('auth:verify-active', async (event) => ({ success: true, user: await authService.requireUser(event.sender.id) }));
handle('auth:users', async (event) => ({ success: true, users: await authService.listUsers(event.sender.id) }), { admin: true });
handle('auth:create-user', async (event, input) => ({ success: true, user: await authService.createUser(event.sender.id, input) }), { admin: true });
handle('auth:set-active', async (event, input) => {
  await authService.setActive(event.sender.id, input.userId, input.active); return { success: true };
}, { admin: true });
handle('auth:reset-password', async (event, input) => {
  await authService.resetPassword(event.sender.id, input.userId, input.password); return { success: true };
}, { admin: true });
handle('runtime:open-log-folder', async () => {
  await fs.mkdir(runtimeLogger.directory, { recursive: true });
  const error = await shell.openPath(runtimeLogger.directory);
  if (error) throw new Error('无法打开运行日志目录');
  return { success: true };
});
handle('runtime:report-error', (_event, payload) => {
  if (payload?.kind !== 'error' && payload?.kind !== 'unhandled-rejection') {
    throw new Error('异常类型无效');
  }
  runtimeLogger.write('error', 'renderer.' + payload.kind, { error: payload });
  return { success: true };
}, { public: true });
app.on('before-quit', () => {
  try { sqliteService.close(); }
  catch (error) { runtimeLogger.write('error', 'database.close-failed', { error }); }
  runtimeLogger.write('info', 'app.stopping');
});
