// 数据库连接 + schema 定义
// 使用 better-sqlite3 同步 API（无回调地狱，无异步开销）
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { expandedKnowledgeArticles } from './lib/knowledgeExpansion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.DB_PATH || './data/app.db';

// 确保 data 目录存在
const dataDir = path.dirname(path.resolve(__dirname, '..', DB_FILE));
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(__dirname, '..', DB_FILE);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

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
addColumnIfMissing('users', 'password_algo', "TEXT DEFAULT 'legacy_plaintext'");
addColumnIfMissing('users', 'password_changed_at', 'TEXT');
addColumnIfMissing('users', 'login_failures', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'locked_until', 'TEXT');
addColumnIfMissing('users', 'last_failed_login_at', 'TEXT');
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
addColumnIfMissing('users', 'chronic_hypertension', 'INTEGER');
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

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    subject_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    resource TEXT,
    action TEXT,
    outcome TEXT NOT NULL,
    request_id TEXT,
    ip_hash TEXT,
    user_agent_hash TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id,created_at DESC);

  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    reset_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_auth_rate_reset ON auth_rate_limits(reset_at);

  CREATE TABLE IF NOT EXISTS privacy_export_events (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    format TEXT NOT NULL,
    status TEXT NOT NULL,
    byte_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_privacy_export_user_time ON privacy_export_events(user_id, created_at DESC);

  -- 注销后仅保留不可逆主体摘要和流程状态，不保留姓名、联系方式或健康内容。
  CREATE TABLE IF NOT EXISTS privacy_deletion_requests (
    id TEXT PRIMARY KEY,
    subject_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    categories TEXT NOT NULL DEFAULT '[]',
    expires_at TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    confirmed_at TEXT,
    completed_at TEXT,
    failure_code TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_privacy_deletion_status ON privacy_deletion_requests(status, requested_at DESC);

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
    review_status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    review_version TEXT,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TEXT,
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

  CREATE TABLE IF NOT EXISTS prediction_inputs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    value REAL NOT NULL,
    recorded_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_prediction_inputs_user_field_time
    ON prediction_inputs(user_id, field, recorded_at DESC);

  CREATE TABLE IF NOT EXISTS health_intakes (
    id INTEGER PRIMARY KEY,
    subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    respondent_role TEXT NOT NULL CHECK(respondent_role IN ('self','caregiver')),
    schema_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    scores TEXT NOT NULL DEFAULT '{}',
    recorded_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_health_intakes_subject_time
    ON health_intakes(subject_user_id, recorded_at DESC);

  CREATE TABLE IF NOT EXISTS health_intake_answers (
    id INTEGER PRIMARY KEY,
    intake_id INTEGER NOT NULL REFERENCES health_intakes(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    value TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(intake_id, question_id)
  );

  CREATE TABLE IF NOT EXISTS discovery_events (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    action TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id INTEGER,
    rule_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_discovery_events_user_time
    ON discovery_events(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_discovery_events_dedupe
    ON discovery_events(user_id, event_key, created_at DESC);
`);
addColumnIfMissing('sessions', 'last_seen_at', 'TEXT');
addColumnIfMissing('sessions', 'user_agent_hash', 'TEXT');
addColumnIfMissing('sessions', 'ip_hash', 'TEXT');
addColumnIfMissing('care_invitations', 'member_role', "TEXT NOT NULL DEFAULT 'caregiver'");
addColumnIfMissing('care_invitations', 'scopes', "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('care_invitations', 'relationship_expires_at', 'TEXT');
addColumnIfMissing('care_relationships', 'scopes', "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('care_relationships', 'valid_from', 'TEXT');
addColumnIfMissing('care_relationships', 'expires_at', 'TEXT');
addColumnIfMissing('care_relationships', 'revoked_at', 'TEXT');
addColumnIfMissing('care_relationships', 'revoked_by', 'INTEGER');
addColumnIfMissing('care_relationships', 'revoked_reason', 'TEXT');
addColumnIfMissing('care_relationships', 'last_access_at', 'TEXT');
addColumnIfMissing('care_relationships', 'updated_at', 'TEXT');
addColumnIfMissing('care_relationships', 'revision', 'INTEGER NOT NULL DEFAULT 1');
db.prepare(`UPDATE care_relationships SET valid_from=COALESCE(valid_from,created_at),updated_at=COALESCE(updated_at,created_at),revision=COALESCE(revision,1)`).run();

db.exec(`
  CREATE TABLE IF NOT EXISTS care_access_logs (
    id INTEGER PRIMARY KEY,
    relationship_id INTEGER REFERENCES care_relationships(id) ON DELETE SET NULL,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    subject_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    scope TEXT,
    outcome TEXT NOT NULL,
    resource TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_care_access_relationship_time ON care_access_logs(relationship_id,created_at DESC,id DESC);
  CREATE INDEX IF NOT EXISTS idx_care_access_subject_time ON care_access_logs(subject_user_id,created_at DESC,id DESC);

  CREATE TABLE IF NOT EXISTS intervention_clinical_reviews (
    id INTEGER PRIMARY KEY,
    intervention_db_id INTEGER NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
    relationship_id INTEGER NOT NULL REFERENCES care_relationships(id) ON DELETE CASCADE,
    reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('commented','approved_with_caution','needs_revision')),
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_intervention_reviews_plan_time ON intervention_clinical_reviews(intervention_db_id,created_at DESC,id DESC);

  CREATE TABLE IF NOT EXISTS graph_relationship_reviews (
    id INTEGER PRIMARY KEY,
    relation_index INTEGER NOT NULL,
    relationship_id INTEGER NOT NULL REFERENCES care_relationships(id) ON DELETE CASCADE,
    subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('approved_for_education','needs_revision','rejected')),
    notes TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(relation_index,relationship_id,reviewer_id)
  );
`);

// ============= 智能体 V2：对象绑定、分层记忆与可审计工具调用 =============
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_conversations (
    id INTEGER PRIMARY KEY,
    actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '新对话',
    summary TEXT NOT NULL DEFAULT '{}',
    summary_up_to_message_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
    legacy_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_agent_conversations_actor_subject
    ON agent_conversations(actor_user_id, subject_user_id, status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
    actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_request_id TEXT,
    intent TEXT NOT NULL DEFAULT '{}',
    context_manifest TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'running',
    latency_ms INTEGER,
    output_message_id INTEGER,
    error_code TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    completed_at TEXT,
    UNIQUE(actor_user_id, client_request_id)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation ON agent_runs(conversation_id, id DESC);

  CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    call_index INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    arguments TEXT NOT NULL DEFAULT '{}',
    dedupe_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    latency_ms INTEGER,
    error_code TEXT,
    result_manifest TEXT,
    result_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    completed_at TEXT,
    UNIQUE(run_id, dedupe_key)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls(run_id, call_index);

  CREATE TABLE IF NOT EXISTS agent_memories (
    id INTEGER PRIMARY KEY,
    subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    memory_key TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','confirmed','rejected','superseded')),
    source_message_id INTEGER,
    superseded_by INTEGER REFERENCES agent_memories(id) ON DELETE SET NULL,
    valid_until TEXT,
    confirmed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_agent_memories_subject_status
    ON agent_memories(subject_user_id, status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS agent_message_feedback (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
    actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating TEXT NOT NULL CHECK(rating IN ('like','dislike')),
    reason TEXT,
    intent TEXT NOT NULL DEFAULT '{}',
    presentation_mode TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(message_id,actor_user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_feedback_run ON agent_message_feedback(run_id, rating);
`);

// 兼容已有库：给 chat_messages 补置信度和证据列，确保刷新/新对话仍能显示可追溯依据
addColumnIfMissing('chat_messages', 'confidence', 'TEXT');
addColumnIfMissing('chat_messages', 'evidence', 'TEXT');
addColumnIfMissing('chat_messages', 'presentation', 'TEXT');
addColumnIfMissing('chat_messages', 'graph_evidence', 'TEXT');
addColumnIfMissing('chat_messages', 'prediction_snapshot', 'TEXT');
addColumnIfMissing('chat_messages', 'graph_evidence_snapshot', 'TEXT');
addColumnIfMissing('chat_messages', 'linkage_version', 'TEXT');
addColumnIfMissing('chat_messages', 'provider', 'TEXT');
addColumnIfMissing('chat_messages', 'model', 'TEXT');
addColumnIfMissing('chat_messages', 'call_status', 'TEXT');
addColumnIfMissing('chat_messages', 'latency_ms', 'INTEGER');
addColumnIfMissing('chat_messages', 'tool_calls', 'TEXT');
addColumnIfMissing('chat_messages', 'fallback_reason', 'TEXT');
addColumnIfMissing('chat_messages', 'graph_index_version', 'TEXT');
addColumnIfMissing('chat_messages', 'conversation_id', 'INTEGER');
addColumnIfMissing('chat_messages', 'actor_user_id', 'INTEGER');
addColumnIfMissing('chat_messages', 'subject_user_id', 'INTEGER');
addColumnIfMissing('chat_messages', 'client_request_id', 'TEXT');
addColumnIfMissing('chat_messages', 'parent_message_id', 'INTEGER');
addColumnIfMissing('chat_messages', 'supersedes_message_id', 'INTEGER');
addColumnIfMissing('chat_messages', 'run_id', 'INTEGER');

// 安全迁移：旧版可能把 LLM API Key 写入 settings。启动后立即移除密钥，仅保留非敏感元数据。
const legacyLlmConfig = db.prepare("SELECT value FROM settings WHERE key='llm_config'").get();
if (legacyLlmConfig) {
  try {
    const parsed = JSON.parse(legacyLlmConfig.value || '{}');
    const metadata = { base_url: parsed.base_url || '', model: parsed.model || '', secret_source: 'environment' };
    db.transaction(() => {
      db.prepare("DELETE FROM settings WHERE key='llm_config'").run();
      db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('llm_metadata',?,datetime('now','localtime'))
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now','localtime')`).run(JSON.stringify(metadata));
    })();
  } catch { db.prepare("DELETE FROM settings WHERE key='llm_config'").run(); }
}

// 单入口智能管家：知识文章审核信息。旧文章默认待审核，只能作为研究预览。
addColumnIfMissing('knowledge_articles', 'review_status', "TEXT NOT NULL DEFAULT 'pending'");
addColumnIfMissing('knowledge_articles', 'review_version', 'TEXT');
addColumnIfMissing('knowledge_articles', 'reviewed_by', 'INTEGER');
addColumnIfMissing('knowledge_articles', 'reviewed_at', 'TEXT');
addColumnIfMissing('knowledge_articles', 'source_label', 'TEXT');
addColumnIfMissing('knowledge_articles', 'source_url', 'TEXT');
db.prepare("UPDATE knowledge_articles SET review_status='pending' WHERE review_status IS NULL OR review_status NOT IN ('pending','approved','rejected')").run();

// 扩展知识幂等写入；服务器重启不会重复创建，旧数据库也能获得新增内容。
const insertExpandedArticle = db.prepare(`INSERT INTO knowledge_articles
  (category,title,summary,body,tags,audience,view_count,review_status,review_version,source_label,source_url)
  SELECT @category,@title,@summary,@body,@tags,@audience,@views,@review_status,@review_version,@source_label,@source_url
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_articles WHERE title=@title)`);
db.transaction(() => {
  for (const article of expandedKnowledgeArticles) insertExpandedArticle.run({ ...article, tags: JSON.stringify(article.tags) });
})();

// 旧对话按原 user_id 安全回填为本人历史会话，不删除、不改写原内容。
for (const row of db.prepare('SELECT DISTINCT user_id FROM chat_messages WHERE conversation_id IS NULL').all()) {
  const legacyKey = `legacy:user:${row.user_id}`;
  db.prepare(`INSERT INTO agent_conversations (actor_user_id,subject_user_id,title,legacy_key)
    VALUES (?,?,?,?) ON CONFLICT(legacy_key) DO NOTHING`).run(row.user_id, row.user_id, '历史对话', legacyKey);
  const conversation = db.prepare('SELECT id FROM agent_conversations WHERE legacy_key = ?').get(legacyKey);
  db.prepare(`UPDATE chat_messages SET conversation_id = ?, actor_user_id = COALESCE(actor_user_id,user_id),
    subject_user_id = COALESCE(subject_user_id,user_id) WHERE user_id = ? AND conversation_id IS NULL`).run(conversation.id, row.user_id);
}

addColumnIfMissing('action_requests', 'actor_user_id', 'INTEGER');
addColumnIfMissing('action_requests', 'subject_user_id', 'INTEGER');
addColumnIfMissing('action_requests', 'idempotency_key', 'TEXT');
db.prepare('UPDATE action_requests SET actor_user_id = COALESCE(actor_user_id,user_id), subject_user_id = COALESCE(subject_user_id,user_id)').run();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_action_requests_actor_idempotency ON action_requests(actor_user_id,idempotency_key) WHERE idempotency_key IS NOT NULL');

// 智能体 V3：结构化追问状态与可确认的复测随访闭环。
addColumnIfMissing('agent_conversations', 'dialogue_state', "TEXT NOT NULL DEFAULT '{}'");
addColumnIfMissing('agent_tool_calls', 'tool_version', 'TEXT');
addColumnIfMissing('agent_tool_calls', 'evidence_snapshot', 'TEXT');
addColumnIfMissing('agent_tool_calls', 'failure_reason', 'TEXT');
addColumnIfMissing('followups', 'actor_user_id', 'INTEGER');
addColumnIfMissing('followups', 'baseline_metric_id', 'INTEGER');
addColumnIfMissing('followups', 'candidate_metric_id', 'INTEGER');
addColumnIfMissing('followups', 'candidate_rejected_ids', "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('followups', 'todo_id', 'INTEGER');
addColumnIfMissing('followups', 'rule_version', 'TEXT');
addColumnIfMissing('followups', 'suggested_due_at', 'TEXT');
addColumnIfMissing('followups', 'comparison', 'TEXT');
addColumnIfMissing('followups', 'confirmed_by', 'INTEGER');
addColumnIfMissing('followups', 'updated_at', 'TEXT');
db.prepare(`UPDATE followups SET actor_user_id=COALESCE(actor_user_id,user_id),
  suggested_due_at=COALESCE(suggested_due_at,due_at),updated_at=COALESCE(updated_at,created_at)`).run();

// N-of-1 个体干预数据底座：复用 action_requests 的确认门槛、metrics 的基线/结局记录，
// 仅新增版本化干预协议与追加式执行日志。CREATE IF NOT EXISTS 保证旧数据库原位兼容。
db.exec(`
  CREATE TABLE IF NOT EXISTS interventions (
    id INTEGER PRIMARY KEY,
    intervention_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action_request_id INTEGER REFERENCES action_requests(id) ON DELETE SET NULL,
    followup_id INTEGER REFERENCES followups(id) ON DELETE SET NULL,
    intervention_type TEXT NOT NULL,
    title TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT '{}',
    target_metrics TEXT NOT NULL DEFAULT '[]',
    baseline_start TEXT NOT NULL,
    baseline_end TEXT NOT NULL,
    intervention_start TEXT NOT NULL,
    intervention_end TEXT NOT NULL,
    outcome_start TEXT NOT NULL,
    outcome_end TEXT NOT NULL,
    adherence_target TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending_confirmation'
      CHECK(status IN ('proposed','pending_confirmation','active','evaluating','completed','cancelled','insufficient_data','safety_stopped')),
    evidence_source_ids TEXT NOT NULL DEFAULT '[]',
    idempotency_key TEXT,
    schema_version TEXT NOT NULL DEFAULT 'n-of-1-intervention.v1',
    rule_version TEXT NOT NULL,
    status_reason_code TEXT,
    status_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    confirmed_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    revision INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_interventions_subject_status
    ON interventions(subject_user_id,status,intervention_end,outcome_end);
  CREATE INDEX IF NOT EXISTS idx_interventions_actor_created
    ON interventions(actor_user_id,created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_interventions_actor_idempotency
    ON interventions(actor_user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

  CREATE TABLE IF NOT EXISTS intervention_execution_logs (
    id INTEGER PRIMARY KEY,
    execution_log_id TEXT NOT NULL UNIQUE,
    intervention_db_id INTEGER NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    performed INTEGER NOT NULL CHECK(performed IN (0,1)),
    performed_at TEXT NOT NULL,
    user_note TEXT,
    skip_reason TEXT,
    data_source TEXT NOT NULL,
    idempotency_key TEXT,
    supersedes_log_id INTEGER REFERENCES intervention_execution_logs(id) ON DELETE SET NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    change_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_intervention_logs_intervention_time
    ON intervention_execution_logs(intervention_db_id,performed_at DESC,id DESC);
  CREATE INDEX IF NOT EXISTS idx_intervention_logs_supersedes
    ON intervention_execution_logs(supersedes_log_id);

  CREATE TABLE IF NOT EXISTS intervention_evaluations (
    id INTEGER PRIMARY KEY,
    evaluation_id TEXT NOT NULL UNIQUE,
    intervention_db_id INTEGER NOT NULL REFERENCES interventions(id) ON DELETE CASCADE,
    subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_metric TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    algorithm_version TEXT NOT NULL,
    input_fingerprint TEXT,
    evidence_level TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_intervention_evaluations_lookup
    ON intervention_evaluations(intervention_db_id,target_metric,created_at DESC);
`);
addColumnIfMissing('intervention_execution_logs', 'idempotency_key', 'TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_intervention_logs_actor_idempotency
  ON intervention_execution_logs(intervention_db_id,actor_user_id,idempotency_key) WHERE idempotency_key IS NOT NULL`);

// 兼容已有库：metrics 增加 device_id（可空，手动录入为 NULL）
addColumnIfMissing('metrics', 'device_id', 'INTEGER');
addColumnIfMissing('metrics', 'measurement_condition', 'TEXT');
addColumnIfMissing('metrics', 'data_quality', 'TEXT');
addColumnIfMissing('metrics', 'measurement_context', 'TEXT');
addColumnIfMissing('metric_defs', 'prediction_mode', "TEXT NOT NULL DEFAULT 'not_supported'");
// 设备同步状态扩展
addColumnIfMissing('devices', 'battery_level', 'INTEGER');
addColumnIfMissing('devices', 'sync_error', 'TEXT');

// ============= 核心指标定义（单一数据源）=============
// 家庭可采集的核心指标。心电历史数据不删除，但不再作为家庭录入/预测模块展示。
// source 语义：manual=用户手动录入 | device=真实设备采集 | synthetic=项目演示数据
const CORE_METRIC_DEFS = [
  // [type, name, unit, value_type, min, max, normal_min, normal_max, freq, ml, desc, color, icon, sort, prediction_mode]
  ['bp',        '血压',          'mmHg',   'dual',        50, 250, 90, 139,  '1-2次/日', 1, '收缩压/舒张压，value2 存舒张压', '#F4A261', '压', 1, 'value'],
  ['glucose',   '血糖',          'mmol/L', 'number',       1,  33,  4,   7,  '1-4次/日', 1, '空腹血糖', '#E0784E', '糖', 2, 'value'],
  ['hr',        '心率',          'bpm',    'number',      20, 220, 60, 100,  '多次/日',  1, '静息心率', '#9C7BC9', '心', 3, 'value'],
  ['sleep',     '睡眠',          'h',      'number',       0,  24,  7,   9,  '1次/日',   1, '夜间睡眠时长', '#9C7BC9', '眠', 4, 'range'],
  ['spo2',      '血氧',          '%',      'number',      50, 100, 95, 100,  '多次/日',  1, '血氧饱和度', '#3E8E8E', '氧', 5, 'anomaly'],
  ['weight',    '体重',          'kg',     'number',      20, 200, 45,  90,  '1次/日',   1, '体重（BMI 在特征工程由 height+weight 推导，不入库）', '#F4A261', '重', 6, 'value'],
  ['steps',     '步数',          '步',     'number',       0, 100000, 3000, 20000, '连续', 1, '每日步数', '#5A8045', '步', 7, 'range'],
  ['temp',      '体温',          '°C',     'number',      30,  45, 36, 37.3, '1-2次/日', 1, '腋下体温', '#E0784E', '温', 8, 'anomaly'],
  ['resp',      '呼吸频率',      '次/分',  'number',       5,  60, 14,  20,  '按需',     1, '静息呼吸频率', '#3E8E8E', '呼', 9, 'anomaly'],
  ['grip',      '握力',          'kg',     'number',       0, 100, 20,  50,  '1次/月',   1, '手部握力（衰弱筛查参考）', '#5A8045', '握', 10, 'value'],
  ['bodyfat',   '体脂率',        '%',      'number',       5,  70, 20,  35,  '1次/周',   1, '体脂百分比', '#F4A261', '脂', 11, 'range'],
  ['waist',     '腰围',          'cm',     'number',      30, 200, 70,  95,  '1次/周',   1, '腰围（腹型肥胖筛查参考）', '#E0784E', '腰', 12, 'value'],
  ['uricacid',  '尿酸',          'μmol/L', 'number',      50, 1200, 150, 420, '1次/月',   1, '血尿酸', '#E0784E', '尿', 13, 'risk'],
  ['cholesterol','胆固醇',       'mmol/L', 'number',       1,  20, 3.1, 5.7, '1次/月',   1, '总胆固醇', '#A04632', '胆', 14, 'risk'],
  ['hba1c',     '糖化血红蛋白',  '%',      'number',       3,  20,  4, 6.5,  '1次/季度', 1, '糖化血红蛋白（近 3 个月血糖均值指标）', '#A04632', '化', 15, 'risk'],
  ['egfr',       'eGFR',          'mL/min/1.73m²', 'number', 0, 200, 60, 200, '按医嘱', 0, '估算肾小球滤过率，需结合持续时间和尿白蛋白解释', '#3E8E8E', '肾', 16, 'derived'],
  ['creatinine', '肌酐',          'μmol/L', 'number', 10, 2000, 45, 110, '按医嘱', 0, '肾功能化验指标，需结合年龄、性别和医生评估', '#3E8E8E', '肌', 17, 'risk'],
  ['urine_albumin', '尿白蛋白',   'mg/g', 'number', 0, 10000, 0, 30, '按医嘱', 0, '尿白蛋白/肌酐比等肾脏风险监测指标', '#3E8E8E', '蛋', 18, 'risk'],
];

const upsertDef = db.prepare(`
  INSERT OR REPLACE INTO metric_defs
    (type, name, unit, value_type, min_value, max_value, normal_min, normal_max,
     frequency, ml_enabled, description, color, icon, sort, prediction_mode)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const upsertDefs = db.transaction(() => {
  for (const d of CORE_METRIC_DEFS) upsertDef.run(...d);
});
upsertDefs();
// 旧数据库升级时只移除定义，保留历史 metrics 行，避免破坏既往数据。
db.prepare("DELETE FROM metric_defs WHERE type = 'ecg'").run();

export default db;
