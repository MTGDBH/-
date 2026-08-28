// 照护协同：授权范围、有效期、撤权和每次跨主体访问都由服务端判定。
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db.js';
import { buildHealthContext } from '../ai/contextBuilder.js';
import {
  CARE_ROLE_SCOPES, CARE_SCOPE_DEFINITIONS, appendCareAccessLog, defaultScopesForRole,
  relationshipActive, resolveCareAccess, sanitizeCareScopes,
} from '../contracts/careAccess.js';
import { audit, requestFingerprint } from '../services/auditService.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELATION_MANIFEST = path.resolve(__dirname, '..', '..', '..', 'elderly-health-rag', 'output', 'relation_review_manifest.json');
const isSenior = user => !user.role || user.role === 'senior';

function parseJSON(value, fallback = {}) { try { return JSON.parse(value || '') ?? fallback; } catch { return fallback; } }
function nowIso() { return new Date().toISOString(); }
function deny(res, access) { return res.status(access.status || 403).json({ error: access.message || '未获得该老人的授权', reason_code: access.reason || 'CARE_FORBIDDEN' }); }
function manifest() { try { return JSON.parse(fs.readFileSync(RELATION_MANIFEST, 'utf8')); } catch { return { index_version: null, relations: [] }; } }

function serializeRelationship(row) {
  const scopes = sanitizeCareScopes(row.member_role, row.scopes, { legacyFallback: true });
  const effective = relationshipActive(row) ? 'active' : row.status === 'revoked' ? 'revoked' : 'expired';
  return { ...row, scopes, scope_labels: scopes.map(scope => CARE_SCOPE_DEFINITIONS[scope]), effective_status: effective };
}

function logLifecycle(req, relationship, action, outcome = 'success', metadata = {}) {
  appendCareAccessLog({ relationshipId: relationship?.id, actorUserId: req.user.id, subjectUserId: relationship?.senior_id || req.user.id,
    action, outcome, resource: req.path, metadata });
  audit({ actor_user_id: req.user.id, subject_user_id: relationship?.senior_id || req.user.id,
    event_type: 'care_authorization', resource: req.path, action, outcome, request_id: req.request_id,
    ...requestFingerprint(req), metadata: { relationship_id: relationship?.id || null, ...metadata } });
}

function relationshipForOwner(id, seniorId) {
  return db.prepare('SELECT * FROM care_relationships WHERE id=? AND senior_id=?').get(Number(id), Number(seniorId));
}

function dashboardCard(row, access) {
  const senior = db.prepare('SELECT * FROM users WHERE id=?').get(row.senior_id);
  const scopes = access.scopes;
  const context = scopes.includes('view_summary') ? buildHealthContext(senior, 30) : null;
  const latestTypes = ['bp', 'glucose', 'hr', 'spo2'];
  const latest = context ? latestTypes.map(type => context.latest?.[type]).filter(Boolean).map(item => ({
    type: item.type, value: item.value, value2: item.value2, unit: item.unit, recorded_at: item.recorded_at,
  })) : undefined;
  const severeAlerts = scopes.includes('view_alerts') ? db.prepare(`SELECT id,severity,title,created_at FROM alerts
    WHERE user_id=? AND severity='critical' AND status='pending' ORDER BY id DESC LIMIT 3`).all(row.senior_id) : undefined;
  const overdueRetests = scopes.includes('view_retest') ? db.prepare(`SELECT id,metric_type,due_at,status FROM followups
    WHERE user_id=? AND status IN ('due','overdue','scheduled') AND due_at<=? ORDER BY due_at LIMIT 5`).all(row.senior_id, nowIso()) : undefined;
  const activePlans = scopes.includes('view_interventions') ? db.prepare(`SELECT intervention_id,title,status,outcome_start FROM interventions
    WHERE subject_user_id=? AND status IN ('active','evaluating') ORDER BY updated_at DESC LIMIT 5`).all(row.senior_id) : undefined;
  const recentExecution = scopes.includes('view_adherence') ? db.prepare(`SELECT l.performed,l.performed_at,l.data_source,i.title
    FROM intervention_execution_logs l JOIN interventions i ON i.id=l.intervention_db_id
    WHERE i.subject_user_id=? ORDER BY l.performed_at DESC,l.id DESC LIMIT 5`).all(row.senior_id).map(item => ({ ...item, performed: Boolean(item.performed) })) : undefined;
  return {
    senior: { id: senior.id, name: senior.name, age: senior.age, avatar_color: senior.avatar_color },
    authorization: serializeRelationship(row),
    capabilities: Object.fromEntries(Object.keys(CARE_SCOPE_DEFINITIONS).map(scope => [scope, scopes.includes(scope)])),
    ...(context ? { recent_health: latest, data_missing: context.missing_common_metrics, data_points_30d: context.data_points } : {}),
    ...(severeAlerts !== undefined ? { severe_alerts: severeAlerts } : {}),
    ...(overdueRetests !== undefined ? { overdue_retests: overdueRetests } : {}),
    ...(activePlans !== undefined ? { active_interventions: activePlans } : {}),
    ...(recentExecution !== undefined ? { recent_execution: recentExecution } : {}),
  };
}

