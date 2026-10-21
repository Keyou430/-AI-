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
import {
  deleteHistoryRecordFromSQLite,
  deleteKnowledgeDocClient,
  fetchHistoryRecordsFromSQLite,
  fetchKnowledgeDocsClient,
  fetchSQLiteDatabaseInfo,
  saveHistoryRecordToSQLite,
  toggleKnowledgeDocClient,
} from '../services/ipcClient';

const INITIAL_SAMPLE_SCRIPT = [
  '【分镜脚本总览】共3个镜头，总时长18秒',
  '——————',
  '【镜头1 | 0-5秒】',
  '▪️人员动作分工：出镜人员在晨光办公桌前展示早起困倦状态随后拿出本公司核心产品零脂冷萃冻干咖啡，摄影师由桌面一侧向杯口方向平稳推进抓拍动作',
  '▪️运镜与拍摄执行标准：景别为近景，运镜手法采用近景俯拍、特写推进、中景平视跟随，灯光为柔和窗边自然光搭配暖色辅光，角度为四十五度俯视角度',
  '▪️声音内容：每天早起状态困倦没精神？教你用咱们零脂冷萃冻干咖啡三十秒复刻高颜值消水肿冰美式！',
  '——————',
  '【镜头2 | 5-11秒】',
  '▪️人员动作分工：出镜人员先倒入八分满零脂椰子水再沿冰块缓缓注入零脂冷萃冻干咖啡浓缩液展现本公司精品冷萃品质细节，摄影师围绕杯身侧面捕捉液体分层光影变化',
  '▪️运镜与拍摄执行标准：景别为特写，运镜手法采用近景俯拍、特写推进、中景平视跟随，灯光为侧逆光勾勒杯壁水珠质感，角度为水平正侧角度',
  '▪️声音内容：仅环境音，冰块撞击玻璃杯壁的清脆声与液体缓慢注入的流淌声',
  '——————',
  '【镜头3 | 11-18秒】',
  '▪️人员动作分工：出镜人员拿起成品冰美式微笑品尝并顺势打开电脑开始高效办公，摄影师跟随人物抬手动作平滑移动至桌面全景',
  '▪️运镜与拍摄执行标准：景别为中景，运镜手法采用近景俯拍、特写推进、中景平视跟随，灯光为均匀主光加背景轮廓光，角度为正面平视角度',
  '▪️声音内容：零脂轻负担且清甜回甘，让零脂冷萃冻干咖啡陪你开启高效专注的每一个工作日！',
].join('\n');

interface AppState {
  activeNav: ActiveNavTab;
  setActiveNav: (tab: ActiveNavTab) => void;

