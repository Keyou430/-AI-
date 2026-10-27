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
  VideoPlatform,
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
      deleteHistoryFromDB: (id: string) => Promise<{ success: boolean }>;
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
    return Boolean(res?.success);
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
function detectPlatformFromText(rawInput: string): {
  url: string | null;
  platform: VideoPlatform | null;
} {
  const match = rawInput.match(/https?:\/\/[^\s，。！？、；：“”‘’（）《》【】]+/i);
  const candidate = match ? match[0] : rawInput.trim();
  if (!/^https?:\/\//i.test(candidate)) {
    return { url: null, platform: null };
  }
  if (/douyin\.com|iesdouyin\.com/i.test(candidate)) {
    return { url: candidate, platform: 'douyin' };
  }
  if (/xiaohongshu\.com|xhslink\.(?:com|cn)/i.test(candidate)) {
    return { url: candidate, platform: 'xiaohongshu' };
  }
  return { url: candidate, platform: null };
}

export async function parseVideoLinkClient(
  rawInput: string,
  settings: AppSettings
): Promise<{
  success: boolean;
  data?: ParsedVideoInfo;
  errorMessage?: string;
  isMockData?: boolean;
}> {
  if (window.electronAPI) {
    return await window.electronAPI.parseVideo({
      rawInput,
      apiKey: settings.videoParserApiKey,
      apiEndpoint: settings.videoParserEndpoint,
      enableMockFallback: settings.enableMockFallback,
    });
  }

  if (!settings.enableMockFallback) {
    return { success: false, errorMessage: '真实视频解析需在桌面客户端中运行。' };
  }
  const { url, platform } = detectPlatformFromText(rawInput);
  if (!url) {
    return {
      success: false,
      errorMessage:
        '未检测到有效的视频链接，请粘贴包含 http:// 或 https:// 的抖音或小红书分享链接。',
    };
  }
  if (!platform) {
    return {
      success: false,
      errorMessage:
        '当前仅支持抖音（douyin.com）与小红书（xiaohongshu.com / xhslink.com / xhslink.cn）视频链接。',
    };
  }
  if (url.includes('quota-error')) {
    return {
      success: false,
      errorMessage: '第三方内容提取接口 额度已耗尽，请前往【设置页】更换有效的接口密钥。',
    };
  }

  await new Promise((r) => setTimeout(r, 450));
  if (platform === 'douyin') {
    return {
      success: true,
      isMockData: true,
      data: {
        platform: 'douyin',
        extractedUrl: url,
        title: '早八打工人3分钟消水肿冰美式制作与桌面效率好物分享',
        author: '阿泽的效率工坊',
        durationSec: 18,
        transcript:
          '每天早上起来脸肿得像发面馒头？别再喝普通速溶了！教你一招我连喝四周的消水肿冰萃法：先往杯子里加满八分冰块，倒入零脂椰子水垫底，再把双份浓缩咖啡沿着冰块慢慢淋上去。只需三十秒，不仅口感清爽回甘，上午开会脑子瞬间清醒！',
        visualSummary:
          '清晨阳光洒进极简办公桌，博主手持玻璃杯展示冰块落杯特写，随后注入清澈椰子水与深褐色浓缩咖啡形成漂亮分层，最后博主微笑举杯饮用并进入工作状态。',
        suggestedCameraWork: '近景俯拍、特写推进、中景平视跟随',
      },
    };
  }

  return {
    success: true,
    isMockData: true,
    data: {
      platform: 'xiaohongshu',
      extractedUrl: url,
      title: '小户型书房改造｜不到5平米打造高专注力极简工作角',
      author: '林木木家居笔记',
      durationSec: 20,
      transcript:
        '谁说房间小就不能拥有独立书房？只要抓住这三个核心动线，五平米角落也能变身效率天堂。第一，换掉笨重传统书桌，改用一米二悬浮升降桌释放腿部空间；第二，利用墙面洞洞板把零碎线材全部上墙；第三，加一盏高显色屏幕挂灯，晚上加班眼睛再也不酸涩。',
      visualSummary:
        '展示改造前杂乱拥挤的角落对比，随后通过升降桌升降、洞洞板收纳配件安装、暖光屏幕挂灯点亮三个连续动作展现清爽通透的桌面空间。',
      suggestedCameraWork: '广角平视横摇、近景侧面推轨、微距俯拍特写',
    },
  };
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
      message: '请先输入模型接口密钥（或保持开启「内置仿真模式」直接体验全流程）。',
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
        enableMockFallback: params.settings.enableMockFallback,
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

  if (!params.settings.enableMockFallback) {
    return { success: false, error: '真实模型生成需在桌面客户端中运行。' };
  }

  // 浏览器端流式模拟
  const totalSec = params.targetDurationSec > 0 ? params.targetDurationSec : 18;
  const seg1End = Math.max(4, Math.floor(totalSec * 0.28));
  const seg2End = Math.max(seg1End + 4, Math.floor(totalSec * 0.65));
  const cameraSpec =
    params.userCameraWork.trim() || '近景俯拍、特写推进、中景平视跟随';
  const brandWord =
    params.brandKeywords && params.brandKeywords.length > 0
      ? params.brandKeywords[0]
      : '零脂冷萃冻干咖啡';
  const bizDesc =
    params.companyBusinessProfile?.trim() ||
    '精品冷萃咖啡液与办公室便携冲调饮品';

  const mockLines = params.refinementInstruction
    ? [
        `【分镜脚本总览】共3个镜头，总时长${totalSec}秒`,
        `——————`,
        `【镜头1 | 0-${seg1End}秒】`,
        `▪️人员动作分工：出镜人员坐在自然光书桌前针对修改重点展示本公司${brandWord}，摄影师手持相机从桌面斜上方切入捕捉冰块落杯瞬间`,
        `▪️运镜与拍摄执行标准：景别为近景转特写，运镜手法采用${cameraSpec}，灯光为侧逆自然晨光配合柔光板补光，角度为四十五度俯拍角度`,
        `▪️声音内容：还在靠浓茶硬撑早八状态吗？结合咱们${bizDesc}，三十秒用${brandWord}搞定零脂冰萃特调！`,
        `——————`,
        `【镜头2 | ${seg1End}-${seg2End}秒】`,
        `▪️人员动作分工：出镜人员依次向玻璃杯内注入清澈椰子水与${brandWord}原液形成琥珀色分层，摄影师顺着水流方向同步平稳移动机位`,
        `▪️运镜与拍摄执行标准：景别为微距特写，运镜手法采用${cameraSpec}，灯光为侧向硬光突出液体通透质感，角度为平视微俯角`,
        `▪️声音内容：仅环境音，清脆的冰块碰撞声与咖啡液缓缓倾倒的流动声`,
        `——————`,
        `【镜头3 | ${seg2End}-${totalSec}秒】`,
        `▪️人员动作分工：出镜人员微笑举杯轻抿一口${brandWord}后翻开笔记本电脑进入专注工作状态，摄影师伴随人物动作自然向后拉远定格画面`,
        `▪️运镜与拍摄执行标准：景别为中景，运镜手法采用${cameraSpec}，灯光为柔和双侧主辅光，角度为正面平视角度`,
        `▪️声音内容：一口唤醒全天专注力，现在趁着桌面焕新季赶紧把${brandWord}安排上吧！`,
      ]
    : [
        `【分镜脚本总览】共3个镜头，总时长${totalSec}秒`,
        `——————`,
        `【镜头1 | 0-${seg1End}秒】`,
        `▪️人员动作分工：出镜人员在晨光办公桌前展示早起困倦状态随后拿出本公司核心产品${brandWord}，摄影师由桌面一侧向杯口方向平稳推进抓拍动作`,
        `▪️运镜与拍摄执行标准：景别为近景，运镜手法采用${cameraSpec}，灯光为柔和窗边自然光搭配暖色辅光，角度为四十五度俯视角度`,
        `▪️声音内容：每天早起状态困倦没精神？教你用咱们${brandWord}三十秒复刻高颜值消水肿冰美式！`,
        `——————`,
        `【镜头2 | ${seg1End}-${seg2End}秒】`,
        `▪️人员动作分工：出镜人员先倒入八分满零脂椰子水再沿冰块缓缓注入${brandWord}浓缩液展现本公司${bizDesc}品质细节，摄影师围绕杯身侧面捕捉液体分层光影变化`,
        `▪️运镜与拍摄执行标准：景别为特写，运镜手法采用${cameraSpec}，灯光为侧逆光勾勒杯壁水珠质感，角度为水平正侧角度`,
        `▪️声音内容：仅环境音，冰块撞击玻璃杯壁的清脆声与液体缓慢注入的流淌声`,
        `——————`,
        `【镜头3 | ${seg2End}-${totalSec}秒】`,
        `▪️人员动作分工：出镜人员拿起成品冰美式微笑品尝并顺势打开电脑开始高效办公，摄影师跟随人物抬手动作平滑移动至桌面全景`,
        `▪️运镜与拍摄执行标准：景别为中景，运镜手法采用${cameraSpec}，灯光为均匀主光加背景轮廓光，角度为正面平视角度`,
        `▪️声音内容：零脂轻负担且清甜回甘，让${brandWord}陪你开启高效专注的每一个工作日！`,
      ];

  const fullText = mockLines.join('\n');
  const chars = Array.from(fullText);
  for (let i = 0; i < chars.length; i += 5) {
    params.onChunk(chars.slice(i, i + 5).join(''));
    await new Promise((r) => setTimeout(r, 24));
  }
  return { success: true, fullText };
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
