import db from '../db.js';

export const CARE_SCOPE_DEFINITIONS = Object.freeze({
  view_summary: '查看最近健康摘要与数据缺失',
  view_alerts: '查看严重预警',
  view_retest: '查看复测状态',
  manage_followups: '协助调整复测安排',
  view_interventions: '查看改善计划',
  view_adherence: '查看最近执行情况',
  record_intake: '协助录入健康问卷',
  remind_execution: '提醒执行计划',
  record_adherence: '协助记录计划执行',
  view_trends: '查看完整健康趋势',
  view_clinical_evidence: '查看证据与模型限制',
  review_graphrag: '审核 GraphRAG 高风险关系',
  review_interventions: '对干预计划添加审核意见',
  use_agent: '为已授权老人使用智能管家',
});

export const CARE_ROLE_SCOPES = Object.freeze({
  caregiver: Object.freeze([
    'view_summary', 'view_alerts', 'view_retest', 'view_interventions', 'view_adherence',
    'record_intake', 'remind_execution', 'record_adherence', 'manage_followups', 'use_agent',
  ]),
  doctor: Object.freeze([
    'view_summary', 'view_alerts', 'view_retest', 'view_interventions', 'view_adherence',
    'view_trends', 'view_clinical_evidence', 'review_graphrag', 'review_interventions', 'use_agent',
  ]),
});

function parseJSON(value, fallback = []) {
  try { const parsed = JSON.parse(value || ''); return Array.isArray(parsed) ? parsed : fallback; }
  catch { return fallback; }
}

export function defaultScopesForRole(role) {
  return [...(CARE_ROLE_SCOPES[role] || [])];
}

export function sanitizeCareScopes(role, rawScopes, { legacyFallback = false } = {}) {
  const allowed = new Set(CARE_ROLE_SCOPES[role] || []);
  const supplied = Array.isArray(rawScopes) ? rawScopes : parseJSON(rawScopes, []);
  const unique = [...new Set(supplied.map(String))].filter(scope => allowed.has(scope));
  return unique.length || !legacyFallback ? unique : defaultScopesForRole(role);
}

export function relationshipActive(row, at = new Date()) {
  if (!row || row.status !== 'active') return false;
  const time = at.getTime();
  if (row.valid_from && Date.parse(row.valid_from) > time) return false;
  if (row.expires_at && Date.parse(row.expires_at) <= time) return false;
  return true;
}

export function appendCareAccessLog({ relationshipId = null, actorUserId, subjectUserId, action, scope = null, outcome, resource = null, metadata = {} }) {
  db.prepare(`INSERT INTO care_access_logs
    (relationship_id,actor_user_id,subject_user_id,action,scope,outcome,resource,metadata)
    VALUES (?,?,?,?,?,?,?,?)`).run(relationshipId, actorUserId || null, subjectUserId || null, action, scope, outcome, resource, JSON.stringify(metadata || {}));
}

export function resolveCareAccess(subjectUserId, actorUserId, requiredScope = 'view_summary', options = {}) {
  const subjectId = Number(subjectUserId);
  const memberId = Number(actorUserId);
  if (!Number.isInteger(subjectId) || !Number.isInteger(memberId)) return { allowed: false, status: 400, reason: 'INVALID_SUBJECT', message: 'subject_user_id 不正确' };
  const subject = db.prepare('SELECT id FROM users WHERE id=?').get(subjectId);
  if (!subject) return { allowed: false, status: 404, reason: 'SUBJECT_NOT_FOUND', message: '照护对象不存在' };
  if (subjectId === memberId) return { allowed: true, role: 'self', scopes: Object.keys(CARE_SCOPE_DEFINITIONS), relationship: null };
  const actor = db.prepare('SELECT id,role FROM users WHERE id=?').get(memberId);
  const relationship = db.prepare('SELECT * FROM care_relationships WHERE senior_id=? AND member_id=?').get(subjectId, memberId);
  const log = (outcome, reason) => {
    if (options.log === false) return;
    appendCareAccessLog({ relationshipId: relationship?.id, actorUserId: memberId, subjectUserId: subjectId,
      action: 'authorize', scope: requiredScope, outcome, resource: options.resource,
      metadata: reason ? { reason } : {} });
  };
  if (!relationship) { log('denied', 'relationship_missing'); return { allowed: false, status: 403, reason: 'RELATIONSHIP_MISSING', message: '未获得该老人的授权' }; }
  if (!relationshipActive(relationship)) { log('denied', relationship.status === 'revoked' ? 'revoked' : 'expired'); return { allowed: false, status: 403, reason: relationship.status === 'revoked' ? 'AUTHORIZATION_REVOKED' : 'AUTHORIZATION_EXPIRED', message: relationship.status === 'revoked' ? '该授权已被撤回' : '该授权已过期' }; }
  if (!actor || actor.role !== relationship.member_role || !CARE_ROLE_SCOPES[actor.role]) { log('denied', 'role_mismatch'); return { allowed: false, status: 403, reason: 'ROLE_MISMATCH', message: '账号角色与授权角色不匹配' }; }
  const scopes = sanitizeCareScopes(relationship.member_role, relationship.scopes, { legacyFallback: true });
  if (requiredScope && !scopes.includes(requiredScope)) { log('denied', 'scope_missing'); return { allowed: false, status: 403, reason: 'SCOPE_MISSING', message: `当前授权不包含“${CARE_SCOPE_DEFINITIONS[requiredScope] || requiredScope}”权限` }; }
  if (options.touch !== false) db.prepare('UPDATE care_relationships SET last_access_at=?,updated_at=? WHERE id=?').run(new Date().toISOString(), new Date().toISOString(), relationship.id);
  log('allowed');
  return { allowed: true, role: relationship.member_role, scopes, relationship: { ...relationship, scopes } };
}
