// 家属/医生授权：只允许被老人授权的关系查看数据，不通过姓名猜测权限。
import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { buildHealthContext } from '../ai/contextBuilder.js';

const router = express.Router();
const isSenior = user => !user.role || user.role === 'senior';

function safeUser(row) {
  if (!row) return null;
  const { password: _, ...safe } = row;
  return safe;
}

function canView(seniorId, memberId) {
  return !!db.prepare(`SELECT id FROM care_relationships WHERE senior_id = ? AND member_id = ? AND status = 'active'`).get(seniorId, memberId);
}

router.post('/invitations', (req, res) => {
  if (!isSenior(req.user)) return res.status(403).json({ error: '只有老人本人可以创建授权码' });
  const memberRole = ['caregiver', 'doctor'].includes(req.body?.member_role) ? req.body.member_role : 'caregiver';
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  const result = db.prepare('INSERT INTO care_invitations (senior_id, code, expires_at) VALUES (?, ?, ?)').run(req.user.id, code, expires);
  res.status(201).json({ id: result.lastInsertRowid, senior_id: req.user.id, code, member_role: memberRole, expires_at: expires, notice: '请只把授权码交给本人，过期后需要重新生成' });
});

router.post('/accept', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(code)) return res.status(400).json({ error: '授权码格式不正确' });
  const invite = db.prepare(`SELECT * FROM care_invitations WHERE code = ? AND used_by IS NULL AND expires_at > ?`).get(code, new Date().toISOString());
  if (!invite) return res.status(404).json({ error: '授权码不存在、已使用或已过期' });
  if (invite.senior_id === req.user.id) return res.status(400).json({ error: '不能授权给自己' });
  const role = ['caregiver', 'doctor'].includes(req.body?.member_role) ? req.body.member_role : (req.user.role === 'doctor' ? 'doctor' : 'caregiver');
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO care_relationships (senior_id, member_id, member_role, status) VALUES (?, ?, ?, 'active') ON CONFLICT(senior_id, member_id) DO UPDATE SET status = 'active', member_role = excluded.member_role`).run(invite.senior_id, req.user.id, role);
    db.prepare('UPDATE care_invitations SET used_by = ?, used_at = ? WHERE id = ?').run(req.user.id, new Date().toISOString(), invite.id);
  });
  tx();
  res.json({ ok: true, senior_id: invite.senior_id, member_role: role });
});

router.get('/relationships', (req, res) => {
  const asSenior = db.prepare(`SELECT r.*, u.name, u.age, u.gender, u.role FROM care_relationships r JOIN users u ON u.id = r.member_id WHERE r.senior_id = ? ORDER BY r.id DESC`).all(req.user.id);
  const asMember = db.prepare(`SELECT r.*, u.name, u.age, u.gender, u.role FROM care_relationships r JOIN users u ON u.id = r.senior_id WHERE r.member_id = ? ORDER BY r.id DESC`).all(req.user.id);
  res.json({ as_senior: asSenior, as_member: asMember });
});

router.get('/seniors/:id/summary', (req, res) => {
  const seniorId = parseInt(req.params.id, 10);
  if (!Number.isInteger(seniorId) || !canView(seniorId, req.user.id)) return res.status(403).json({ error: '未获得该老人的授权' });
  const senior = db.prepare('SELECT * FROM users WHERE id = ?').get(seniorId);
  const context = buildHealthContext(senior, 90);
  const alerts = db.prepare(`SELECT id, metric_type, severity, title, message, status, created_at FROM alerts WHERE user_id = ? ORDER BY id DESC LIMIT 20`).all(seniorId);
  const today = new Date().toISOString().slice(0, 10);
  const todos = db.prepare('SELECT id, title, time, kind, completed, date FROM todos WHERE user_id = ? AND date = ? ORDER BY time').all(seniorId, today);
  return res.json({ senior: safeUser(senior), context, alerts, todos, access: 'authorized_read_with_intake_write',
    capabilities: { view_summary: true, submit_health_intake: true, write_measurements: false } });
});

router.delete('/relationships/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = db.prepare('DELETE FROM care_relationships WHERE id = ? AND (senior_id = ? OR member_id = ?)').run(id, req.user.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: '关系不存在' });
  res.json({ ok: true });
});

export default router;
