import crypto from 'node:crypto';
import db from '../db.js';

export const DATA_CATEGORIES = Object.freeze([
  { key: 'profile', label: '基本资料', description: '姓名、年龄、联系方式、健康档案偏好' },
  { key: 'health', label: '健康测量', description: '测量、评估、健康问卷与自定义指标' },
  { key: 'devices', label: '设备记录', description: '已连接设备和同步状态' },
  { key: 'conversations', label: '智能体对话', description: '对话、记忆和反馈' },
  { key: 'predictions', label: '预测输入和结果', description: '预测输入及已保存的结果快照' },
  { key: 'actions', label: '行动与干预记录', description: '待办、提醒、行动、随访与改善计划' },
  { key: 'authorizations', label: '家属/医生授权', description: '授权范围、状态、有效期与撤权信息' },
  { key: 'audit', label: '审计信息', description: '与本人有关的登录、修改、导出和访问事件' },
]);

export const RETENTION_POLICY = Object.freeze([
  { category: '账号与业务数据', period: '账号存续期间', deletion: '账号删除完成时清除' },
  { category: '会话', period: '到期或退出登录', deletion: '注销账号时立即清除' },
  { category: '导出频率记录', period: '用于 24 小时频率控制', deletion: '注销账号时清除' },
  { category: '最小化审计与删除状态', period: '默认 180 天（部署方应配置清理任务）', deletion: '期满清除；仅保留事件类型、时间、结果和不可逆主体摘要' },
  { category: '依法必须保留的数据', period: '以适用法律或有效争议保全要求为限', deletion: '法律依据终止后清除；当前演示项目未配置此类保留' },
]);
const AUDIT_RETENTION_DAYS = Math.max(1, Number(process.env.PRIVACY_AUDIT_RETENTION_DAYS || 180));

export const DELETION_CATEGORIES = DATA_CATEGORIES.filter(item => item.key !== 'audit').map(item => item.label);
export const DELETION_CONFIRM_TEXT = '确认删除我的账号';
const MASK_FIELDS = new Set(String(process.env.PRIVACY_MASK_FIELDS || 'emergency_phone,ip_hash,user_agent_hash,request_id')
  .split(',').map(item => item.trim()).filter(Boolean));

function parseJSON(value, fallback = null) { try { return JSON.parse(value ?? '') ?? fallback; } catch { return fallback; } }
function rows(sql, ...args) { return db.prepare(sql).all(...args); }
function one(sql, ...args) { return db.prepare(sql).get(...args); }
function count(sql, ...args) { return Number(one(sql, ...args)?.count || 0); }
function tableExists(name) { return Boolean(one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", name)); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function maskPhone(value) {
  const input = String(value || '');
  if (input.length <= 4) return input ? '*'.repeat(input.length) : null;
  return `${input.slice(0, 3)}****${input.slice(-4)}`;
}
export function maskSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(maskSensitiveFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (!MASK_FIELDS.has(key)) return [key, maskSensitiveFields(item)];
    if (key === 'emergency_phone') return [key, maskPhone(item)];
    return [key, item ? '[已脱敏]' : null];
  }));
}

export function privacyOverview(userId) {
  const counts = {
    profile: count('SELECT COUNT(*) count FROM users WHERE id=?', userId),
    health: count('SELECT COUNT(*) count FROM metrics WHERE user_id=?', userId)
      + count('SELECT COUNT(*) count FROM assessments WHERE user_id=?', userId)
      + count('SELECT COUNT(*) count FROM health_intakes WHERE subject_user_id=?', userId),
    devices: count('SELECT COUNT(*) count FROM devices WHERE user_id=?', userId),
    conversations: count('SELECT COUNT(*) count FROM chat_messages WHERE subject_user_id=? OR (subject_user_id IS NULL AND user_id=?)', userId, userId)
      + count('SELECT COUNT(*) count FROM agent_memories WHERE subject_user_id=?', userId),
    predictions: count('SELECT COUNT(*) count FROM prediction_inputs WHERE user_id=?', userId)
      + count("SELECT COUNT(*) count FROM chat_messages WHERE subject_user_id=? AND prediction_snapshot IS NOT NULL AND prediction_snapshot<>''", userId),
    actions: count('SELECT COUNT(*) count FROM todos WHERE user_id=?', userId)
      + count('SELECT COUNT(*) count FROM interventions WHERE subject_user_id=?', userId)
      + count('SELECT COUNT(*) count FROM action_requests WHERE subject_user_id=? OR (subject_user_id IS NULL AND user_id=?)', userId, userId),
    authorizations: count('SELECT COUNT(*) count FROM care_relationships WHERE senior_id=?', userId),
    audit: count('SELECT COUNT(*) count FROM audit_logs WHERE actor_user_id=? OR subject_user_id=?', userId, userId)
      + count('SELECT COUNT(*) count FROM care_access_logs WHERE subject_user_id=?', userId),
  };
  const profile = one('SELECT name,age,emergency_phone,created_at FROM users WHERE id=?', userId);
  const lastExport = one('SELECT format,status,byte_count,created_at FROM privacy_export_events WHERE user_id=? ORDER BY id DESC LIMIT 1', userId) || null;
  return {
    categories: DATA_CATEGORIES.map(item => ({ ...item, count: counts[item.key] || 0 })),
    profile_preview: maskSensitiveFields(profile), retention_policy: RETENTION_POLICY,
    deletion: { categories: DELETION_CATEGORIES, retained: ['最小化审计事件', '删除请求状态'], confirmation_text: DELETION_CONFIRM_TEXT },
    export: { formats: ['json', 'csv'], limit: exportLimit(), window_hours: 24, last_export: lastExport },
    masking: { configured_fields: [...MASK_FIELDS], display_rule: '手机号仅显示前 3 后 4 位；访问指纹与请求标识不向普通用户显示' },
  };
}

