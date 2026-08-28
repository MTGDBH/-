// 智能体行动闭环：建议 → 用户确认 → 待办/复测/通知记录 → 执行状态。
import express from 'express';
import db from '../db.js';
import { canActFor } from '../lib/intake.js';
import { cancelFollowup, confirmFollowupCandidate, createFollowupForAction, listFollowups, rejectFollowupCandidate, rescheduleFollowup } from '../lib/followups.js';
import interventionRouter from './interventions.js';

const router = express.Router();
const ALLOWED = new Set(['create_todo', 'schedule_recheck', 'notify_caregiver', 'contact_doctor']);

// N-of-1 干预复用本行动域的确认语义，独立子路由保证旧 API 契约不变。
router.use('/interventions', interventionRouter);

function parsePayload(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function sensitiveAction(actionType, payload) {
  return actionType === 'notify_caregiver' || actionType === 'contact_doctor'
    || /用药|药物|就医|医生|家属|通知/.test(`${payload.title || ''}${payload.desc || ''}`);
}

function executeAction(id, actorUserId) {
  try {
    return db.transaction(() => {
      const request = db.prepare('SELECT * FROM action_requests WHERE id = ? AND actor_user_id = ?').get(id, actorUserId);
      if (!request) return { error: 'not_found' };
      if (request.status === 'executed') return { request, result: null, followup: db.prepare('SELECT * FROM followups WHERE action_request_id=?').get(id), idempotent_replay: true };
      if (!['pending_confirmation', 'confirmed'].includes(request.status)) return { error: 'already_processed', request };
      const payload = parsePayload(request.payload);
      const now = new Date().toISOString();
      let result = null, followup = null;
      if (request.action_type === 'create_todo' || request.action_type === 'schedule_recheck') {
        const title = String(payload.title || (request.action_type === 'schedule_recheck' ? '安排复测' : '完成健康计划')).trim().slice(0, 120);
        const due = payload.due_at && !Number.isNaN(Date.parse(payload.due_at)) ? new Date(payload.due_at) : new Date();
        const time = request.action_type === 'schedule_recheck' ? due.toTimeString().slice(0, 5) : /^\d{2}:\d{2}$/.test(payload.time || '') ? payload.time : '09:00';
        const date = request.action_type === 'schedule_recheck' ? `${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,'0')}-${String(due.getDate()).padStart(2,'0')}` : /^\d{4}-\d{2}-\d{2}$/.test(payload.date || '') ? payload.date : new Date().toISOString().slice(0, 10);
        const kind = request.action_type === 'schedule_recheck' ? 'recheck' : String(payload.kind || 'agent').slice(0, 24);
        const inserted = db.prepare('INSERT INTO todos (user_id, title, time, kind, date) VALUES (?, ?, ?, ?, ?)').run(request.subject_user_id, title, time, kind, date);
        result = db.prepare('SELECT * FROM todos WHERE id = ?').get(inserted.lastInsertRowid);
        if (request.action_type === 'schedule_recheck') followup = createFollowupForAction(request, payload, Number(inserted.lastInsertRowid));
      } else if (request.action_type === 'notify_caregiver') {
        const user = db.prepare('SELECT emergency_name, emergency_phone FROM users WHERE id = ?').get(request.subject_user_id);
        if (!user?.emergency_name && !user?.emergency_phone) throw Object.assign(new Error('caregiver_not_configured'), { code: 'caregiver_not_configured' });
        const inserted = db.prepare('INSERT INTO alerts (user_id, metric_type, severity, title, message) VALUES (?, ?, ?, ?, ?)').run(request.subject_user_id, 'agent', 'info', '家属通知待处理', `已记录通知家属请求：${String(payload.message || payload.title || '请关注老人健康情况').slice(0, 300)}`);
        result = db.prepare('SELECT * FROM alerts WHERE id = ?').get(inserted.lastInsertRowid);
      } else if (request.action_type === 'contact_doctor') {
        const inserted = db.prepare('INSERT INTO alerts (user_id, metric_type, severity, title, message) VALUES (?, ?, ?, ?, ?)').run(request.subject_user_id, 'agent', 'warning', '建议联系医生', String(payload.message || payload.title || '请结合近期健康数据咨询医生').slice(0, 300));
        result = db.prepare('SELECT * FROM alerts WHERE id = ?').get(inserted.lastInsertRowid);
      }
      db.prepare('UPDATE action_requests SET status=?,confirmed_at=COALESCE(confirmed_at,?),executed_at=? WHERE id=? AND actor_user_id=?').run('executed', now, now, id, actorUserId);
      return { request: db.prepare('SELECT * FROM action_requests WHERE id=?').get(id), result, followup };
    })();
  } catch (error) { return { error: error.code || 'ACTION_TRANSACTION_FAILED' }; }
}

router.get('/', (req, res) => {
  const subjectId = Number(req.query.subject_user_id || req.user.id);
  if (!canActFor(subjectId, req.user.id, 'use_agent', { resource: req.path }).allowed) return res.status(403).json({ error: '未获得该老人的授权' });
  const rows = db.prepare('SELECT * FROM action_requests WHERE actor_user_id = ? AND subject_user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id, subjectId)
    .map(row => ({ ...row, payload: parsePayload(row.payload) }));
  res.json({ items: rows });
});

router.post('/', (req, res) => {
  const { action_type } = req.body || {};
  if (!ALLOWED.has(action_type)) return res.status(400).json({ error: 'unsupported action_type' });
  const subjectId = Number(req.body?.subject_user_id || req.user.id);
  if (!canActFor(subjectId, req.user.id, 'use_agent', { resource: req.path }).allowed) return res.status(403).json({ error: '未获得该老人的授权' });
  const payload = {
    title: String(req.body.title || '').trim().slice(0, 120),
    desc: String(req.body.desc || '').trim().slice(0, 240),
    message: String(req.body.message || '').trim().slice(0, 300),
    time: req.body.time,
    date: req.body.date,
    kind: req.body.kind,
    metric_type: req.body.metric_type ? String(req.body.metric_type).slice(0, 40) : null,
    baseline_metric_id: req.body.baseline_metric_id == null ? null : Number(req.body.baseline_metric_id),
    due_at: req.body.due_at,
    schedule_key: req.body.schedule_key ? String(req.body.schedule_key).slice(0, 40) : null,
  };
  if ((action_type === 'create_todo' || action_type === 'schedule_recheck') && !payload.title) return res.status(400).json({ error: 'title is required' });
  if (action_type === 'schedule_recheck') {
    if (!payload.metric_type || !db.prepare('SELECT type FROM metric_defs WHERE type=?').get(payload.metric_type)) return res.status(400).json({ error: '请明确要复测的健康指标' });
    if (payload.baseline_metric_id && !db.prepare('SELECT id FROM metrics WHERE id=? AND user_id=? AND type=?').get(payload.baseline_metric_id, subjectId, payload.metric_type)) return res.status(400).json({ error: '基线测量不属于当前老人或指标' });
    if (payload.due_at && (Number.isNaN(Date.parse(payload.due_at)) || new Date(payload.due_at) <= new Date())) return res.status(400).json({ error: '复测时间必须晚于现在' });
  }
  if (action_type === 'notify_caregiver') {
    const user = db.prepare('SELECT emergency_name, emergency_phone FROM users WHERE id = ?').get(subjectId);
    if (!user?.emergency_name && !user?.emergency_phone) return res.status(400).json({ error: '请先在个人资料中设置家属联系方式' });
  }
  const idempotencyKey = req.body?.idempotency_key ? String(req.body.idempotency_key).slice(0, 100) : null;
  if (idempotencyKey) {
    const existing = db.prepare('SELECT * FROM action_requests WHERE actor_user_id=? AND idempotency_key=?').get(req.user.id, idempotencyKey);
    if (existing) return res.status(202).json({ requires_confirmation: existing.status === 'pending_confirmation', request: { ...existing, payload: parsePayload(existing.payload) }, idempotent_replay: true });
  }
  const inserted = db.prepare(`INSERT INTO action_requests (user_id,actor_user_id,subject_user_id,action_type,payload,status,idempotency_key)
    VALUES (?,?,?,?,?,'pending_confirmation',?)`)
    .run(subjectId, req.user.id, subjectId, action_type, JSON.stringify(payload), idempotencyKey);
  const request = db.prepare('SELECT * FROM action_requests WHERE id = ?').get(inserted.lastInsertRowid);
  return res.status(202).json({ requires_confirmation: true, request: { ...request, payload }, notice: '确认后才会执行' });
});

// 复测闭环：行动执行后可以安排具体指标的复测，并在下一次采集后回填结果。
router.get('/followups', (req, res) => {
  const subjectId = Number(req.query.subject_user_id || req.user.id);
  if (!canActFor(subjectId, req.user.id, 'view_retest', { resource: req.path }).allowed) return res.status(403).json({ error: '未获得该老人的授权' });
  res.json({ items: listFollowups(subjectId) });
});

router.post('/:id/followup', (req, res) => {
  const actionId = parseInt(req.params.id, 10);
  const request = db.prepare('SELECT * FROM action_requests WHERE id = ? AND actor_user_id = ?').get(actionId, req.user.id);
  if (!request) return res.status(404).json({ error: 'action not found' });
  if (request.status !== 'executed') return res.status(400).json({ error: 'action must be executed before follow-up' });
  const existing = db.prepare('SELECT * FROM followups WHERE action_request_id=?').get(actionId);
  if (existing) return res.json(existing);
  return res.status(409).json({ error: '新版复测已在行动确认时原子创建，请重新发起复测行动' });
});

router.post('/followups/:id/complete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const followup = db.prepare('SELECT * FROM followups WHERE id = ?').get(id);
  if (!followup) return res.status(404).json({ error: 'follow-up not found' });
  if (!canActFor(followup.user_id, req.user.id, 'manage_followups', { resource: req.path }).allowed) return res.status(403).json({ error: '未获得该老人的授权' });
  const metricId = req.body?.result_metric_id == null ? null : Number(req.body.result_metric_id);
  const result = confirmFollowupCandidate(id, followup.user_id, req.user.id, metricId);
  if (!result) return res.status(400).json({ error: '候选复测记录不匹配' });
  res.json(result);
});

router.patch('/followups/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM followups WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'follow-up not found' });
  if (!canActFor(row.user_id, req.user.id, 'manage_followups', { resource: req.path }).allowed) return res.status(403).json({ error: '未获得该老人的授权' });
  const result = rescheduleFollowup(row.id, row.user_id, req.user.id, req.body?.due_at);
  if (!result) return res.status(409).json({ error: '当前状态不能修改时间' });
  res.json(result);
});

