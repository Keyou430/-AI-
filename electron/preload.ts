import { contextBridge, ipcRenderer } from 'electron';
import type { PlatformType } from './services/trendingTypes';
import type { ImageTextDraft } from './services/imageTextTypes';

export interface StreamChunkEvent {
  requestId: string;
  chunk: string;
}

export interface StreamDoneEvent {
  requestId: string;
  fullText: string;
}

export interface StreamErrorEvent {
  requestId: string;
  error: string;
}

contextBridge.exposeInMainWorld('electronAPI', {
  getStorageLocation: () => ipcRenderer.invoke('storage:get'),
  chooseStorageLocation: () => ipcRenderer.invoke('storage:choose'),
  getProviderSettings: () => ipcRenderer.invoke('providers:get'),
  resetProviderSettings: () => ipcRenderer.invoke('providers:reset'),
  saveProviderSettings: (input: unknown) => ipcRenderer.invoke('providers:save', input),
  saveProviderModule: (input: unknown) => ipcRenderer.invoke('providers:save-module', input),
  testProviderModule: (input: unknown) => ipcRenderer.invoke('providers:test-module', input),
  getAuthStatus: () => ipcRenderer.invoke('auth:status'),
  openLogFolder: () => ipcRenderer.invoke('runtime:open-log-folder'),
  reportRuntimeError: (payload: { kind: 'error' | 'unhandled-rejection'; name?: string; stack?: string }) =>
    ipcRenderer.invoke('runtime:report-error', payload),
  setupAdmin: (input: { password: string; displayName: string }) => ipcRenderer.invoke('auth:setup', input),
  login: (input: { username: string; password: string }) => ipcRenderer.invoke('auth:login', input),
  logout: () => ipcRenderer.invoke('auth:logout'),
  verifyActive: () => ipcRenderer.invoke('auth:verify-active'),
  listUsers: () => ipcRenderer.invoke('auth:users'),
  createUser: (input: { username: string; password: string; displayName: string; role: 'admin' | 'member' }) => ipcRenderer.invoke('auth:create-user', input),
  setUserActive: (input: { userId: string; active: boolean }) => ipcRenderer.invoke('auth:set-active', input),
  deleteUser: (input: { userId: string }) => ipcRenderer.invoke('auth:delete-user', input),
  resetUserPassword: (input: { userId: string; password: string }) => ipcRenderer.invoke('auth:reset-password', input),
  onAuthRequired: (callback: (data: { message: string }) => void) => {
    const listener = (_event: unknown, data: { message: string }) => callback(data);
    ipcRenderer.on('auth:required', listener);
    return () => ipcRenderer.removeListener('auth:required', listener);
  },

  // Phase 1: 视频解析与大模型生成
  parseVideo: (payload: any) => ipcRenderer.invoke('video:parse', payload),
  testLLMConnection: (config: any) => ipcRenderer.invoke('llm:test-connection', config),
  generateScriptStream: (payload: any) => ipcRenderer.invoke('llm:generate-stream', payload),
  exportFile: (payload: { defaultFilename: string; content: string; format: 'txt' | 'doc' }) =>
    ipcRenderer.invoke('file:export', payload),

  getImageAssetLocation: () => ipcRenderer.invoke('image-text:storage:get'),
  chooseImageAssetLocation: () => ipcRenderer.invoke('image-text:storage:choose'),
  followDataImageAssetLocation: () => ipcRenderer.invoke('image-text:storage:follow'),
  getImageTextDeletionInfo: (id: string) => ipcRenderer.invoke('image-text:deletion-info', id),
  planImageText: (input: any) => ipcRenderer.invoke('image-text:plan', input),
  generateImageText: (input: any) => ipcRenderer.invoke('image-text:generate', input),
  cancelImageText: (taskId: string) => ipcRenderer.invoke('image-text:cancel', taskId),
  selectImageTextReferences: (kind: 'style' | 'scene', draft: ImageTextDraft) => ipcRenderer.invoke('image-text:references', { kind, draft }),
  readImageTextAsset: (id: string) => ipcRenderer.invoke('image-text:asset', id),
  listImageTextHistory: () => ipcRenderer.invoke('image-text:list'),
  saveImageTextHistory: (draft: any) => ipcRenderer.invoke('image-text:save', draft),
  deleteImageTextHistory: (id: string) => ipcRenderer.invoke('image-text:delete', id),
  exportImageText: (draft: any, forbiddenWords: string[] = []) => ipcRenderer.invoke('image-text:export', { draft, forbiddenWords }),

  // Phase 2: SQLite 本地历史记录接口
  listHistoryFromDB: (filter?: { search?: string; platform?: PlatformType }) =>
    ipcRenderer.invoke('db:history:list', filter),
  saveHistoryToDB: (record: any) => ipcRenderer.invoke('db:history:save', record),
  deleteHistoryFromDB: (id: string) => ipcRenderer.invoke('db:history:delete', id),
  getDatabaseInfo: () => ipcRenderer.invoke('db:history:info'),
  openDatabaseFolder: () => ipcRenderer.invoke('db:history:open-folder'),

  // Phase 3: 本地知识库文件读取与解析接口
  listKnowledgeDocsFromDB: () => ipcRenderer.invoke('kb:list'),
  selectAndParseKnowledgeFiles: () => ipcRenderer.invoke('kb:select-and-parse-files'),
  parseKnowledgeBuffer: (payload: { name: string; sizeBytes: number; base64Data: string }) =>
    ipcRenderer.invoke('kb:parse-buffer', payload),
  toggleKnowledgeDocInDB: (payload: { id: string; enabled: boolean }) =>
    ipcRenderer.invoke('kb:toggle', payload),
  deleteKnowledgeDocFromDB: (id: string) => ipcRenderer.invoke('kb:delete', id),

  // 行业热点与 AI 选题分析
  fetchHotspots: (payload?: { platform?: PlatformType; force?: boolean }) =>
    ipcRenderer.invoke('trending:fetch', payload),
  analyzeProfileWithLLM: (payload: { docSnippets: string[]; keywords: string[] }) =>
    ipcRenderer.invoke('trending:analyze-profile', payload),
  rankHotspotsWithLLM: (payload: { profile: any; candidates: any[] }) =>
    ipcRenderer.invoke('trending:rank', payload),
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),

  // 流式事件监听
  onStreamChunk: (callback: (data: StreamChunkEvent) => void) => {
    const listener = (_event: any, data: StreamChunkEvent) => callback(data);
    ipcRenderer.on('llm:stream-chunk', listener);
    return () => ipcRenderer.removeListener('llm:stream-chunk', listener);
  },
  onStreamDone: (callback: (data: StreamDoneEvent) => void) => {
    const listener = (_event: any, data: StreamDoneEvent) => callback(data);
    ipcRenderer.on('llm:stream-done', listener);
    return () => ipcRenderer.removeListener('llm:stream-done', listener);
  },
  onStreamError: (callback: (data: StreamErrorEvent) => void) => {
    const listener = (_event: any, data: StreamErrorEvent) => callback(data);
    ipcRenderer.on('llm:stream-error', listener);
    return () => ipcRenderer.removeListener('llm:stream-error', listener);
  },
});