export function listAuthorizations(userId) {
  return rows(`SELECT r.id,r.member_role,r.status,r.scopes,r.valid_from,r.expires_at,r.revoked_at,r.revoked_reason,r.last_access_at,r.created_at,
    u.name AS recipient_name FROM care_relationships r JOIN users u ON u.id=r.member_id WHERE r.senior_id=? ORDER BY r.id DESC`, userId)
    .map(row => ({ ...row, scopes: parseJSON(row.scopes, []), recipient_name: row.recipient_name || '授权成员' }));
}

export function listAccessRecords(userId, limit = 100) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const care = rows(`SELECT l.id,l.action,l.scope,l.outcome,l.resource,l.created_at,r.member_role,u.name AS actor_name
    FROM care_access_logs l LEFT JOIN care_relationships r ON r.id=l.relationship_id LEFT JOIN users u ON u.id=l.actor_user_id
    WHERE l.subject_user_id=? ORDER BY l.id DESC LIMIT ?`, userId, safeLimit).map(row => ({ source: 'authorized_access', ...row }));
  const audit = rows(`SELECT id,event_type,resource,action,outcome,created_at FROM audit_logs
    WHERE actor_user_id=? OR subject_user_id=? ORDER BY id DESC LIMIT ?`, userId, userId, safeLimit).map(row => ({ source: 'system_audit', ...row }));
  return [...care, ...audit].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, safeLimit);
}

function exportProfile(userId) {
  return one(`SELECT name,age,gender,height,emergency_name,emergency_phone,notification_prefs,created_at,
    education_level,smoking_status,cigarettes_per_day,drinking_status,drinking_frequency,exercise_level,self_rated_health,
    chronic_diabetes,chronic_hypertension,chronic_heart,chronic_stroke,dyslipidemia,lung_disease,frailty_score,fall_risk,
    cognitive_status,chronic_kidney,family_history,sleep_quality FROM users WHERE id=?`, userId);
}
function selectOwn(table, fields, clause, ...args) { return tableExists(table) ? rows(`SELECT ${fields} FROM ${table} WHERE ${clause}`, ...args) : []; }

