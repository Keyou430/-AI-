-- 视频二创AI助手 Phase 2 & Phase 3 本地 SQLite 数据库表结构定义

-- 1. 历史生成记录表（含多轮对话迭代版本历史与业务结合上下文）
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
  conversation_messages_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_history_created_at ON history_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_platform ON history_records(platform);

-- 2. Phase 3 本地知识库文档解析存储表
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
