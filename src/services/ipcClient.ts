import type { StorageLocation } from '../../electron/services/storageLocation';
import type { ProviderSettings, ProviderSettingsInput } from '../../electron/services/providerTypes';
/**
 * 前端与 Electron 主进程通信桥接层 (完整覆盖 Phase 1 + Phase 2 + Phase 3)
 * - Phase 1: 短视频链接提取 + 大模型流式二创生成
 * - Phase 2: SQLite 历史记录 CRUD
 * - Phase 3: 本地知识库文件读取解析 (.pdf / .docx / .txt / .md) + 多轮对话上下文传递
 */

import {
  AppSettings,
  AuthUser,
  AuthResult,
  ConversationTurn,
  DatabaseStatusInfo,
  HistoryRecord,
  KnowledgeDocument,
  ParsedVideoInfo,
} from '../types';

declare global {
  interface Window {
    electronAPI?: {
      getStorageLocation: () => Promise<{ success: boolean; location?: StorageLocation; error?: string }>;
      chooseStorageLocation: () => Promise<{ success: boolean; canceled?: boolean; location?: StorageLocation; error?: string }>;
      getProviderSettings: () => Promise<{ success: boolean; config?: ProviderSettings; error?: string }>;
      saveProviderSettings: (input: ProviderSettingsInput) => Promise<{ success: boolean; config?: ProviderSettings; error?: string }>;
      getAuthStatus: () => Promise<{ needsSetup: boolean; user: AuthUser | null; mode?: 'local' | 'remote' }>;
      openLogFolder: () => Promise<{ success: boolean; error?: string }>;
      reportRuntimeError: (payload: { kind: 'error' | 'unhandled-rejection'; name?: string; stack?: string }) => Promise<{ success: boolean }>;
      setupAdmin: (input: { password: string; displayName: string }) => Promise<AuthResult>;
      login: (input: { username: string; password: string }) => Promise<AuthResult>;
      logout: () => Promise<AuthResult>;
      verifyActive: () => Promise<AuthResult>;
      listUsers: () => Promise<AuthResult>;
      createUser: (input: { username: string; password: string; displayName: string; role: 'admin' | 'member' }) => Promise<AuthResult>;
      setUserActive: (input: { userId: string; active: boolean }) => Promise<AuthResult>;
      deleteUser: (input: { userId: string }) => Promise<AuthResult>;
      resetUserPassword: (input: { userId: string; password: string }) => Promise<AuthResult>;
      onAuthRequired: (callback: (data: { message: string }) => void) => () => void;
      parseVideo: (payload: any) => Promise<any>;
      testLLMConnection: (config: any) => Promise<any>;
      generateScriptStream: (payload: any) => Promise<any>;
      exportFile: (payload: {
        defaultFilename: string;
        content: string;
        format: 'txt' | 'doc';
      }) => Promise<any>;

      // Phase 2 SQLite 历史记录
      listHistoryFromDB: (filter?: {
        search?: string;
        platform?: 'all' | 'douyin' | 'xiaohongshu';
      }) => Promise<{ success: boolean; records: HistoryRecord[] }>;
      saveHistoryToDB: (
        record: HistoryRecord
      ) => Promise<{ success: boolean; record?: HistoryRecord; error?: string }>;
      deleteHistoryFromDB: (id: string) => Promise<{ success: boolean; error?: string }>;
      getDatabaseInfo: () => Promise<{
        success: boolean;
        info: DatabaseStatusInfo;
      }>;
      openDatabaseFolder: () => Promise<{ success: boolean; dbPath?: string }>;

      // Phase 3 本地知识库读取与管理
      listKnowledgeDocsFromDB: () => Promise<{
        success: boolean;
        docs: KnowledgeDocument[];
      }>;
      selectAndParseKnowledgeFiles: () => Promise<{
        success: boolean;
        canceled?: boolean;
        docs: KnowledgeDocument[];
      }>;
      parseKnowledgeBuffer: (payload: {
        name: string;
        sizeBytes: number;
        base64Data: string;
      }) => Promise<{ success: boolean; doc: KnowledgeDocument }>;
      toggleKnowledgeDocInDB: (payload: {
        id: string;
        enabled: boolean;
      }) => Promise<{ success: boolean }>;
      deleteKnowledgeDocFromDB: (id: string) => Promise<{ success: boolean }>;

      onStreamChunk: (
        cb: (data: { requestId: string; chunk: string }) => void
      ) => () => void;
      onStreamDone: (
        cb: (data: { requestId: string; fullText: string }) => void
      ) => () => void;
      onStreamError: (
        cb: (data: { requestId: string; error: string }) => void
      ) => () => void;
    };
  }
}

const BROWSER_FALLBACK_DB_KEY = 'video-remix-sqlite-browser-fallback-v3';
const BROWSER_FALLBACK_KB_KEY = 'video-remix-kb-browser-fallback-v3';