router.get('/capabilities', (req, res) => {
  res.json({ role: req.user.role, definitions: CARE_SCOPE_DEFINITIONS,
    allowed_scopes: CARE_ROLE_SCOPES[req.user.role] || [], default_scopes: defaultScopesForRole(req.user.role) });
});

router.post('/invitations', (req, res) => {
  if (!isSenior(req.user)) return res.status(403).json({ error: '只有老人本人可以创建授权码' });
  const memberRole = ['caregiver', 'doctor'].includes(req.body?.member_role) ? req.body.member_role : null;
  if (!memberRole) return res.status(400).json({ error: '请选择家属或医生角色' });
  const requested = Array.isArray(req.body?.scopes) ? req.body.scopes : defaultScopesForRole(memberRole);
  const scopes = sanitizeCareScopes(memberRole, requested);
  if (!scopes.length || scopes.length !== [...new Set(requested.map(String))].length) return res.status(400).json({ error: '授权范围为空或包含该角色不允许的能力' });
  const validDays = Math.max(1, Math.min(365, Number(req.body?.valid_days) || 30));
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const relationshipExpiresAt = new Date(Date.now() + validDays * 86400000).toISOString();
  const result = db.prepare(`INSERT INTO care_invitations (senior_id,code,expires_at,member_role,scopes,relationship_expires_at)
    VALUES (?,?,?,?,?,?)`).run(req.user.id, code, expiresAt, memberRole, JSON.stringify(scopes), relationshipExpiresAt);
  logLifecycle(req, null, 'invitation_created', 'success', { invitation_id: Number(result.lastInsertRowid), member_role: memberRole, scopes, valid_days: validDays });
  res.status(201).json({ id: Number(result.lastInsertRowid), senior_id: req.user.id, code, member_role: memberRole,
    scopes, scope_labels: scopes.map(scope => CARE_SCOPE_DEFINITIONS[scope]), expires_at: expiresAt,
    relationship_expires_at: relationshipExpiresAt, notice: '请只把授权码交给指定角色本人；授权范围不能由接受者扩大' });
});

router.post('/accept', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(code)) return res.status(400).json({ error: '授权码格式不正确' });
  const invite = db.prepare(`SELECT * FROM care_invitations WHERE code=? AND used_by IS NULL AND expires_at>?`).get(code, nowIso());
  if (!invite) return res.status(404).json({ error: '授权码不存在、已使用或已过期' });
  if (invite.senior_id === req.user.id) return res.status(400).json({ error: '不能授权给自己' });
  if (req.user.role !== invite.member_role) return res.status(403).json({ error: `该授权码仅限${invite.member_role === 'doctor' ? '医生' : '家属'}账号接受`, reason_code: 'INVITATION_ROLE_MISMATCH' });
  const scopes = sanitizeCareScopes(invite.member_role, invite.scopes, { legacyFallback: true });
  const relationship = db.transaction(() => {
    db.prepare(`INSERT INTO care_relationships
      (senior_id,member_id,member_role,status,scopes,valid_from,expires_at,revoked_at,revoked_by,revoked_reason,last_access_at,updated_at,revision)
      VALUES (?,?,?,'active',?,?,?,NULL,NULL,NULL,NULL,?,1)
      ON CONFLICT(senior_id,member_id) DO UPDATE SET member_role=excluded.member_role,status='active',scopes=excluded.scopes,
        valid_from=excluded.valid_from,expires_at=excluded.expires_at,revoked_at=NULL,revoked_by=NULL,revoked_reason=NULL,
        last_access_at=NULL,updated_at=excluded.updated_at,revision=care_relationships.revision+1`)
      .run(invite.senior_id, req.user.id, invite.member_role, JSON.stringify(scopes), nowIso(), invite.relationship_expires_at, nowIso());
    db.prepare('UPDATE care_invitations SET used_by=?,used_at=? WHERE id=?').run(req.user.id, nowIso(), invite.id);
    return db.prepare('SELECT * FROM care_relationships WHERE senior_id=? AND member_id=?').get(invite.senior_id, req.user.id);
  })();
  logLifecycle(req, relationship, 'authorization_accepted', 'success', { member_role: invite.member_role, scopes });
  res.json({ ok: true, senior_id: invite.senior_id, relationship: serializeRelationship(relationship) });
});

