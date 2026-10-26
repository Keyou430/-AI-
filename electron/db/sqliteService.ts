/**
 * [Phase 2 & Phase 3] SQLite 本地数据库持久化服务
 * - 统一管理 Phase 2 的 `history_records`（含多轮对话迭代快照）与 Phase 3 的 `knowledge_documents`（本地解析文档全文）
 * - 优先使用原生 `better-sqlite3`（WAL 模式）；若 Windows 环境无 C++ 编译工具则自动无缝切换至 `sql.js`（SQLite3 官方 WASM 引擎）
 * - 落盘生成标准二进制 `.sqlite` 文件：`app.getPath('userData')/video-remix-history.sqlite`
 */

import path from 'path';
import fs from 'fs';
import type { ParsedVideoData } from '../services/videoParser';

export interface DBRefinementVersion {
  id: string;
  round: number;
  instruction: string;
  timestamp: string;
  scriptSnapshot: string;
}

export interface DBHistoryRecord {
  id: string;
  platform: 'douyin' | 'xiaohongshu';
  sourceUrl: string;
  title: string;
  createdAt: string;
  durationSec: number;
  userCameraWork: string;
  originalTranscript: string;
  sourceContent?: ParsedVideoData;
  visualSummary: string;
  rawGeneratedScript: string;
  parsedStructure: any;
  refinementHistory: DBRefinementVersion[];
  conversationMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface DBKnowledgeDocument {
  id: string;
  name: string;
  filePath: string;
  fileType: string;
  sizeBytes: number;
  uploadedAt: string;
  contentSnippet: string;
  fullContent: string;
  charCount: number;
  enabled: boolean;
}

export interface HistoryQueryFilter {
  search?: string;
  platform?: 'all' | 'douyin' | 'xiaohongshu';
}

export interface DatabaseStatusInfo {
  engine: 'better-sqlite3' | 'sqlite3-wasm';
  dbPath: string;
  totalCount: number;
  knowledgeDocCount: number;
  dbSizeBytes: number;
}

export interface DBUser {
  id: string;
  username: string;
  password_hash: string;
  salt: string;
  display_name: string;
  role: 'admin' | 'member';
  is_active: number;
  created_at: string;
  last_login_at: string | null;
}

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS history_records (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  user_camera_work TEXT NOT NULL,
  original_transcript TEXT NOT NULL,
  visual_summary TEXT NOT NULL,
  raw_generated_script TEXT NOT NULL,
  parsed_structure_json TEXT NOT NULL,
  refinement_history_json TEXT NOT NULL DEFAULT '[]',
  conversation_messages_json TEXT NOT NULL DEFAULT '[]',
  source_content_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_platform ON history_records(platform);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  content_snippet TEXT NOT NULL,
  full_content TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);
`;

const SEED_DOUYIN_SCRIPT = [
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
  '▪️人员动作分工：出镜人员拿起成品冰美式微笑品尝并顺势打开电脑进入高效办公状态，摄影师跟随人物抬手动作平滑移动至桌面全景',
  '▪️运镜与拍摄执行标准：景别为中景，运镜手法采用近景俯拍、特写推进、中景平视跟随，灯光为均匀主光加背景轮廓光，角度为正面平视角度',
  '▪️声音内容：零脂轻负担且清甜回甘，学会这招让你的每个清晨都充满高效能量！',
].join('\n');

function buildSimpleParsedStructure(rawText: string, totalDurationSec: number) {
  const shotRegex =
    /【镜头\s*(\d+)\s*[|｜]\s*([^】]+)】([\s\S]*?)(?=【镜头\s*\d+|$)/g;
  const shots: any[] = [];
  let match: RegExpExecArray | null;
  while ((match = shotRegex.exec(rawText)) !== null) {
    const shotNumber = Number(match[1]);
    const timeRange = match[2].trim();
    const body = match[3].replace(/——————/g, '').trim();
    const timeNums = timeRange.match(/(\d+)\s*[-~至]\s*(\d+)/);
    const durationSec = timeNums
      ? Math.max(0, Number(timeNums[2]) - Number(timeNums[1]))
      : 6;
    const actionMatch = body.match(/▪️\s*人员动作分工[：:]([^▪️\n]+)/);
    const cameraMatch = body.match(/▪️\s*运镜与拍摄执行标准[：:]([^▪️\n]+)/);
    const audioMatch = body.match(/▪️\s*声音内容[：:]([^▪️\n]+)/);
    const audioContent = audioMatch ? audioMatch[1].trim() : '';
    const isAmbientOnly = audioContent.startsWith('仅环境音');

    shots.push({
      shotNumber,
      timeRange,
      durationSec,
      actionDivision: actionMatch ? actionMatch[1].trim() : '',
      cameraExecution: cameraMatch ? cameraMatch[1].trim() : '',
      audioContent,
      isAmbientOnly,
    });
  }

  return {
    rawText,
    totalShots: shots.length,
    totalDurationSec,
    shots,
    shootingTechniquesSummary: shots.map((s, idx) => ({
      shotNumber: s.shotNumber,
      timeRange: s.timeRange,
      cameraStandard: s.cameraExecution,
      transitionAdvice:
        idx < shots.length - 1
          ? `由镜头${s.shotNumber}动作尾帧自然切入镜头${s.shotNumber + 1}首帧，利用人物动线与光影变化衔接。`
          : '收尾镜头定格，保持自然呼吸感与环境光收束。',
    })),
    voiceoverFullText: shots
      .filter((s) => !s.isAmbientOnly)
      .map((s) => s.audioContent)
      .join('\n\n'),
    voiceoverSegments: shots.map((s) => ({
      shotNumber: s.shotNumber,
      timeRange: s.timeRange,
      content: s.audioContent,
      isAmbientOnly: s.isAmbientOnly,
    })),
  };
}

export class LocalSQLiteManager {
  constructor(private readonly dataDirectory: string, private readonly onEngineFallback?: (error: unknown) => void, private readonly seedDemoData = true) {}
  private dbPath: string = '';
  private engine: 'better-sqlite3' | 'sqlite3-wasm' = 'sqlite3-wasm';
  private nativeDb: any = null;
  private wasmDb: any = null;
  private initPromise: Promise<void> | null = null;

  public async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.initInternal();
    return this.initPromise;
  }

  private async initInternal(): Promise<void> {
    const userDataDir = this.dataDirectory;

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    this.dbPath = path.join(userDataDir, 'video-remix-history.sqlite');
    const isNewDatabase = !fs.existsSync(this.dbPath);

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const BetterSqlite3 = require('better-sqlite3');
      this.nativeDb = new BetterSqlite3(this.dbPath);
      this.nativeDb.pragma('journal_mode = WAL');
      this.nativeDb.exec(CREATE_TABLES_SQL);
      try {
        this.nativeDb.exec(
          `ALTER TABLE history_records ADD COLUMN conversation_messages_json TEXT NOT NULL DEFAULT '[]'`
        );
      } catch {
        // column already exists
      }
      try { this.nativeDb.exec('ALTER TABLE history_records ADD COLUMN source_content_json TEXT'); }
      catch { /* column already exists */ }
      this.engine = 'better-sqlite3';
    } catch (error) {
      this.onEngineFallback?.(error);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const initSqlJs = require('sql.js');
      const SQL = await initSqlJs();

      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.wasmDb = new SQL.Database(fileBuffer);
      } else {
        this.wasmDb = new SQL.Database();
      }
      this.wasmDb.run(CREATE_TABLES_SQL);
      try {
        this.wasmDb.run(
          `ALTER TABLE history_records ADD COLUMN conversation_messages_json TEXT NOT NULL DEFAULT '[]'`
        );
      } catch {
        // column already exists
      }
      try { this.wasmDb.run('ALTER TABLE history_records ADD COLUMN source_content_json TEXT'); }
      catch { /* column already exists */ }
      this.engine = 'sqlite3-wasm';
      this.flushWasmToDisk();
    }

    // 已存在的空表可能是用户主动清空的，仅首次创建数据库时写入示例。
    if (isNewDatabase && this.seedDemoData) {
      await this.seedInitialHistory();
      // 新设备知识库留空；已有数据库中的文档继续保留。
    }
  }

  private flushWasmToDisk(): void {
    if (this.wasmDb && this.dbPath) {
      const data = this.wasmDb.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    }
  }

  private async getTableCount(tableName: 'history_records' | 'knowledge_documents'): Promise<number> {
    if (this.engine === 'better-sqlite3' && this.nativeDb) {
      const row = this.nativeDb
        .prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`)
        .get();
      return Number(row?.cnt || 0);
    }
    if (this.wasmDb) {
      const res = this.wasmDb.exec(`SELECT COUNT(*) FROM ${tableName}`);
      return Number(res?.[0]?.values?.[0]?.[0] || 0);
    }
    return 0;
  }

  private async seedInitialHistory(): Promise<void> {
    const now = Date.now();
    const initialRecord: DBHistoryRecord = {
      id: 'sqlite_seed_douyin_1',
      platform: 'douyin',
      sourceUrl: 'https://v.douyin.com/iY8demo9/',
      title: '早八打工人3分钟消水肿冰美式制作与桌面效率好物分享',
      createdAt: new Date(now - 1000 * 60 * 30).toISOString(),
      durationSec: 18,
      userCameraWork: '近景俯拍、特写推进、中景平视跟随',
      originalTranscript:
        '每天早上起来脸肿得像发面馒头？别再喝普通速溶了！教你一招我连喝四周的消水肿冰萃法：先往杯子里加满八分冰块，倒入零脂椰子水垫底，再把双份浓缩咖啡沿着冰块慢慢淋上去。只需三十秒，不仅口感清爽回甘，上午开会脑子瞬间清醒！',
      visualSummary:
        '清晨阳光洒进极简办公桌，博主手持玻璃杯展示冰块落杯特写，随后注入清澈椰子水与深褐色浓缩咖啡形成漂亮分层，最后博主微笑举杯饮用并进入工作状态。',
      rawGeneratedScript: SEED_DOUYIN_SCRIPT,
      parsedStructure: buildSimpleParsedStructure(SEED_DOUYIN_SCRIPT, 18),
      refinementHistory: [
        {
          id: 'ver_1',
          round: 1,
          instruction: '初始结合本公司主营业务生成版本',
          timestamp: new Date(now - 1000 * 60 * 30).toISOString(),
          scriptSnapshot: SEED_DOUYIN_SCRIPT,
        },
      ],
      conversationMessages: [
        {
          role: 'assistant',
          content: SEED_DOUYIN_SCRIPT,
        },
      ],
    };

    this.writeRecord(initialRecord);
  }

  private async seedInitialKnowledgeDocs(): Promise<void> {
    const defaultFullContent = [
      '【企业品牌与产品知识库手册 V2.0】',
      '1. 公司主营业务定位：专注于年轻职场人群的精品冷萃咖啡液、零脂冻干咖啡粉与桌面即饮冲调方案。',
      '2. 核心产品卖点：采用零下40度FD宇航冻干锁鲜技术，保留现磨阿拉比卡豆95%以上风味香气；零蔗糖、零反式脂肪酸，3秒即溶冰水或椰子水。',
      '3. 短视频二创结合规范：当借势职场早八、居家改造、效率桌面或美食特调类热点视频时，需在前3秒保留原热点的痛点提问或视觉冲击钩子，在第1至第2个镜头中自然植入“3秒冷水即溶、漂亮琥珀色分层”的产品视觉爽点，口播强调“零脂轻负担、早八消水肿提神”。',
      '4. 严禁违规表达：严禁出现“全网第一、国家级、最顶级、包治百病”等极限词，画面严禁叠加任何花字或字幕。',
    ].join('\n');

    this.writeKnowledgeDoc({
      id: 'kb_seed_1',
      name: '企业产品卖点与短视频二创融合规范手册.txt',
      filePath: 'builtin://企业产品卖点与短视频二创融合规范手册.txt',
      fileType: 'txt',
      sizeBytes: Buffer.byteLength(defaultFullContent, 'utf-8'),
      uploadedAt: new Date(Date.now() - 86400000).toISOString(),
      contentSnippet: defaultFullContent.slice(0, 180).replace(/\s+/g, ' ') + '...',
      fullContent: defaultFullContent,
      charCount: defaultFullContent.length,
      enabled: true,
    });
  }

  private mapRowToRecord(row: any): DBHistoryRecord {
    let parsedStructure = {};
    let refinementHistory = [];
    let conversationMessages = [];
    let sourceContent: ParsedVideoData | undefined;
    try {
      const parsed = JSON.parse(row.source_content_json || 'null');
      if (parsed && typeof parsed === 'object' && typeof parsed.transcript === 'string') sourceContent = parsed;
    } catch { /* Older records have no extraction snapshot. */ }
    try {
      parsedStructure = JSON.parse(row.parsed_structure_json || '{}');
    } catch {
      parsedStructure = {};
    }
    try {
      refinementHistory = JSON.parse(row.refinement_history_json || '[]');
    } catch {
      refinementHistory = [];
    }
    try {
      conversationMessages = JSON.parse(row.conversation_messages_json || '[]');
    } catch {
      conversationMessages = [];
    }

    return {
      id: String(row.id),
      platform: row.platform === 'xiaohongshu' ? 'xiaohongshu' : 'douyin',
      sourceUrl: String(row.source_url || ''),
      title: String(row.title || ''),
      createdAt: String(row.created_at || ''),
      durationSec: Number(row.duration_sec || 18),
      userCameraWork: String(row.user_camera_work || ''),
      originalTranscript: String(row.original_transcript || ''),
      ...(sourceContent ? { sourceContent } : {}),
      visualSummary: String(row.visual_summary || ''),
      rawGeneratedScript: String(row.raw_generated_script || ''),
      parsedStructure,
      refinementHistory,
      conversationMessages,
    };
  }

  public async listRecords(filter?: HistoryQueryFilter): Promise<DBHistoryRecord[]> {
    await this.ensureInitialized();

    const search = filter?.search?.trim() || '';
    const platform =
      filter?.platform && filter.platform !== 'all' ? filter.platform : null;

    const conditions: string[] = [];
    const params: any[] = [];

    if (platform) {
      conditions.push('platform = ?');
      params.push(platform);
    }

    if (search) {
      conditions.push(
        '(title LIKE ? OR original_transcript LIKE ? OR raw_generated_script LIKE ?)'
      );
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM history_records ${whereClause} ORDER BY created_at DESC`;

    if (this.engine === 'better-sqlite3' && this.nativeDb) {
      const rows = this.nativeDb.prepare(sql).all(...params);
      return rows.map((r: any) => this.mapRowToRecord(r));
    }

    if (this.wasmDb) {
      const stmt = this.wasmDb.prepare(sql);
      stmt.bind(params);
      const records: DBHistoryRecord[] = [];
      while (stmt.step()) {
        records.push(this.mapRowToRecord(stmt.getAsObject()));
      }
      stmt.free();
      return records;
    }

    return [];
  }

  public async upsertRecord(record: DBHistoryRecord): Promise<DBHistoryRecord> {
    await this.ensureInitialized();
    return this.writeRecord(record);
  }

  private writeRecord(record: DBHistoryRecord): DBHistoryRecord {

    const sql = `
      INSERT OR REPLACE INTO history_records (
        id,
        platform,
        source_url,
        title,
        created_at,
        duration_sec,
        user_camera_work,
        original_transcript,
        visual_summary,
        raw_generated_script,
        parsed_structure_json,
        refinement_history_json,
        conversation_messages_json,
        source_content_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      record.id,
      record.platform,
      record.sourceUrl,
      record.title,
      record.createdAt,
      record.durationSec,
      record.userCameraWork,
      record.originalTranscript,
      record.visualSummary,
      record.rawGeneratedScript,
      JSON.stringify(record.parsedStructure || {}),
      JSON.stringify(record.refinementHistory || []),
      JSON.stringify(record.conversationMessages || []),
      record.sourceContent ? JSON.stringify(record.sourceContent) : null,
    ];

    if (this.engine === 'better-sqlite3' && this.nativeDb) {
      this.nativeDb.prepare(sql).run(...params);
    } else if (this.wasmDb) {
      this.wasmDb.run(sql, params);
      this.flushWasmToDisk();
    }

    return record;
  }

  public async deleteRecord(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const sql = `DELETE FROM history_records WHERE id = ?`;

    if (this.engine === 'better-sqlite3' && this.nativeDb) {
      this.nativeDb.prepare(sql).run(id);
      return true;
    }
    if (this.wasmDb) {
      this.wasmDb.run(sql, [id]);
      this.flushWasmToDisk();
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Phase 3: 知识库文档 SQLite 持久化操作
  // ==========================================================================
  public async listKnowledgeDocs(): Promise<DBKnowledgeDocument[]> {
    await this.ensureInitialized();
    const sql = `SELECT * FROM knowledge_documents ORDER BY uploaded_at DESC`;

    const mapRow = (row: any): DBKnowledgeDocument => ({
      id: String(row.id),
      name: String(row.name),
      filePath: String(row.file_path || ''),
      fileType: String(row.file_type || 'txt'),
      sizeBytes: Number(row.size_bytes || 0),
      uploadedAt: String(row.uploaded_at || ''),
      contentSnippet: String(row.content_snippet || ''),
      fullContent: String(row.full_content || row.content_snippet || ''),
      charCount: Number(row.char_count || 0),
      enabled: Boolean(row.enabled),
    });

    if (this.engine === 'better-sqlite3' && this.nativeDb) {
      return this.nativeDb.prepare(sql).all().map(mapRow);
    }
    if (this.wasmDb) {
      const stmt = this.wasmDb.prepare(sql);
      const docs: DBKnowledgeDocument[] = [];
      while (stmt.step()) {
        docs.push(mapRow(stmt.getAsObject()));
      }
      stmt.free();
      return docs;
    }
    return [];
  }

  public async upsertKnowledgeDoc(doc: DBKnowledgeDocument): Promise<DBKnowledgeDocument> {
    await this.ensureInitialized();
    return this.writeKnowledgeDoc(doc);
  }

  private writeKnowledgeDoc(doc: DBKnowledgeDocument): DBKnowledgeDocument {
    const sql = `
      INSERT OR REPLACE INTO knowledge_documents (
        id, name, file_path, file_type, size_bytes, uploaded_at,
        content_snippet, full_content, char_count, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      doc.id,
      doc.name,
      doc.filePath,
      doc.fileType,
      doc.sizeBytes,
      doc.uploadedAt,
      doc.contentSnippet,
      doc.fullContent,
      doc.charCount,
      doc.enabled ? 1 : 0,
    ];

    if (this.engine === 'better-sqlite3' && this.nativeDb) {
      this.nativeDb.prepare(sql).run(...params);
    } else if (this.wasmDb) {
      this.wasmDb.run(sql, params);
      this.flushWasmToDisk();
    }
    return doc;
  }

  public async toggleKnowledgeDoc(id: string, enabled: boolean): Promise<boolean> {
    await this.ensureInitialized();
    const sql = `UPDATE knowledge_documents SET enabled = ? WHERE id = ?`;
    if (this.engine === 'better-sqlite3' && this.nativeDb) {
      this.nativeDb.prepare(sql).run(enabled ? 1 : 0, id);
      return true;
    }
    if (this.wasmDb) {
      this.wasmDb.run(sql, [enabled ? 1 : 0, id]);
      this.flushWasmToDisk();
      return true;
    }
    return false;
  }

  public async deleteKnowledgeDoc(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const sql = `DELETE FROM knowledge_documents WHERE id = ?`;
    if (this.engine === 'better-sqlite3' && this.nativeDb) {
      this.nativeDb.prepare(sql).run(id);
      return true;
    }
    if (this.wasmDb) {
      this.wasmDb.run(sql, [id]);
      this.flushWasmToDisk();
      return true;
    }
    return false;
  }


  public listUsers(): DBUser[] {
    if (this.nativeDb) return this.nativeDb.prepare('SELECT * FROM users ORDER BY created_at, username').all();
    const statement = this.wasmDb.prepare('SELECT * FROM users ORDER BY created_at, username');
    const rows: DBUser[] = [];
    try {
      while (statement.step()) rows.push(statement.getAsObject() as unknown as DBUser);
    } finally {
      statement.free();
    }
    return rows;
  }

  public findUser(field: 'id' | 'username', value: string): DBUser | undefined {
    const column = field === 'id' ? 'id' : 'username';
    const sql = 'SELECT * FROM users WHERE ' + column + ' = ?';
    if (this.nativeDb) return this.nativeDb.prepare(sql).get(value);
    const statement = this.wasmDb.prepare(sql);
    try {
      statement.bind([value]);
      return statement.step() ? statement.getAsObject() as unknown as DBUser : undefined;
    } finally {
      statement.free();
    }
  }

  public saveUser(user: DBUser): void {
    const sql = `INSERT INTO users (id, username, password_hash, salt, display_name, role, is_active, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash, salt=excluded.salt,
        display_name=excluded.display_name, is_active=excluded.is_active, last_login_at=excluded.last_login_at`;
    const values = [user.id, user.username, user.password_hash, user.salt, user.display_name,
      user.role, user.is_active, user.created_at, user.last_login_at];
    if (this.nativeDb) this.nativeDb.prepare(sql).run(...values);
    else {
      this.wasmDb.run(sql, values);
      this.flushWasmToDisk();
    }
  }

  public close(): void {
    this.nativeDb?.close();
    if (this.wasmDb) {
      this.flushWasmToDisk();
      this.wasmDb.close();
    }
  }

  public async getDatabaseInfo(): Promise<DatabaseStatusInfo> {
    await this.ensureInitialized();
    const totalCount = await this.getTableCount('history_records');
    const knowledgeDocCount = await this.getTableCount('knowledge_documents');
    let dbSizeBytes = 0;
    try {
      if (fs.existsSync(this.dbPath)) {
        dbSizeBytes = fs.statSync(this.dbPath).size;
      }
    } catch {
      dbSizeBytes = 0;
    }
    return {
      engine: this.engine,
      dbPath: this.dbPath,
      totalCount,
      knowledgeDocCount,
      dbSizeBytes,
    };
  }
}
