import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { AuthService, AuthError } from './services/authService';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'path';
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

const sqliteService = new LocalSQLiteManager(app.getPath('userData'));
const authService = new AuthService(sqliteService);

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
  options: { public?: boolean; admin?: boolean } = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
        throw new AuthError('FORBIDDEN', '请求来源无效');
      }
      if (!options.public) await authService.requireUser(event.sender.id, options.admin);
      return await listener(event, ...args);
    } catch (error: any) {
      const code = error instanceof AuthError ? error.code : 'INTERNAL_ERROR';
      const message = error?.message || '操作失败';
      if (code === 'AUTH_REQUIRED' || code === 'ACCOUNT_DISABLED') {
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

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  const senderId = mainWindow.webContents.id;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    authService.logout(senderId);
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await sqliteService.ensureInitialized();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================================================
// [Phase 1] IPC: 第三方短视频解析 & 大模型流式生成
// ============================================================================
handle('video:parse', async (_event, payload: VideoParseRequest) => {
  return await parseShortVideoLink(payload);
});

handle('llm:test-connection', async (_event, config: LLMConnectionConfig) => {
  return await testLLMConnection(config);
});

handle('llm:generate-stream', async (event, payload: LLMGenerateRequest) => {
  const sender = event.sender;
  try {
    const fullText = await streamGenerateScript(payload, (chunk: string) => {
      if (!sender.isDestroyed()) {
        sender.send('llm:stream-chunk', { requestId: payload.requestId, chunk });
      }
    });
    if (!sender.isDestroyed()) {
      sender.send('llm:stream-done', { requestId: payload.requestId, fullText });
    }
    return { success: true, fullText };
  } catch (err: any) {
    const errorMessage = err?.message || '调用大模型生成二创脚本失败';
    if (!sender.isDestroyed()) {
      sender.send('llm:stream-error', {
        requestId: payload.requestId,
        error: errorMessage,
      });
    }
    return { success: false, error: errorMessage };
  }
});

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
handle('auth:status', (event) => authService.status(event.sender.id), { public: true });
handle('auth:setup', async (event, input) => ({ success: true,
  user: await authService.setup(event.sender.id, input.password, input.displayName) }), { public: true });
handle('auth:login', async (event, input) => ({ success: true,
  user: await authService.login(event.sender.id, input.username, input.password) }), { public: true });
handle('auth:logout', (event) => { authService.logout(event.sender.id); return { success: true }; }, { public: true });
handle('auth:verify-active', async (event) => ({ success: true, user: await authService.requireUser(event.sender.id) }));
handle('auth:users', async (event) => ({ success: true, users: await authService.listUsers(event.sender.id) }), { admin: true });
handle('auth:create-user', async (event, input) => ({ success: true, user: await authService.createUser(event.sender.id, input) }), { admin: true });
handle('auth:set-active', async (event, input) => {
  await authService.setActive(event.sender.id, input.userId, input.active); return { success: true };
}, { admin: true });
handle('auth:reset-password', async (event, input) => {
  await authService.resetPassword(event.sender.id, input.userId, input.password); return { success: true };
}, { admin: true });
app.on('before-quit', () => sqliteService.close());
