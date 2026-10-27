import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  ActiveNavTab,
  AppSettings,
  ConversationTurn,
  DatabaseStatusInfo,
  HistoryRecord,
  KeywordTag,
  KnowledgeDocument,
  ParsedScriptStructure,
  ParsedVideoInfo,
  RefinementVersion,
} from '../types';
import { parseGeneratedScript } from '../lib/scriptParser';
import { getEditableSourceText } from '../lib/extractedContent';
import {
  deleteHistoryRecordFromSQLite,
  deleteKnowledgeDocClient,
  fetchHistoryRecordsFromSQLite,
  fetchKnowledgeDocsClient,
  fetchSQLiteDatabaseInfo,
  saveHistoryRecordToSQLite,
  toggleKnowledgeDocClient,
} from '../services/ipcClient';

// 丢弃旧版仿真开关和明文密钥，不改动已保存的用户内容。
function sanitizeStoredSettings(settings: AppSettings): AppSettings {
  const sanitized: AppSettings & { enableMockFallback?: unknown } = { ...settings, llmApiKey: '', videoParserApiKey: '' };
  delete sanitized.enableMockFallback;
  return sanitized;
}

type SettingsTab = 'content' | 'system';

interface AppState {
  activeNav: ActiveNavTab;
  sidebarCollapsed: boolean | null;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveNav: (tab: ActiveNavTab, settingsTab?: SettingsTab) => void;
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;

  // 工作台状态（支持全自动模式 + 仅提取手动修改后再二创模式）
  currentEditingHistoryId: string | null;
  workbenchRevision: number;
  linkInput: string;
  setLinkInput: (val: string) => void;
  targetDurationSec: number;
  setTargetDurationSec: (sec: number) => void;
  userCameraWork: string;
  setUserCameraWork: (val: string) => void;

  isParsingVideo: boolean;
  setIsParsingVideo: (loading: boolean) => void;
  parseError: string | null;
  setParseError: (err: string | null) => void;
  parsedVideo: ParsedVideoInfo | null;
  setParsedVideo: (info: ParsedVideoInfo | null) => void;

  // 左侧可编辑文案与画面描述状态（支持手动修改与一键还原）
  editedTranscript: string;
  setEditedTranscript: (val: string) => void;
  editedVisualSummary: string;
  setEditedVisualSummary: (val: string) => void;
  resetEditedToOriginal: () => void;

  isGeneratingScript: boolean;
  setIsGeneratingScript: (loading: boolean) => void;
  generateError: string | null;
  setGenerateError: (err: string | null) => void;
  streamingScriptText: string;
  setStreamingScriptText: (text: string) => void;
  appendStreamingChunk: (chunk: string) => void;

  parsedScript: ParsedScriptStructure | null;
  syncParsedScriptFromText: (rawText: string) => void;

  // Phase 3: 多轮对话上下文与迭代历史快照
  conversationMessages: ConversationTurn[];
  setConversationMessages: (msgs: ConversationTurn[]) => void;
  refinementHistory: RefinementVersion[];
  addRefinementVersion: (instruction: string, scriptSnapshot: string) => void;
  rollbackToVersion: (version: RefinementVersion) => void;
  clearRefinementHistory: () => void;

  // Phase 2: SQLite 历史记录与数据库状态
  historyRecords: HistoryRecord[];
  isLoadingHistory: boolean;
  selectedHistoryId: string | null;
  dbStatusInfo: DatabaseStatusInfo | null;
  historyFilterPlatform: 'all' | 'douyin' | 'xiaohongshu';
  historySearchQuery: string;
  setSelectedHistoryId: (id: string | null) => void;
  setHistoryFilterPlatform: (platform: 'all' | 'douyin' | 'xiaohongshu') => void;
  setHistorySearchQuery: (q: string) => void;
  loadHistoryFromSQLite: () => Promise<void>;
  saveGeneratedHistory: (record: HistoryRecord, workbenchRevision: number) => Promise<void>;
  deleteHistoryRecord: (id: string) => Promise<void>;
  loadHistoryToWorkbench: (record: HistoryRecord) => void;

  // Phase 3: 本地知识库文档与公司业务关键词配置
  knowledgeDocs: KnowledgeDocument[];
  loadKnowledgeDocsFromSQLite: () => Promise<void>;
  addKnowledgeDocToState: (doc: KnowledgeDocument) => void;
  removeKnowledgeDoc: (id: string) => Promise<void>;
  toggleKnowledgeDoc: (id: string) => Promise<void>;

  keywords: KeywordTag[];
  addKeyword: (text: string, category: KeywordTag['category']) => void;
  removeKeyword: (id: string) => void;

  // API 与公司业务设置
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeNav: 'workbench',
      sidebarCollapsed: null,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      settingsTab: 'content',
      setSettingsTab: (tab) => set({ settingsTab: tab }),
      setActiveNav: (tab, settingsTab = 'content') => {
        set({ activeNav: tab, ...(tab === 'settings' ? { settingsTab } : {}) });
        if (tab === 'history') {
          get().loadHistoryFromSQLite();
        } else if (tab === 'settings') {
          get().loadKnowledgeDocsFromSQLite();
        }
      },