router.get('/relationships', (req, res) => {
  const asSenior = db.prepare(`SELECT r.*,u.name,u.age,u.gender,u.role FROM care_relationships r JOIN users u ON u.id=r.member_id WHERE r.senior_id=? ORDER BY r.id DESC`).all(req.user.id).map(serializeRelationship);
  const asMember = db.prepare(`SELECT r.*,u.name,u.age,u.gender,u.role FROM care_relationships r JOIN users u ON u.id=r.senior_id WHERE r.member_id=? ORDER BY r.id DESC`).all(req.user.id).map(serializeRelationship);
  res.json({ as_senior: asSenior, as_member: asMember, definitions: CARE_SCOPE_DEFINITIONS });
});

router.patch('/relationships/:id', (req, res) => {
  if (!isSenior(req.user)) return res.status(403).json({ error: '只有老人本人可以调整授权' });
  const relationship = relationshipForOwner(req.params.id, req.user.id);
  if (!relationship) return res.status(404).json({ error: '授权关系不存在' });
  if (relationship.status !== 'active') return res.status(409).json({ error: '已撤回的授权不能直接修改，请重新邀请' });
  const rawScopes = Array.isArray(req.body?.scopes) ? req.body.scopes : sanitizeCareScopes(relationship.member_role, relationship.scopes, { legacyFallback: true });
  const scopes = sanitizeCareScopes(relationship.member_role, rawScopes);
  if (!scopes.length || scopes.length !== [...new Set(rawScopes.map(String))].length) return res.status(400).json({ error: '授权范围为空或包含不允许的能力' });
  const expiresAt = req.body?.expires_at && !Number.isNaN(Date.parse(req.body.expires_at)) ? new Date(req.body.expires_at).toISOString() : relationship.expires_at;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) return res.status(400).json({ error: '授权有效期必须晚于现在' });
  db.prepare(`UPDATE care_relationships SET scopes=?,expires_at=?,updated_at=?,revision=revision+1 WHERE id=?`).run(JSON.stringify(scopes), expiresAt, nowIso(), relationship.id);
  const updated = db.prepare('SELECT * FROM care_relationships WHERE id=?').get(relationship.id);
  logLifecycle(req, updated, 'authorization_updated', 'success', { scopes, expires_at: expiresAt });
  res.json({ relationship: serializeRelationship(updated), notice: '新范围已立即生效；旧页面的下一次请求会按新范围重新校验' });
});

function revokeRelationship(req, res) {
  if (!isSenior(req.user)) return res.status(403).json({ error: '只有老人本人可以撤回授权' });
  const relationship = relationshipForOwner(req.params.id, req.user.id);
  if (!relationship) return res.status(404).json({ error: '授权关系不存在' });
  const reason = String(req.body?.reason || '老人本人撤回授权').trim().slice(0, 300);
  if (relationship.status !== 'revoked') db.prepare(`UPDATE care_relationships SET status='revoked',revoked_at=?,revoked_by=?,revoked_reason=?,updated_at=?,revision=revision+1 WHERE id=?`).run(nowIso(), req.user.id, reason, nowIso(), relationship.id);
  const updated = db.prepare('SELECT * FROM care_relationships WHERE id=?').get(relationship.id);
  logLifecycle(req, updated, 'authorization_revoked', 'success', { reason });
  res.json({ ok: true, relationship: serializeRelationship(updated), notice: '授权已撤回，现有登录会话从下一次相关请求起失去能力' });
}
router.post('/relationships/:id/revoke', revokeRelationship);
router.delete('/relationships/:id', revokeRelationship);

