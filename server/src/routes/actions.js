// 智能体行动闭环：建议 → 用户确认 → 待办/复测/通知记录 → 执行状态。
import express from 'express';
import db from '../db.js';

const router = express.Router();
const ALLOWED = new Set(['create_todo', 'schedule_recheck', 'notify_caregiver', 'contact_doctor']);

function parsePayload(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function sensitiveAction(actionType, payload) {
  return actionType === 'notify_caregiver' || actionType === 'contact_doctor'
    || /用药|药物|就医|医生|家属|通知/.test(`${payload.title || ''}${payload.desc || ''}`);
}

function executeAction(id, userId) {
  const request = db.prepare('SELECT * FROM action_requests WHERE id = ? AND user_id = ?').get(id, userId);
  if (!request) return { error: 'not_found' };
  if (!['pending_confirmation', 'confirmed'].includes(request.status)) return { error: 'already_processed', request };
  const payload = parsePayload(request.payload);
  const now = new Date().toISOString();
  let result = null;
  if (request.action_type === 'create_todo' || request.action_type === 'schedule_recheck') {
    const title = String(payload.title || (request.action_type === 'schedule_recheck' ? '安排复测' : '完成健康计划')).trim().slice(0, 120);
    const time = /^\d{2}:\d{2}$/.test(payload.time || '') ? payload.time : '09:00';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(payload.date || '') ? payload.date : new Date().toISOString().slice(0, 10);
    const kind = request.action_type === 'schedule_recheck' ? 'recheck' : String(payload.kind || 'agent').slice(0, 24);
    const inserted = db.prepare('INSERT INTO todos (user_id, title, time, kind, date) VALUES (?, ?, ?, ?, ?)').run(userId, title, time, kind, date);
    result = db.prepare('SELECT * FROM todos WHERE id = ?').get(inserted.lastInsertRowid);
  } else if (request.action_type === 'notify_caregiver') {
    const user = db.prepare('SELECT emergency_name, emergency_phone FROM users WHERE id = ?').get(userId);
    if (!user?.emergency_name && !user?.emergency_phone) return { error: 'caregiver_not_configured' };
    const inserted = db.prepare('INSERT INTO alerts (user_id, metric_type, severity, title, message) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'agent', 'info', '家属通知待处理', `已记录通知家属请求：${String(payload.message || payload.title || '请关注老人健康情况').slice(0, 300)}`);
    result = db.prepare('SELECT * FROM alerts WHERE id = ?').get(inserted.lastInsertRowid);
  } else if (request.action_type === 'contact_doctor') {
    const inserted = db.prepare('INSERT INTO alerts (user_id, metric_type, severity, title, message) VALUES (?, ?, ?, ?, ?)')
      .run(userId, 'agent', 'warning', '建议联系医生', String(payload.message || payload.title || '请结合近期健康数据咨询医生').slice(0, 300));
    result = db.prepare('SELECT * FROM alerts WHERE id = ?').get(inserted.lastInsertRowid);
  }
  db.prepare('UPDATE action_requests SET status = ?, executed_at = ? WHERE id = ? AND user_id = ?')
    .run('executed', now, id, userId);
  return { request: db.prepare('SELECT * FROM action_requests WHERE id = ?').get(id), result };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM action_requests WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id)
    .map(row => ({ ...row, payload: parsePayload(row.payload) }));
  res.json({ items: rows });
});

router.post('/', (req, res) => {
  const { action_type, confirmed } = req.body || {};
  if (!ALLOWED.has(action_type)) return res.status(400).json({ error: 'unsupported action_type' });
  const payload = {
    title: String(req.body.title || '').trim().slice(0, 120),
    desc: String(req.body.desc || '').trim().slice(0, 240),
    message: String(req.body.message || '').trim().slice(0, 300),
    time: req.body.time,
    date: req.body.date,
    kind: req.body.kind,
  };
  if ((action_type === 'create_todo' || action_type === 'schedule_recheck') && !payload.title) return res.status(400).json({ error: 'title is required' });
  if (action_type === 'notify_caregiver') {
    const user = db.prepare('SELECT emergency_name, emergency_phone FROM users WHERE id = ?').get(req.user.id);
    if (!user?.emergency_name && !user?.emergency_phone) return res.status(400).json({ error: '请先在个人资料中设置家属联系方式' });
  }
  const needsConfirmation = sensitiveAction(action_type, payload) && confirmed !== true;
  const inserted = db.prepare('INSERT INTO action_requests (user_id, action_type, payload, status) VALUES (?, ?, ?, ?)')
    .run(req.user.id, action_type, JSON.stringify(payload), needsConfirmation ? 'pending_confirmation' : 'confirmed');
  const request = db.prepare('SELECT * FROM action_requests WHERE id = ?').get(inserted.lastInsertRowid);
  if (needsConfirmation) return res.status(202).json({ requires_confirmation: true, request: { ...request, payload } });
  const executed = executeAction(request.id, req.user.id);
  if (executed.error) return res.status(400).json(executed);
  res.status(201).json({ requires_confirmation: false, ...executed });
});

router.post('/:id/confirm', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT id FROM action_requests WHERE id = ? AND user_id = ? AND status = ?').get(id, req.user.id, 'pending_confirmation');
  if (!existing) return res.status(404).json({ error: '待确认行动不存在或已处理' });
  db.prepare('UPDATE action_requests SET status = ?, confirmed_at = ? WHERE id = ? AND user_id = ?')
    .run('confirmed', new Date().toISOString(), id, req.user.id);
  const executed = executeAction(id, req.user.id);
  if (executed.error) return res.status(400).json(executed);
  res.json(executed);
});

export default router;
