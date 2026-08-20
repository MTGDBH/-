// 预警/通知中心路由
import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/', (req, res) => {
  const { status, severity } = req.query;
  const where = ['user_id = ?'];
  const params = [req.user.id];
  if (status) { where.push('status = ?'); params.push(status); }
  if (severity) { where.push('severity = ?'); params.push(severity); }
  const rows = db.prepare(`
    SELECT * FROM alerts
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC LIMIT 100
  `).all(...params);
  res.json({ items: rows });
});

router.get('/summary', (req, res) => {
  const u = req.user.id;
  const total = db.prepare('SELECT COUNT(*) c FROM alerts WHERE user_id = ?').get(u).c;
  const pending = db.prepare(`SELECT COUNT(*) c FROM alerts WHERE user_id = ? AND status = 'pending'`).get(u).c;
  const critical = db.prepare(`SELECT COUNT(*) c FROM alerts WHERE user_id = ? AND severity = 'critical' AND status = 'pending'`).get(u).c;
  res.json({ total, pending, critical });
});

router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  if (!['pending', 'acknowledged', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const r = db.prepare(`UPDATE alerts SET status = ? WHERE id = ? AND user_id = ?`)
    .run(status, id, req.user.id);
  if (r.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json(db.prepare('SELECT * FROM alerts WHERE id = ?').get(id));
});

router.post('/read-all', (req, res) => {
  db.prepare(`UPDATE alerts SET status = 'acknowledged' WHERE user_id = ? AND status = 'pending'`).run(req.user.id);
  res.json({ ok: true });
});

export default router;