export function buildPersonalExport(userId) {
  const conversations = selectOwn('chat_messages', 'id,role,content,created_at,conversation_id,presentation,prediction_snapshot', 'subject_user_id=? OR (subject_user_id IS NULL AND user_id=?)', userId, userId);
  return {
    manifest: { schema: 'xiaokang-personal-data.v1', generated_at: new Date().toISOString(), categories: DATA_CATEGORIES.map(x => x.label), exclusions: ['密码及密码哈希', '会话令牌', 'API 密钥', '其他用户资料', '内部安全配置'] },
    profile: exportProfile(userId),
    health: {
      measurements: selectOwn('metrics', 'id,type,value,value2,unit,recorded_at,source,note,device_id,measurement_condition,data_quality,measurement_context,created_at', 'user_id=?', userId),
      assessments: selectOwn('assessments', 'id,total_score,subscores,adl,iadl,suggestions,summary,created_at', 'user_id=?', userId),
      intakes: selectOwn('health_intakes', 'id,respondent_role,schema_version,status,scores,recorded_at,created_at', 'subject_user_id=?', userId),
      intake_answers: tableExists('health_intake_answers') ? rows(`SELECT a.id,a.intake_id,a.question_id,a.value,a.created_at FROM health_intake_answers a JOIN health_intakes i ON i.id=a.intake_id WHERE i.subject_user_id=?`, userId) : [],
      custom_metrics: selectOwn('custom_metrics', 'id,name,unit,icon,color,ref_min,ref_max,created_at', 'user_id=?', userId),
    },
    devices: selectOwn('devices', 'id,name,kind,status,last_sync,created_at,battery_level,sync_error', 'user_id=?', userId),
    conversations: {
      messages: conversations,
      conversations: selectOwn('agent_conversations', 'id,title,summary,status,created_at,updated_at', 'subject_user_id=?', userId),
      memories: selectOwn('agent_memories', 'id,category,memory_key,content,status,valid_until,confirmed_at,created_at,updated_at', 'subject_user_id=?', userId),
      feedback: selectOwn('agent_message_feedback', 'id,message_id,rating,reason,created_at,updated_at', 'subject_user_id=?', userId),
    },
    predictions: {
      inputs: selectOwn('prediction_inputs', 'id,field,value,recorded_at,source,created_at', 'user_id=?', userId),
      results: conversations.filter(row => row.prediction_snapshot).map(row => ({ message_id: row.id, prediction_snapshot: parseJSON(row.prediction_snapshot, row.prediction_snapshot), created_at: row.created_at })),
    },
    actions: {
      todos: selectOwn('todos', 'id,title,time,kind,completed,completed_at,date,created_at', 'user_id=?', userId),
      requests: selectOwn('action_requests', 'id,action_type,payload,status,confirmed_at,executed_at,created_at', 'subject_user_id=? OR (subject_user_id IS NULL AND user_id=?)', userId, userId),
      followups: selectOwn('followups', 'id,metric_type,due_at,status,result_note,completed_at,created_at,updated_at', 'user_id=?', userId),
      agent_actions: selectOwn('agent_actions', 'id,action_type,title,status,confirmed_at,executed_at,followup_metric,followup_result,created_at', 'user_id=?', userId),
      interventions: selectOwn('interventions', 'intervention_id,intervention_type,title,protocol,target_metrics,baseline_start,baseline_end,intervention_start,intervention_end,outcome_start,outcome_end,adherence_target,status,status_reason_code,status_message,created_at,confirmed_at,completed_at,cancelled_at,updated_at,revision', 'subject_user_id=?', userId),
    },
    authorizations: listAuthorizations(userId).map(({ recipient_name: _name, ...row }) => ({ ...row, recipient: `${row.member_role || 'member'}-${row.id}` })),
    access_and_audit: listAccessRecords(userId, 200).map(({ actor_name: _name, ...row }) => row),
  };
}

function flattenExport(value, path = [], output = []) {
  if (Array.isArray(value)) { value.forEach((item, index) => flattenExport(item, [...path, String(index)], output)); return output; }
  if (value && typeof value === 'object') { Object.entries(value).forEach(([key, item]) => flattenExport(item, [...path, key], output)); return output; }
  output.push({ category: path[0] || 'manifest', path: path.slice(1).join('.'), value: value ?? '' });
  return output;
}
function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
export function serializeExport(payload, format) {
  if (format === 'json') return { body: JSON.stringify(payload, null, 2), contentType: 'application/json; charset=utf-8', extension: 'json' };
  if (format === 'csv') {
    const lines = ['category,path,value', ...flattenExport(payload).map(row => [row.category, row.path, row.value].map(csvCell).join(','))];
    return { body: `\uFEFF${lines.join('\r\n')}`, contentType: 'text/csv; charset=utf-8', extension: 'csv' };
  }
  throw Object.assign(new Error('仅支持 JSON 或 CSV 导出'), { status: 400 });
}

function exportLimit() { return Math.max(1, Number(process.env.PRIVACY_EXPORT_MAX_PER_DAY || 3)); }
export function enforceExportRate(userId) {
  const used = count("SELECT COUNT(*) count FROM privacy_export_events WHERE user_id=? AND status='completed' AND created_at>=datetime('now','-24 hours')", userId);
  if (used >= exportLimit()) {
    const error = new Error(`24 小时内最多导出 ${exportLimit()} 次，请稍后再试`); error.status = 429; error.code = 'EXPORT_RATE_LIMITED'; throw error;
  }
  return { used, remaining: exportLimit() - used };
}
export function recordExport(userId, format, status, byteCount = 0) {
  db.prepare('INSERT INTO privacy_export_events (user_id,format,status,byte_count) VALUES (?,?,?,?)').run(userId, format, status, byteCount);
}