router.post('/followups/:id/cancel', (req, res) => {
  const row = db.prepare('SELECT * FROM followups WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'follow-up not found' });
  if (!canActFor(row.user_id, req.user.id, 'manage_followups', { resource: req.path }).allowed) return res.status(403).json({ error: '未获得该老人的授权' });
  const result = cancelFollowup(row.id, row.user_id);
  if (!result && row.status !== 'cancelled') return res.status(409).json({ error: '当前状态不能取消' });
  res.json(result || row);
});

router.post('/followups/:id/candidate/confirm', (req, res) => {
  const row = db.prepare('SELECT * FROM followups WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'follow-up not found' });
  if (!canActFor(row.user_id, req.user.id, 'manage_followups', { resource: req.path }).allowed) return res.status(403).json({ error: '未获得该老人的授权' });
  const result = confirmFollowupCandidate(row.id, row.user_id, req.user.id, Number(req.body?.metric_id));
  if (!result) return res.status(400).json({ error: '候选复测记录不匹配' });
  res.json(result);
});

router.post('/followups/:id/candidate/reject', (req, res) => {
  const row = db.prepare('SELECT * FROM followups WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'follow-up not found' });
  if (!canActFor(row.user_id, req.user.id, 'manage_followups', { resource: req.path }).allowed) return res.status(403).json({ error: '未获得该老人的授权' });
  const result = rejectFollowupCandidate(row.id, row.user_id, Number(req.body?.metric_id));
  if (!result) return res.status(400).json({ error: '候选复测记录不匹配' });
  res.json(result);
});

router.post('/:id/confirm', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM action_requests WHERE id = ? AND actor_user_id = ?').get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: '待确认行动不存在' });
  if (existing.action_type === 'n_of_1_intervention') return res.status(409).json({
    reason_code: 'INTERVENTION_CONFIRM_VIA_DEDICATED_API',
    message: '个体干预必须通过 /api/actions/interventions/:interventionId/confirm 确认，不能使用通用行动入口',
  });
  if (!canActFor(existing.subject_user_id, req.user.id, 'use_agent', { resource: req.path }).allowed) return res.status(403).json({ error: '老人授权已失效，不能执行该行动' });
  if (existing.status === 'executed') return res.json({ request: { ...existing, payload: parsePayload(existing.payload) }, followup: db.prepare('SELECT * FROM followups WHERE action_request_id=?').get(id), idempotent_replay: true });
  if (!['pending_confirmation', 'confirmed'].includes(existing.status)) return res.status(400).json({ error: '行动已取消或不可执行' });
  const executed = executeAction(id, req.user.id);
  if (executed.error) return res.status(400).json(executed);
  res.json(executed);
});

router.post('/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM action_requests WHERE id=? AND actor_user_id=?').get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: '待确认行动不存在' });
  if (existing.action_type === 'n_of_1_intervention') return res.status(409).json({
    reason_code: 'INTERVENTION_CANCEL_VIA_DEDICATED_API',
    message: '个体干预必须通过干预专用拒绝或取消 API 处理',
  });
  if (!canActFor(existing.subject_user_id, req.user.id, 'use_agent', { resource: req.path }).allowed) return res.status(403).json({ error: '老人授权已失效' });
  if (existing.status === 'cancelled') return res.json({ request: { ...existing, payload: parsePayload(existing.payload) }, idempotent_replay: true });
  if (existing.status !== 'pending_confirmation') return res.status(400).json({ error: '行动已执行或不可取消' });
  db.prepare(`UPDATE action_requests SET status='cancelled' WHERE id=? AND actor_user_id=?`).run(id, req.user.id);
  res.json({ request: { ...db.prepare('SELECT * FROM action_requests WHERE id=?').get(id), payload: parsePayload(existing.payload) } });
});

export default router;