router.get('/relationships/:id/logs', (req, res) => {
  const relationship = db.prepare('SELECT * FROM care_relationships WHERE id=?').get(Number(req.params.id));
  if (!relationship || ![relationship.senior_id, relationship.member_id].includes(req.user.id)) return res.status(404).json({ error: '授权关系不存在' });
  const rows = db.prepare(`SELECT id,actor_user_id,subject_user_id,action,scope,outcome,resource,metadata,created_at
    FROM care_access_logs WHERE relationship_id=? ORDER BY id DESC LIMIT 100`).all(relationship.id).map(row => ({ ...row, metadata: parseJSON(row.metadata, {}) }));
  res.json({ relationship: serializeRelationship(relationship), items: rows });
});

router.get('/subjects', (req, res) => {
  if (!['caregiver', 'doctor'].includes(req.user.role)) return res.json({ role: req.user.role, items: [] });
  const rows = db.prepare('SELECT * FROM care_relationships WHERE member_id=? ORDER BY id DESC').all(req.user.id);
  const items = [];
  for (const row of rows) {
    const access = resolveCareAccess(row.senior_id, req.user.id, null, { resource: req.path, touch: true });
    if (access.allowed) items.push(dashboardCard(row, access));
  }
  res.json({ role: req.user.role, items, definitions: CARE_SCOPE_DEFINITIONS });
});

router.get('/seniors/:id/summary', (req, res) => {
  const seniorId = Number(req.params.id);
  const access = resolveCareAccess(seniorId, req.user.id, 'view_summary', { resource: req.path });
  if (!access.allowed) return deny(res, access);
  const card = dashboardCard(access.relationship, access);
  res.json({ ...card, access: 'authorized_scoped', access_role: access.role });
});

router.post('/seniors/:id/reminders', (req, res) => {
  const seniorId = Number(req.params.id);
  const access = resolveCareAccess(seniorId, req.user.id, 'remind_execution', { resource: req.path });
  if (!access.allowed) return deny(res, access);
  if (access.role !== 'caregiver') return res.status(403).json({ error: '只有获得提醒权限的家属可以发送执行提醒' });
  const message = String(req.body?.message || '请记得按计划完成今天的健康任务').trim().slice(0, 180);
  const inserted = db.prepare(`INSERT INTO alerts (user_id,metric_type,severity,title,message,status) VALUES (?,'care','info','家属执行提醒',?,'pending')`).run(seniorId, message);
  appendCareAccessLog({ relationshipId: access.relationship.id, actorUserId: req.user.id, subjectUserId: seniorId,
    action: 'execution_reminder', scope: 'remind_execution', outcome: 'success', resource: req.path, metadata: { alert_id: Number(inserted.lastInsertRowid) } });
  res.status(201).json({ ok: true, reminder_id: Number(inserted.lastInsertRowid), message: '提醒已记录，未替老人确认或执行计划' });
});

router.get('/seniors/:id/clinical-evidence', (req, res) => {
  const seniorId = Number(req.params.id);
  const access = resolveCareAccess(seniorId, req.user.id, 'view_clinical_evidence', { resource: req.path });
  if (!access.allowed) return deny(res, access);
  const evaluations = db.prepare(`SELECT e.target_metric,e.evidence_level,e.reason_code,e.created_at,i.title
    FROM intervention_evaluations e JOIN interventions i ON i.id=e.intervention_db_id
    WHERE e.subject_user_id=? ORDER BY e.id DESC LIMIT 10`).all(seniorId);
  res.json({ evaluations, limitations: [
    '疾病风险输出用于筛查，不是诊断或处方依据。',
    'N-of-1 结果是个人观察证据，不能自动证明因果关系。',
    'GraphRAG 未审核高风险关系仅用于证据治理，不进入老人端临床建议。',
  ], model_boundary: '需要结合连续测量、测量条件和临床判断。' });
});

router.get('/seniors/:id/graphrag/reviews', (req, res) => {
  const seniorId = Number(req.params.id);
  const access = resolveCareAccess(seniorId, req.user.id, 'review_graphrag', { resource: req.path });
  if (!access.allowed) return deny(res, access);
  const data = manifest();
  const reviews = db.prepare('SELECT * FROM graph_relationship_reviews WHERE relationship_id=? AND reviewer_id=?').all(access.relationship.id, req.user.id);
  const reviewMap = Object.fromEntries(reviews.map(row => [row.relation_index, row]));
  res.json({ index_version: data.index_version, items: (data.relations || []).slice(0, 20).map(row => ({ ...row, clinician_review: reviewMap[row.relation_index] || null })),
    boundary: '审核仅影响该授权关系下的评审记录，不会直接改写知识图谱或自动生成临床行动。' });
});

