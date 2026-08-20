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
addColumnIfMissing('users', 'role', "TEXT DEFAULT 'senior'");
db.prepare("UPDATE users SET role = 'senior' WHERE role IS NULL OR role = ''").run();
// 风险评估档案：可由老人/家属逐步补充，缺失时模型必须降低可信度
addColumnIfMissing('users', 'education_level', 'INTEGER');
addColumnIfMissing('users', 'smoking_status', 'INTEGER');
addColumnIfMissing('users', 'cigarettes_per_day', 'REAL');
addColumnIfMissing('users', 'drinking_status', 'INTEGER');
addColumnIfMissing('users', 'drinking_frequency', 'REAL');
addColumnIfMissing('users', 'exercise_level', 'REAL');
addColumnIfMissing('users', 'self_rated_health', 'INTEGER');
addColumnIfMissing('users', 'chronic_diabetes', 'INTEGER');
addColumnIfMissing('users', 'chronic_heart', 'INTEGER');
addColumnIfMissing('users', 'chronic_stroke', 'INTEGER');
addColumnIfMissing('users', 'dyslipidemia', 'INTEGER');
addColumnIfMissing('users', 'lung_disease', 'INTEGER');
addColumnIfMissing('users', 'frailty_score', 'REAL');
addColumnIfMissing('users', 'fall_risk', 'INTEGER');
addColumnIfMissing('users', 'cognitive_status', "TEXT DEFAULT 'unknown'");
addColumnIfMissing('users', 'chronic_kidney', 'INTEGER');
addColumnIfMissing('users', 'family_history', 'TEXT');
addColumnIfMissing('users', 'sleep_quality', 'INTEGER');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS care_relationships (
    id INTEGER PRIMARY KEY,
    senior_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_role TEXT NOT NULL DEFAULT 'caregiver',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(senior_id, member_id)
  );
  CREATE INDEX IF NOT EXISTS idx_care_member ON care_relationships(member_id, status);

  CREATE TABLE IF NOT EXISTS care_invitations (
    id INTEGER PRIMARY KEY,
    senior_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_by INTEGER REFERENCES users(id),
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,                -- 指标类型，见 metric_defs
    value REAL NOT NULL,
    value2 REAL,
    unit TEXT,
    recorded_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',  -- manual | device | synthetic
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_metrics_user_type_time ON metrics(user_id, type, recorded_at DESC);

  CREATE TABLE IF NOT EXISTS metric_defs (
    type TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    value_type TEXT NOT NULL DEFAULT 'number',   -- number | dual | categorical
    min_value REAL,                              -- 物理合理下限（校验用）
    max_value REAL,                              -- 物理合理上限
    normal_min REAL,                             -- 正常区间下限（评分用）
    normal_max REAL,                             -- 正常区间上限
    frequency TEXT,                              -- 建议采集频率（提示用）
    ml_enabled INTEGER NOT NULL DEFAULT 1,       -- 是否可进入 ML 特征
    description TEXT,
    color TEXT NOT NULL DEFAULT '#F4A261',
    icon TEXT NOT NULL DEFAULT '测',
    sort INTEGER NOT NULL DEFAULT 0
  );

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

  CREATE TABLE IF NOT EXISTS action_requests (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_confirmation',
    confirmed_at TEXT,
    executed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_action_requests_user_status ON action_requests(user_id, status);

  CREATE TABLE IF NOT EXISTS followups (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_request_id INTEGER REFERENCES action_requests(id) ON DELETE SET NULL,
    metric_type TEXT,
    due_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    result_metric_id INTEGER REFERENCES metrics(id) ON DELETE SET NULL,
    result_note TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_followups_user_status ON followups(user_id, status, due_at);

  CREATE TABLE IF NOT EXISTS agent_actions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'suggested',
    confirmed_at TEXT,
    executed_at TEXT,
    followup_metric TEXT,
    followup_result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

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

  CREATE TABLE IF NOT EXISTS llm_call_logs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    chat_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL,
    latency_ms INTEGER,
    tool_calls TEXT,
    fallback_reason TEXT,
    graph_index_version TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_llm_logs_user_time ON llm_call_logs(user_id, created_at DESC);

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

  CREATE TABLE IF NOT EXISTS knowledge_source_reviews (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL,
    reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    reviewed_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(source_id, reviewer_id)
  );
  CREATE INDEX IF NOT EXISTS idx_knowledge_review_source ON knowledge_source_reviews(source_id, status);

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

// 兼容已有库：给 chat_messages 补置信度和证据列，确保刷新/新对话仍能显示可追溯依据
addColumnIfMissing('chat_messages', 'confidence', 'TEXT');
addColumnIfMissing('chat_messages', 'evidence', 'TEXT');
addColumnIfMissing('chat_messages', 'graph_evidence', 'TEXT');
addColumnIfMissing('chat_messages', 'provider', 'TEXT');
addColumnIfMissing('chat_messages', 'model', 'TEXT');
addColumnIfMissing('chat_messages', 'call_status', 'TEXT');
addColumnIfMissing('chat_messages', 'latency_ms', 'INTEGER');
addColumnIfMissing('chat_messages', 'tool_calls', 'TEXT');
addColumnIfMissing('chat_messages', 'fallback_reason', 'TEXT');
addColumnIfMissing('chat_messages', 'graph_index_version', 'TEXT');

// 兼容已有库：metrics 增加 device_id（可空，手动录入为 NULL）
addColumnIfMissing('metrics', 'device_id', 'INTEGER');
addColumnIfMissing('metrics', 'measurement_condition', 'TEXT');
addColumnIfMissing('metrics', 'data_quality', 'TEXT');
// 设备同步状态扩展
addColumnIfMissing('devices', 'battery_level', 'INTEGER');
addColumnIfMissing('devices', 'sync_error', 'TEXT');

// ============= 核心指标定义（单一数据源）=============
// 18 种核心指标 + ecg（历史展示保留，ml_enabled=0 不进 ML）
// source 语义：manual=用户手动录入 | device=真实设备采集 | synthetic=项目演示数据
const CORE_METRIC_DEFS = [
  // [type, name, unit, value_type, min, max, normal_min, normal_max, freq, ml, desc, color, icon, sort]
  ['bp',        '血压',          'mmHg',   'dual',        50, 250, 90, 139,  '1-2次/日', 1, '收缩压/舒张压，value2 存舒张压', '#F4A261', '压', 1],
  ['glucose',   '血糖',          'mmol/L', 'number',       1,  33,  4,   7,  '1-4次/日', 1, '空腹血糖', '#E0784E', '糖', 2],
  ['hr',        '心率',          'bpm',    'number',      20, 220, 60, 100,  '多次/日',  1, '静息心率', '#9C7BC9', '心', 3],
  ['sleep',     '睡眠',          'h',      'number',       0,  24,  7,   9,  '1次/日',   1, '夜间睡眠时长', '#9C7BC9', '眠', 4],
  ['spo2',      '血氧',          '%',      'number',      50, 100, 95, 100,  '多次/日',  1, '血氧饱和度', '#3E8E8E', '氧', 5],
  ['weight',    '体重',          'kg',     'number',      20, 200, 45,  90,  '1次/日',   1, '体重（BMI 在特征工程由 height+weight 推导，不入库）', '#F4A261', '重', 6],
  ['steps',     '步数',          '步',     'number',       0, 100000, 3000, 20000, '连续', 1, '每日步数', '#5A8045', '步', 7],
  ['temp',      '体温',          '°C',     'number',      30,  45, 36, 37.3, '1-2次/日', 1, '腋下体温', '#E0784E', '温', 8],
  ['resp',      '呼吸频率',      '次/分',  'number',       5,  60, 14,  20,  '按需',     1, '静息呼吸频率', '#3E8E8E', '呼', 9],
  ['grip',      '握力',          'kg',     'number',       0, 100, 20,  50,  '1次/月',   1, '手部握力（衰弱筛查参考）', '#5A8045', '握', 10],
  ['bodyfat',   '体脂率',        '%',      'number',       5,  70, 20,  35,  '1次/周',   1, '体脂百分比', '#F4A261', '脂', 11],
  ['waist',     '腰围',          'cm',     'number',      30, 200, 70,  95,  '1次/周',   1, '腰围（腹型肥胖筛查参考）', '#E0784E', '腰', 12],
  ['uricacid',  '尿酸',          'μmol/L', 'number',      50, 1200, 150, 420, '1次/月',   1, '血尿酸', '#E0784E', '尿', 13],
  ['cholesterol','胆固醇',       'mmol/L', 'number',       1,  20, 3.1, 5.7, '1次/月',   1, '总胆固醇', '#A04632', '胆', 14],
  ['hba1c',     '糖化血红蛋白',  '%',      'number',       3,  20,  4, 6.5,  '1次/季度', 1, '糖化血红蛋白（近 3 个月血糖均值指标）', '#A04632', '化', 15],
  ['ecg',       '心电',          '',       'categorical', null, null, null, null, '按需', 0, '定性结果：100=窦性，50=异常。仅展示，暂不进 ML', '#E0784E', '电', 16],
  ['egfr',       'eGFR',          'mL/min/1.73m²', 'number', 0, 200, 60, 200, '按医嘱', 0, '估算肾小球滤过率，需结合持续时间和尿白蛋白解释', '#3E8E8E', '肾', 17],
  ['creatinine', '肌酐',          'μmol/L', 'number', 10, 2000, 45, 110, '按医嘱', 0, '肾功能化验指标，需结合年龄、性别和医生评估', '#3E8E8E', '肌', 18],
  ['urine_albumin', '尿白蛋白',   'mg/g', 'number', 0, 10000, 0, 30, '按医嘱', 0, '尿白蛋白/肌酐比等肾脏风险监测指标', '#3E8E8E', '蛋', 19],
];

const upsertDef = db.prepare(`
  INSERT OR REPLACE INTO metric_defs
    (type, name, unit, value_type, min_value, max_value, normal_min, normal_max,
     frequency, ml_enabled, description, color, icon, sort)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const upsertDefs = db.transaction(() => {
  for (const d of CORE_METRIC_DEFS) upsertDef.run(...d);
});
upsertDefs();

export default db;