export function createDeletionRequest(userId) {
  db.prepare("UPDATE privacy_deletion_requests SET status='expired' WHERE subject_hash=? AND status='awaiting_confirmation'").run(hash(`user:${userId}`));
  const id = crypto.randomUUID();
  const requestedAt = new Date(); const expiresAt = new Date(requestedAt.getTime() + 15 * 60_000);
  db.prepare(`INSERT INTO privacy_deletion_requests (id,subject_hash,status,categories,expires_at,requested_at) VALUES (?,?,?,?,?,?)`)
    .run(id, hash(`user:${userId}`), 'awaiting_confirmation', JSON.stringify(DELETION_CATEGORIES), expiresAt.toISOString(), requestedAt.toISOString());
  return { id, status: 'awaiting_confirmation', categories: DELETION_CATEGORIES, expires_at: expiresAt.toISOString(), confirmation_text: DELETION_CONFIRM_TEXT };
}
export function getDeletionRequest(id, userId) {
  return one('SELECT id,status,categories,expires_at,requested_at,confirmed_at,completed_at,failure_code FROM privacy_deletion_requests WHERE id=? AND subject_hash=?', id, hash(`user:${userId}`));
}

export function deleteAccountData(userId, requestId) {
  const execute = db.transaction(() => {
    const request = getDeletionRequest(requestId, userId);
    if (!request || request.status !== 'awaiting_confirmation') throw Object.assign(new Error('删除请求不存在或已处理'), { status: 409 });
    if (Date.parse(request.expires_at) <= Date.now()) {
      db.prepare("UPDATE privacy_deletion_requests SET status='expired' WHERE id=?").run(requestId);
      throw Object.assign(new Error('二次确认已过期，请重新开始'), { status: 409 });
    }
    const now = new Date().toISOString();
    db.prepare("UPDATE privacy_deletion_requests SET status='processing',confirmed_at=? WHERE id=?").run(now, requestId);
    // 不能依赖旧表的 NO ACTION 外键；先清除直接业务数据，再删除用户触发其余 CASCADE。
    for (const table of ['llm_call_logs', 'alerts', 'assessments', 'todos', 'chat_messages', 'devices', 'metrics']) {
      if (tableExists(table)) db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(userId);
    }
    // 保留的访问/审计记录仅剩事件事实，删除可能含业务内容的 metadata 和可关联标识。
    db.prepare("UPDATE audit_logs SET metadata='{}',request_id=NULL,ip_hash=NULL,user_agent_hash=NULL WHERE actor_user_id=? OR subject_user_id=?").run(userId, userId);
    db.prepare("UPDATE care_access_logs SET metadata='{}',resource=NULL WHERE actor_user_id=? OR subject_user_id=?").run(userId, userId);
    db.prepare('DELETE FROM users WHERE id=?').run(userId);
    db.prepare("UPDATE privacy_deletion_requests SET status='completed',completed_at=? WHERE id=?").run(new Date().toISOString(), requestId);
  });
  try { execute(); }
  catch (error) {
    const current = getDeletionRequest(requestId, userId);
    if (current?.status === 'awaiting_confirmation') {
      const status = error.message?.includes('过期') ? 'expired' : 'failed';
      db.prepare('UPDATE privacy_deletion_requests SET status=?,failure_code=? WHERE id=?').run(status, error.code || 'DELETE_TRANSACTION_FAILED', requestId);
    }
    throw error;
  }
  return one('SELECT id,status,completed_at FROM privacy_deletion_requests WHERE id=?', requestId);
}

export function cleanupPrivacyRetention() {
  const modifier = `-${AUDIT_RETENTION_DAYS} days`;
  const auditLogs = db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', ?)").run(modifier).changes;
  const accessLogs = db.prepare("DELETE FROM care_access_logs WHERE created_at < datetime('now', ?)").run(modifier).changes;
  const deletionRequests = db.prepare("DELETE FROM privacy_deletion_requests WHERE status IN ('completed','expired','failed') AND requested_at < datetime('now', ?)").run(modifier).changes;
  return { retention_days: AUDIT_RETENTION_DAYS, audit_logs: auditLogs, access_logs: accessLogs, deletion_requests: deletionRequests };
}

export const PRIVACY_FORBIDDEN_EXPORT_KEYS = Object.freeze(['password', 'password_algo', 'token', 'api_key', 'authorization', 'cookie', 'secret', 'credential', 'locked_until', 'login_failures']);
export function containsForbiddenExportKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenExportKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => PRIVACY_FORBIDDEN_EXPORT_KEYS.includes(key.toLowerCase()) || containsForbiddenExportKey(item));
}
