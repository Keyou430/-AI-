export type VideoPlatform = 'douyin' | 'xiaohongshu';

export type ActiveNavTab = 'workbench' | 'history' | 'settings' | 'accounts';

export interface ParsedVideoInfo {
  platform: VideoPlatform;
  extractedUrl: string;
  title: string;
  author: string;
  durationSec: number;
  transcript: string;
  visualSummary: string;
  suggestedCameraWork: string;
}

export interface StoryboardShot {
  shotNumber: number;
  timeRange: string;
  durationSec: number;
  actionDivision: string;       // ▪️人员动作分工
  cameraExecution: string;      // ▪️运镜与拍摄执行标准
  audioContent: string;         // ▪️声音内容
  isAmbientOnly: boolean;       // 是否为“仅环境音”
}

export interface ParsedScriptStructure {
  rawText: string;
  totalShots: number;
  totalDurationSec: number;
  shots: StoryboardShot[];
  shootingTechniquesSummary: Array<{
    shotNumber: number;
    timeRange: string;
    cameraStandard: string;
    transitionAdvice: string;
  }>;
  voiceoverFullText: string;
  voiceoverSegments: Array<{
    shotNumber: number;
    timeRange: string;
    content: string;
    isAmbientOnly: boolean;
  }>;
}

export interface ComplianceCheckItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface KnowledgeDocument {
  id: string;
  name: string;
  filePath?: string;
  fileType?: string;
  sizeBytes: number;
  uploadedAt: string;
  contentSnippet: string;
  fullContent: string;
  charCount?: number;
  enabled: boolean;
}

export interface KeywordTag {
  id: string;
  text: string;
  category: 'brand' | 'jargon' | 'forbidden';
}

export interface RefinementVersion {
  id: string;
  round: number;
  instruction: string;
  timestamp: string;
  scriptSnapshot: string;
  conversationMessages?: ConversationTurn[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface HistoryRecord {
  id: string;
  platform: VideoPlatform;
  sourceUrl: string;
  title: string;
  createdAt: string;
  durationSec: number;
  userCameraWork: string;
  originalTranscript: string;
  visualSummary: string;
  rawGeneratedScript: string;
  parsedStructure: ParsedScriptStructure;
  refinementHistory: RefinementVersion[];
  conversationMessages: ConversationTurn[];
}

export interface DatabaseStatusInfo {
  engine: 'better-sqlite3' | 'sqlite3-wasm' | 'browser-local';
  dbPath: string;
  totalCount: number;
  knowledgeDocCount?: number;
  dbSizeBytes: number;
}

export interface AppSettings {
  companyBusinessProfile: string;
  llmProvider: 'deepseek' | 'openai' | 'qwen' | 'doubao' | 'kimi' | 'custom';
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  videoParserApiKey: string;
  videoParserEndpoint: string;
  enableMockFallback: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthResult {
  success: boolean;
  user?: AuthUser;
  users?: AuthUser[];
  error?: string;
}