function getBrowserFallbackRecords(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(BROWSER_FALLBACK_DB_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setBrowserFallbackRecords(records: HistoryRecord[]): void {
  try {
    localStorage.setItem(BROWSER_FALLBACK_DB_KEY, JSON.stringify(records));
  } catch {
    // ignore
  }
}

function getBrowserFallbackKnowledgeDocs(): KnowledgeDocument[] {
  try {
    const raw = localStorage.getItem(BROWSER_FALLBACK_KB_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function setBrowserFallbackKnowledgeDocs(docs: KnowledgeDocument[]): void {
  try {
    localStorage.setItem(BROWSER_FALLBACK_KB_KEY, JSON.stringify(docs));
  } catch {
    // ignore
  }
}

// ============================================================================
// Phase 2: SQLite 历史记录客户端封装
// ============================================================================
export async function fetchHistoryRecordsFromSQLite(filter?: {
  search?: string;
  platform?: 'all' | 'douyin' | 'xiaohongshu';
}): Promise<HistoryRecord[]> {
  if (window.electronAPI?.listHistoryFromDB) {
    const res = await window.electronAPI.listHistoryFromDB(filter);
    return res?.records || [];
  }

  let records = getBrowserFallbackRecords();
  if (filter?.platform && filter.platform !== 'all') {
    records = records.filter((r) => r.platform === filter.platform);
  }
  if (filter?.search?.trim()) {
    const q = filter.search.trim().toLowerCase();
    records = records.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.originalTranscript.toLowerCase().includes(q) ||
        r.rawGeneratedScript.toLowerCase().includes(q)
    );
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveHistoryRecordToSQLite(
  record: HistoryRecord
): Promise<HistoryRecord> {
  if (window.electronAPI?.saveHistoryToDB) {
    const res = await window.electronAPI.saveHistoryToDB(record);
    if (!res?.success || !res.record) {
      throw new Error(res?.error || '保存历史记录失败');
    }
    return res.record;
  }

  const current = getBrowserFallbackRecords();
  const idx = current.findIndex((r) => r.id === record.id);
  if (idx >= 0) {
    current[idx] = record;
  } else {
    current.unshift(record);
  }
  setBrowserFallbackRecords(current);
  return record;
}

export async function deleteHistoryRecordFromSQLite(id: string): Promise<boolean> {
  if (window.electronAPI?.deleteHistoryFromDB) {
    const res = await window.electronAPI.deleteHistoryFromDB(id);
    if (!res?.success) throw new Error(res?.error || '删除历史记录失败，请重试。');
    return true;
  }

  const current = getBrowserFallbackRecords().filter((r) => r.id !== id);
  setBrowserFallbackRecords(current);
  return true;
}

export async function fetchSQLiteDatabaseInfo(): Promise<DatabaseStatusInfo> {
  if (window.electronAPI?.getDatabaseInfo) {
    const res = await window.electronAPI.getDatabaseInfo();
    if (res?.info) return res.info;
  }

  const records = getBrowserFallbackRecords();
  const kbDocs = getBrowserFallbackKnowledgeDocs();
  const rawBytes = new Blob([JSON.stringify(records) + JSON.stringify(kbDocs)]).size;
  return {
    engine: 'browser-local',
    dbPath: '浏览器预览缓存（桌面客户端使用本地数据库）',
    totalCount: records.length,
    knowledgeDocCount: kbDocs.length,
    dbSizeBytes: rawBytes,
  };
}

export async function openSQLiteDatabaseFolder(): Promise<void> {
  if (window.electronAPI?.openDatabaseFolder) {
    await window.electronAPI.openDatabaseFolder();
  }
}

// ============================================================================
// Phase 3: 本地知识库读取与解析客户端封装
// ============================================================================
export async function fetchKnowledgeDocsClient(): Promise<KnowledgeDocument[]> {
  if (window.electronAPI?.listKnowledgeDocsFromDB) {
    const res = await window.electronAPI.listKnowledgeDocsFromDB();
    return res?.docs || [];
  }
  return getBrowserFallbackKnowledgeDocs();
}

export async function selectNativeKnowledgeFilesClient(): Promise<KnowledgeDocument[]> {
  if (window.electronAPI?.selectAndParseKnowledgeFiles) {
    const res = await window.electronAPI.selectAndParseKnowledgeFiles();
    return res?.docs || [];
  }
  return [];
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export async function uploadAndParseKnowledgeFileClient(
  file: File
): Promise<KnowledgeDocument> {
  const arrayBuffer = await file.arrayBuffer();

  if (window.electronAPI?.parseKnowledgeBuffer) {
    const base64Data = arrayBufferToBase64(arrayBuffer);
    const res = await window.electronAPI.parseKnowledgeBuffer({
      name: file.name,
      sizeBytes: file.size,
      base64Data,
    });
    if (res?.doc) return res.doc;
  }

  // 浏览器端文本读取回退
  let fullContent = '';
  try {
    fullContent = (await file.text()).trim();
  } catch {
    fullContent = `《${file.name}》知识库核心规范内容`;
  }
  if (!fullContent) {
    fullContent = `《${file.name}》本地知识库文档内容`;
  }

  const newDoc: KnowledgeDocument = {
    id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: file.name,
    filePath: `browser://${file.name}`,
    fileType: file.name.split('.').pop() || 'txt',
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
    contentSnippet: fullContent.slice(0, 220).replace(/\s+/g, ' '),
    fullContent,
    charCount: fullContent.length,
    enabled: true,
  };

  const docs = getBrowserFallbackKnowledgeDocs();
  docs.unshift(newDoc);
  setBrowserFallbackKnowledgeDocs(docs);
  return newDoc;
}

export async function toggleKnowledgeDocClient(
  id: string,
  enabled: boolean
): Promise<void> {
  if (window.electronAPI?.toggleKnowledgeDocInDB) {
    await window.electronAPI.toggleKnowledgeDocInDB({ id, enabled });
    return;
  }
  const docs = getBrowserFallbackKnowledgeDocs().map((d) =>
    d.id === id ? { ...d, enabled } : d
  );
  setBrowserFallbackKnowledgeDocs(docs);
}

export async function deleteKnowledgeDocClient(id: string): Promise<void> {
  if (window.electronAPI?.deleteKnowledgeDocFromDB) {
    await window.electronAPI.deleteKnowledgeDocFromDB(id);
    return;
  }
  const docs = getBrowserFallbackKnowledgeDocs().filter((d) => d.id !== id);
  setBrowserFallbackKnowledgeDocs(docs);
}

// ============================================================================
// Phase 1: 视频解析与流式二创生成
// ============================================================================
export async function parseVideoLinkClient(
  rawInput: string,
  settings: AppSettings
): Promise<{
  success: boolean;
  data?: ParsedVideoInfo;
  errorMessage?: string;
}> {
  if (window.electronAPI) {
    return await window.electronAPI.parseVideo({
      rawInput,
      apiKey: settings.videoParserApiKey,
      apiEndpoint: settings.videoParserEndpoint,
    });
  }

  return { success: false, errorMessage: '真实视频解析需在桌面客户端中运行。' };
}

export async function testLLMConnectionClient(
  settings: AppSettings
): Promise<{ success: boolean; message: string }> {
  if (window.electronAPI) {
    return await window.electronAPI.testLLMConnection({
      apiKey: settings.llmApiKey,
      baseURL: settings.llmBaseUrl,
      model: settings.llmModel,
    });
  }

  if (!settings.llmApiKey.trim()) {
    return {
      success: false,
      message: '请先输入有效的模型接口密钥。',
    };
  }

  try {
    const start = Date.now();
    const res = await fetch(
      `${settings.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.llmApiKey.trim()}`,
        },
        body: JSON.stringify({
          model: settings.llmModel.trim() || 'deepseek-chat',
          messages: [{ role: 'user', content: '请回复：连接成功' }],
          max_tokens: 12,
        }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const latency = Date.now() - start;
    return {
      success: true,
      message: `连接成功！模型 ${settings.llmModel} 响应正常（耗时 ${latency}ms）`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `连接测试未通过（${err?.message || '跨域或密钥错误'}）。在 Electron 桌面端中将由 Node.js 主进程直接请求。`,
    };
  }
}

export async function streamGenerateScriptClient(params: {
  settings: AppSettings;
  systemPrompt: string;
  userPrompt: string;
  conversationHistory?: ConversationTurn[];
  targetDurationSec: number;
  userCameraWork: string;
  companyBusinessProfile?: string;
  brandKeywords?: string[];
  refinementInstruction?: string;
  onChunk: (chunk: string) => void;
}): Promise<{ success: boolean; fullText?: string; error?: string }> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (window.electronAPI) {
    const offChunk = window.electronAPI.onStreamChunk((data) => {
      if (data.requestId === requestId) {
        params.onChunk(data.chunk);
      }
    });

    try {
      const result = await window.electronAPI.generateScriptStream({
        requestId,
        config: {
          apiKey: params.settings.llmApiKey,
          baseURL: params.settings.llmBaseUrl,
          model: params.settings.llmModel,
        },
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        conversationHistory: params.conversationHistory,
        targetDurationSec: params.targetDurationSec,
        userCameraWork: params.userCameraWork,
        companyBusinessProfile: params.companyBusinessProfile,
        brandKeywords: params.brandKeywords,
        refinementInstruction: params.refinementInstruction,
      });
      return result;
    } finally {
      offChunk();
    }
  }

  return { success: false, error: '真实模型生成需在桌面客户端中运行。' };
}

export async function exportScriptFileClient(
  defaultFilename: string,
  content: string,
  format: 'txt' | 'doc'
): Promise<boolean> {
  if (format === 'doc') {
    const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    content = '<!doctype html><html><head><meta charset="utf-8"></head><body><pre style="white-space:pre-wrap;font-family:SimSun">' + escaped + '</pre></body></html>';
  }
  if (window.electronAPI) {
    const res = await window.electronAPI.exportFile({
      defaultFilename,
      content,
      format,
    });
    return Boolean(res?.success);
  }

  const mimeType =
    format === 'doc'
      ? 'application/msword;charset=utf-8'
      : 'text/plain;charset=utf-8';
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