      currentEditingHistoryId: null,
      workbenchRevision: 0,
      linkInput: '',
      setLinkInput: (val) => set({ linkInput: val }),
      targetDurationSec: 18,
      setTargetDurationSec: (sec) => set({ targetDurationSec: sec }),
      userCameraWork: '',
      setUserCameraWork: (val) => set({ userCameraWork: val }),

      isParsingVideo: false,
      setIsParsingVideo: (loading) => set({ isParsingVideo: loading }),
      parseError: null,
      setParseError: (err) => set({ parseError: err }),
      parsedVideo: null,
      setParsedVideo: (info) =>
        set((state) => ({
          workbenchRevision: state.workbenchRevision + 1,
          currentEditingHistoryId: null,
          parsedVideo: info ? { ...info } : null,
          editedTranscript: getEditableSourceText(info),
          editedVisualSummary: info?.visualSummary || '',
          conversationMessages: [], refinementHistory: [],
          streamingScriptText: '', parsedScript: parseGeneratedScript(''),
        })),

      editedTranscript: '',
      setEditedTranscript: (val) => set({ editedTranscript: val }),
      editedVisualSummary: '',
      setEditedVisualSummary: (val) => set({ editedVisualSummary: val }),
      resetEditedToOriginal: () => {
        const orig = get().parsedVideo;
        if (orig) {
          set({
            editedTranscript: getEditableSourceText(orig),
            editedVisualSummary: orig.visualSummary,
          });
        }
      },

      isGeneratingScript: false,
      setIsGeneratingScript: (loading) => set({ isGeneratingScript: loading }),
      generateError: null,
      setGenerateError: (err) => set({ generateError: err }),
      streamingScriptText: '',
      setStreamingScriptText: (text) => set({ streamingScriptText: text }),
      appendStreamingChunk: (chunk) =>
        set((state) => {
          const nextText = state.streamingScriptText + chunk;
          return {
            streamingScriptText: nextText,
            parsedScript: parseGeneratedScript(nextText),
          };
        }),

      parsedScript: parseGeneratedScript(''),
      syncParsedScriptFromText: (rawText) =>
        set({
          streamingScriptText: rawText,
          parsedScript: parseGeneratedScript(rawText),
        }),

      conversationMessages: [],
      setConversationMessages: (msgs) => set({ conversationMessages: msgs }),
      refinementHistory: [],
      addRefinementVersion: (instruction, scriptSnapshot) =>
        set((state) => {
          const nextRound = state.refinementHistory.length + 1;
          return {
            refinementHistory: [
              ...state.refinementHistory,
              {
                id: `ver_${Date.now()}`,
                round: nextRound,
                instruction,
                timestamp: new Date().toISOString(),
                scriptSnapshot,
                conversationMessages: state.conversationMessages.map((turn) => ({ ...turn })),
              },
            ],
          };
        }),
      rollbackToVersion: (version) =>
        set((state) => {
          const index = state.refinementHistory.findIndex((item) => item.id === version.id);
          if (index < 0) return state;
          const refinementHistory = state.refinementHistory.slice(0, index + 1);
          return {
            workbenchRevision: state.workbenchRevision + 1,
            streamingScriptText: version.scriptSnapshot,
            parsedScript: parseGeneratedScript(version.scriptSnapshot),
            conversationMessages: version.conversationMessages?.map((turn) => ({ ...turn })) || refinementHistory.flatMap((item) => [
              { role: 'user' as const, content: item.instruction },
              { role: 'assistant' as const, content: item.scriptSnapshot },
            ]),
          };
        }),
      clearRefinementHistory: () =>
        set({ refinementHistory: [], conversationMessages: [] }),

      // Phase 2: SQLite 历史记录
      historyRecords: [],
      isLoadingHistory: false,
      selectedHistoryId: null,
      dbStatusInfo: null,
      historyFilterPlatform: 'all',
      historySearchQuery: '',

      setSelectedHistoryId: (id) => set({ selectedHistoryId: id }),
      setHistoryFilterPlatform: (platform) => {
        set({ historyFilterPlatform: platform });
        get().loadHistoryFromSQLite();
      },
      setHistorySearchQuery: (q) => {
        set({ historySearchQuery: q });
        get().loadHistoryFromSQLite();
      },

      loadHistoryFromSQLite: async () => {
        set({ isLoadingHistory: true });
        try {
          const { historySearchQuery, historyFilterPlatform } = get();
          const [records, dbInfo] = await Promise.all([
            fetchHistoryRecordsFromSQLite({
              search: historySearchQuery,
              platform: historyFilterPlatform,
            }),
            fetchSQLiteDatabaseInfo(),
          ]);

          const hydratedRecords = records.map((rec) => ({
            ...rec,
            parsedStructure:
              rec.parsedStructure && rec.parsedStructure.shots
                ? rec.parsedStructure
                : parseGeneratedScript(rec.rawGeneratedScript),
          }));

          const { selectedHistoryId } = get();
          const nextSelected =
            selectedHistoryId &&
            hydratedRecords.some((r) => r.id === selectedHistoryId)
              ? selectedHistoryId
              : hydratedRecords[0]?.id || null;

          set({
            historyRecords: hydratedRecords,
            selectedHistoryId: nextSelected,
            dbStatusInfo: dbInfo,
            isLoadingHistory: false,
          });
        } catch {
          set({ isLoadingHistory: false });
        }
      },