  // 工作台状态（支持全自动模式 + 仅提取手动修改后再二创模式）
  currentEditingHistoryId: string | null;
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
  saveCurrentToHistory: (isRefinementUpdate?: boolean) => Promise<void>;
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

const DEFAULT_PARSED_VIDEO: ParsedVideoInfo = {
  platform: 'douyin',
  extractedUrl: 'https://v.douyin.com/iY8demo9/',
  title: '早八打工人3分钟消水肿冰美式制作与桌面效率好物分享',
  author: '阿泽的效率工坊',
  durationSec: 18,
  transcript:
    '每天早上起来脸肿得像发面馒头？别再喝普通速溶了！教你一招我连喝四周的消水肿冰萃法：先往杯子里加满八分冰块，倒入零脂椰子水垫底，再把双份浓缩咖啡沿着冰块慢慢淋上去。只需三十秒，不仅口感清爽回甘，上午开会脑子瞬间清醒！',
  visualSummary:
    '清晨阳光洒进极简办公桌，博主手持玻璃杯展示冰块落杯特写，随后注入清澈椰子水与深褐色浓缩咖啡形成漂亮分层，最后博主微笑举杯饮用并进入工作状态。',
  suggestedCameraWork: '近景俯拍、特写推进、中景平视跟随',
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeNav: 'workbench',
      setActiveNav: (tab) => {
        set({ activeNav: tab });
        if (tab === 'history') {
          get().loadHistoryFromSQLite();
        } else if (tab === 'settings') {
          get().loadKnowledgeDocsFromSQLite();
        }
      },

      currentEditingHistoryId: null,
      linkInput: 'https://v.douyin.com/iY8demo9/ 早八打工人3分钟消水肿冰美式制作分享',
      setLinkInput: (val) => set({ linkInput: val }),
      targetDurationSec: 18,
      setTargetDurationSec: (sec) => set({ targetDurationSec: sec }),
      userCameraWork: '近景俯拍、特写推进、中景平视跟随',
      setUserCameraWork: (val) => set({ userCameraWork: val }),

      isParsingVideo: false,
      setIsParsingVideo: (loading) => set({ isParsingVideo: loading }),
      parseError: null,
      setParseError: (err) => set({ parseError: err }),
      parsedVideo: DEFAULT_PARSED_VIDEO,
      setParsedVideo: (info) =>
        set({
          parsedVideo: info,
          editedTranscript: info?.transcript || '',
          editedVisualSummary: info?.visualSummary || '',
        }),

      editedTranscript: DEFAULT_PARSED_VIDEO.transcript,
      setEditedTranscript: (val) => set({ editedTranscript: val }),
      editedVisualSummary: DEFAULT_PARSED_VIDEO.visualSummary,
      setEditedVisualSummary: (val) => set({ editedVisualSummary: val }),
      resetEditedToOriginal: () => {
        const orig = get().parsedVideo;
        if (orig) {
          set({
            editedTranscript: orig.transcript,
            editedVisualSummary: orig.visualSummary,
          });
        }
      },

      isGeneratingScript: false,
      setIsGeneratingScript: (loading) => set({ isGeneratingScript: loading }),
      generateError: null,
      setGenerateError: (err) => set({ generateError: err }),
      streamingScriptText: INITIAL_SAMPLE_SCRIPT,
      setStreamingScriptText: (text) => set({ streamingScriptText: text }),
      appendStreamingChunk: (chunk) =>
        set((state) => {
          const nextText = state.streamingScriptText + chunk;
          return {
            streamingScriptText: nextText,
            parsedScript: parseGeneratedScript(nextText),
          };
        }),

      parsedScript: parseGeneratedScript(INITIAL_SAMPLE_SCRIPT),
      syncParsedScriptFromText: (rawText) =>
        set({
          streamingScriptText: rawText,
          parsedScript: parseGeneratedScript(rawText),
        }),

      conversationMessages: [
        { role: 'assistant', content: INITIAL_SAMPLE_SCRIPT },
      ],
      setConversationMessages: (msgs) => set({ conversationMessages: msgs }),
      refinementHistory: [
        {
          id: 'init_v1',
          round: 1,
          instruction: '初始结合本公司业务与知识库生成版本',
          timestamp: new Date().toISOString(),
          scriptSnapshot: INITIAL_SAMPLE_SCRIPT,
        },
      ],
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
          const { historySearchQuery, historyFilterPlatform, selectedHistoryId } =
            get();
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

      saveCurrentToHistory: async (isRefinementUpdate = false) => {
        const state = get();
        if (!state.parsedVideo || !state.streamingScriptText.trim()) return;

        const parsedStructure = parseGeneratedScript(state.streamingScriptText);
        const recordId =
          isRefinementUpdate && state.currentEditingHistoryId
            ? state.currentEditingHistoryId
            : `sqlite_${Date.now()}`;

        const recordToSave: HistoryRecord = {
          id: recordId,
          platform: state.parsedVideo.platform,
          sourceUrl: state.parsedVideo.extractedUrl,
          title: state.parsedVideo.title || '短视频二创脚本',
          createdAt: new Date().toISOString(),
          durationSec: state.targetDurationSec,
          userCameraWork: state.userCameraWork,
          originalTranscript:
            state.editedTranscript || state.parsedVideo.transcript,
          visualSummary:
            state.editedVisualSummary,
          rawGeneratedScript: state.streamingScriptText,
          parsedStructure,
          refinementHistory: [...state.refinementHistory],
          conversationMessages: [...state.conversationMessages],
        };

        await saveHistoryRecordToSQLite(recordToSave);
        set({ currentEditingHistoryId: recordId, selectedHistoryId: recordId });
        await get().loadHistoryFromSQLite();
      },

      deleteHistoryRecord: async (id) => {
        await deleteHistoryRecordFromSQLite(id);
        await get().loadHistoryFromSQLite();
      },

      loadHistoryToWorkbench: (record) =>
        set({
          activeNav: 'workbench',
          currentEditingHistoryId: record.id,
          linkInput: record.sourceUrl,
          targetDurationSec: record.durationSec,
          userCameraWork: record.userCameraWork,
          parsedVideo: {
            platform: record.platform,
            extractedUrl: record.sourceUrl,
            title: record.title,
            author: 'SQLite 历史记录回填',
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
        }),

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

      keywords: [
        { id: 'kw_1', text: '零脂冷萃冻干咖啡', category: 'brand' },
        { id: 'kw_2', text: '3秒冷水即溶', category: 'jargon' },
        { id: 'kw_3', text: '早八消水肿提神', category: 'jargon' },
        { id: 'kw_4', text: '第一、最顶级、绝对有效', category: 'forbidden' },
      ],
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
        companyBusinessProfile:
          '主营精品零脂冷萃冻干咖啡与办公室便携冲调饮品，主打3秒冷水即溶、零蔗糖轻负担与早八高效提神场景',
        llmProvider: 'deepseek',
        llmApiKey: '',
        llmBaseUrl: 'https://api.deepseek.com/v1',
        llmModel: 'deepseek-chat',
        videoParserApiKey: '',
        videoParserEndpoint: '',
        enableMockFallback: true,
      },
      updateSettings: (partial) =>
        set((state) => ({
          settings: { ...state.settings, ...partial },
        })),
    }),
    {
      name: 'video-remix-ai-full-v3-storage',
      partialize: (state) => ({
        linkInput: state.linkInput,
        targetDurationSec: state.targetDurationSec,
        userCameraWork: state.userCameraWork,
        keywords: state.keywords,
        settings: state.settings,
      }),
    }
  )
);