router.post('/seniors/:id/graphrag/reviews/:relationIndex', (req, res) => {
  const seniorId = Number(req.params.id);
  const access = resolveCareAccess(seniorId, req.user.id, 'review_graphrag', { resource: req.path });
  if (!access.allowed) return deny(res, access);
  const relationIndex = Number(req.params.relationIndex);
  if (!manifest().relations?.some(row => Number(row.relation_index) === relationIndex)) return res.status(404).json({ error: '高风险关系不存在' });
  const status = String(req.body?.status || 'needs_revision');
  const notes = String(req.body?.notes || '').trim().slice(0, 1000);
  if (!['approved_for_education', 'needs_revision', 'rejected'].includes(status) || !notes) return res.status(400).json({ error: '请选择审核结论并填写意见' });
  db.prepare(`INSERT INTO graph_relationship_reviews (relation_index,relationship_id,subject_user_id,reviewer_id,status,notes)
    VALUES (?,?,?,?,?,?) ON CONFLICT(relation_index,relationship_id,reviewer_id)
    DO UPDATE SET status=excluded.status,notes=excluded.notes,created_at=datetime('now','localtime')`)
    .run(relationIndex, access.relationship.id, seniorId, req.user.id, status, notes);
  appendCareAccessLog({ relationshipId: access.relationship.id, actorUserId: req.user.id, subjectUserId: seniorId,
    action: 'graphrag_review', scope: 'review_graphrag', outcome: 'success', resource: req.path, metadata: { relation_index: relationIndex, status } });
  res.json(db.prepare('SELECT * FROM graph_relationship_reviews WHERE relation_index=? AND relationship_id=? AND reviewer_id=?').get(relationIndex, access.relationship.id, req.user.id));
});

router.get('/seniors/:id/interventions/:interventionId/reviews', (req, res) => {
  const seniorId = Number(req.params.id);
  const access = resolveCareAccess(seniorId, req.user.id, 'review_interventions', { resource: req.path });
  if (!access.allowed) return deny(res, access);
  const plan = db.prepare('SELECT id,intervention_id,title,status FROM interventions WHERE intervention_id=? AND subject_user_id=?').get(req.params.interventionId, seniorId);
  if (!plan) return res.status(404).json({ error: '干预计划不存在' });
  const items = db.prepare(`SELECT r.*,u.name AS reviewer_name FROM intervention_clinical_reviews r JOIN users u ON u.id=r.reviewer_id
    WHERE r.intervention_db_id=? ORDER BY r.id DESC`).all(plan.id);
  res.json({ intervention: plan, items });
});

router.post('/seniors/:id/interventions/:interventionId/reviews', (req, res) => {
  const seniorId = Number(req.params.id);
  const access = resolveCareAccess(seniorId, req.user.id, 'review_interventions', { resource: req.path });
  if (!access.allowed) return deny(res, access);
  const plan = db.prepare('SELECT id,intervention_id,title,status FROM interventions WHERE intervention_id=? AND subject_user_id=?').get(req.params.interventionId, seniorId);
  if (!plan) return res.status(404).json({ error: '干预计划不存在' });
  const status = String(req.body?.status || 'commented');
  const comment = String(req.body?.comment || '').trim().slice(0, 1000);
  if (!['commented', 'approved_with_caution', 'needs_revision'].includes(status) || !comment) return res.status(400).json({ error: '请选择审核状态并填写意见' });
  const inserted = db.prepare(`INSERT INTO intervention_clinical_reviews (intervention_db_id,relationship_id,reviewer_id,status,comment)
    VALUES (?,?,?,?,?)`).run(plan.id, access.relationship.id, req.user.id, status, comment);
  appendCareAccessLog({ relationshipId: access.relationship.id, actorUserId: req.user.id, subjectUserId: seniorId,
    action: 'intervention_review', scope: 'review_interventions', outcome: 'success', resource: req.path, metadata: { intervention_id: plan.intervention_id, status } });
  res.status(201).json(db.prepare('SELECT * FROM intervention_clinical_reviews WHERE id=?').get(inserted.lastInsertRowid));
});

export default router;