      saveGeneratedHistory: async (record, workbenchRevision) => {
        await saveHistoryRecordToSQLite(record);
        // 保存期间允许打开其他记录，但不能把当前工作台重新绑定到旧请求。
        if (get().workbenchRevision === workbenchRevision) {
          set({ currentEditingHistoryId: record.id, selectedHistoryId: record.id });
        }
        await get().loadHistoryFromSQLite();
      },

      deleteHistoryRecord: async (id) => {
        await deleteHistoryRecordFromSQLite(id);
        await get().loadHistoryFromSQLite();
      },

      loadHistoryToWorkbench: (record) =>
        set((state) => ({
          workbenchRevision: state.workbenchRevision + 1,
          activeNav: 'workbench',
          currentEditingHistoryId: record.id,
          linkInput: record.sourceUrl,
          targetDurationSec: record.durationSec,
          userCameraWork: record.userCameraWork,
          parsedVideo: record.sourceContent ? { ...record.sourceContent } : {
            platform: record.platform,
            extractedUrl: record.sourceUrl,
            title: record.title,
            author: '历史记录恢复',
            durationSec: record.durationSec,
            transcript: record.originalTranscript,
            visualSummary: record.visualSummary,
            suggestedCameraWork: record.userCameraWork,
          },
          editedTranscript: record.originalTranscript,
          editedVisualSummary: record.visualSummary,
          streamingScriptText: record.rawGeneratedScript,
          parsedScript:
            record.parsedStructure && record.parsedStructure.shots
              ? record.parsedStructure
              : parseGeneratedScript(record.rawGeneratedScript),
          refinementHistory: [...(record.refinementHistory || [])],
          conversationMessages: [...(record.conversationMessages || [])],
          parseError: null,
          generateError: null,
        })),

      // Phase 3: 本地知识库文档管理
      knowledgeDocs: [],
      loadKnowledgeDocsFromSQLite: async () => {
        const docs = await fetchKnowledgeDocsClient();
        const dbInfo = await fetchSQLiteDatabaseInfo();
        set({ knowledgeDocs: docs, dbStatusInfo: dbInfo });
      },
      addKnowledgeDocToState: (doc) =>
        set((state) => ({
          knowledgeDocs: [doc, ...state.knowledgeDocs],
        })),
      removeKnowledgeDoc: async (id) => {
        await deleteKnowledgeDocClient(id);
        await get().loadKnowledgeDocsFromSQLite();
      },
      toggleKnowledgeDoc: async (id) => {
        const target = get().knowledgeDocs.find((d) => d.id === id);
        if (!target) return;
        await toggleKnowledgeDocClient(id, !target.enabled);
        await get().loadKnowledgeDocsFromSQLite();
      },

      keywords: [],
      addKeyword: (text, category) =>
        set((state) => {
          const trimmed = text.trim();
          if (!trimmed) return state;
          return {
            keywords: [
              ...state.keywords,
              { id: `kw_${Date.now()}`, text: trimmed, category },
            ],
          };
        }),
      removeKeyword: (id) =>
        set((state) => ({
          keywords: state.keywords.filter((k) => k.id !== id),
        })),

      settings: {
        companyBusinessProfile: '',
        llmProvider: 'deepseek',
        llmApiKey: '',
        llmBaseUrl: '',
        llmModel: '',
        videoParserApiKey: '',
        videoParserEndpoint: '',
      },
      updateSettings: (partial) =>
        set((state) => ({
          settings: { ...state.settings, ...partial },
        })),
    }),
    {
      name: 'video-remix-ai-full-v3-storage',
      version: 2,
      migrate: (stored: any) => ({ ...stored, settings: sanitizeStoredSettings(stored?.settings) }),
      merge: (stored: any, current) => ({ ...current, ...stored,
        settings: sanitizeStoredSettings({ ...current.settings, ...stored?.settings }) }),
      onRehydrateStorage: () => (state, error) => {
        if (state && !error) queueMicrotask(() => state.updateSettings({ llmApiKey: '', videoParserApiKey: '' }));
      },
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        linkInput: state.linkInput,
        parsedVideo: state.parsedVideo,
        editedTranscript: state.editedTranscript,
        editedVisualSummary: state.editedVisualSummary,
        targetDurationSec: state.targetDurationSec,
        userCameraWork: state.userCameraWork,
        keywords: state.keywords,
        settings: sanitizeStoredSettings(state.settings),
      }),
    }
  )
);
