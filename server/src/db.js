// 数据库连接 + schema 定义
// 使用 better-sqlite3 同步 API（无回调地狱，无异步开销）
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.DB_PATH || './data/app.db';

// 确保 data 目录存在
const dataDir = path.dirname(path.resolve(__dirname, '..', DB_FILE));
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(__dirname, '..', DB_FILE);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 帮助函数：安全添加列（已存在则跳过）
function addColumnIfMissing(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  }
}

// ============= Schema =============
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER,
    avatar_color TEXT,
    height REAL,                                   -- 身高（m），BMI 计算用
    emergency_name TEXT,                           -- 紧急联系人
    emergency_phone TEXT,
    notification_prefs TEXT,                       -- JSON: {quiet_hours, ...}
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);
// 兼容已有库：补字段
addColumnIfMissing('users', 'gender', "TEXT DEFAULT 'unknown'");
addColumnIfMissing('users', 'password', "TEXT NOT NULL DEFAULT '123456'");
addColumnIfMissing('users', 'height', 'REAL');
addColumnIfMissing('users', 'emergency_name', 'TEXT');
addColumnIfMissing('users', 'emergency_phone', 'TEXT');
addColumnIfMissing('users', 'notification_prefs', 'TEXT');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,                -- bp | glucose | hr | sleep | spo2 | ecg | weight | steps
    value REAL NOT NULL,
    value2 REAL,
    unit TEXT,
    recorded_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_metrics_user_type_time ON metrics(user_id, type, recorded_at DESC);

  CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    total_score INTEGER NOT NULL,
    subscores TEXT NOT NULL,
    adl INTEGER,
    iadl INTEGER,
    suggestions TEXT,
    summary TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_assess_user_time ON assessments(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    time TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'todo',
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_todos_user_date ON todos(user_id, date);

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'connected',
    last_sync TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    plan TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_user_time ON chat_messages(user_id, created_at);

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    metric_type TEXT,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_user_status ON alerts(user_id, status);

  CREATE TABLE IF NOT EXISTS knowledge_articles (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,             -- qa | topic | tip
    title TEXT NOT NULL,
    summary TEXT,
    body TEXT NOT NULL,                 -- Markdown
    tags TEXT,                          -- JSON 数组
    audience TEXT DEFAULT 'senior',     -- senior | caregiver
    view_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_knowledge_cat ON knowledge_articles(category);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS custom_metrics (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '自',
    color TEXT NOT NULL DEFAULT '#F4A261',
    ref_min REAL,
    ref_max REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_custom_metrics_user ON custom_metrics(user_id);
`);

// 兼容已有库：给 chat_messages 补 confidence 列
addColumnIfMissing('chat_messages', 'confidence', 'TEXT');

export default db;
