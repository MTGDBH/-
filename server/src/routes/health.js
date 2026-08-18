// 健康数据路由
import express from 'express';
import db from '../db.js';
import { evaluateHealth } from '../lib/scoring.js';

const router = express.Router();

// 获取今日健康摘要：得分 + 子项 + 子项卡 + 待办数 + 预警数
router.get('/summary', (req, res) => {
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 3600 * 1000);

  const metrics = db.prepare(`
    SELECT * FROM metrics
    WHERE user_id = ?
      AND recorded_at >= ?
    ORDER BY recorded_at DESC
  `).all(req.user.id, sevenDaysAgo.toISOString());

  // todo 完成率
  const todayDate = today.toISOString().slice(0, 10);
  const todos = db.prepare(`
    SELECT * FROM todos WHERE user_id = ? AND date = ?
  `).all(req.user.id, todayDate);
  const todoCompletionRate = todos.length
    ? todos.filter(t => t.completed).length / todos.length
    : 0;

  const evaluation = evaluateHealth(metrics, { todoCompletionRate, height: req.user.height });
  const alerts = db.prepare(`
    SELECT * FROM alerts WHERE user_id = ? AND status = 'pending'
  `).all(req.user.id);

  const { password: _, ...safeUser } = req.user;
  res.json({
    user: safeUser,
    today: todayDate,
    total_score: evaluation.total_score,
    subscores: evaluation.subscores,
    summary: evaluation.summary,
    todo_count: todos.length,
    todo_completed: todos.filter(t => t.completed).length,
    alert_count: alerts.length,
  });
});

// 获取 8 项指标的最新值
router.get('/metrics', (req, res) => {
  const types = ['bp', 'glucose', 'hr', 'sleep', 'spo2', 'ecg', 'weight', 'steps'];
  const result = {};
  for (const t of types) {
    const row = db.prepare(`
      SELECT * FROM metrics
      WHERE user_id = ? AND type = ?
      ORDER BY recorded_at DESC LIMIT 1
    `).get(req.user.id, t);
    result[t] = row || null;
  }
  res.json(result);
});

// 单项历史
router.get('/metrics/:type/history', (req, res) => {
  const { type } = req.params;
  const days = Math.min(parseInt(req.query.days || '7', 10), 365);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT * FROM metrics
    WHERE user_id = ? AND type = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(req.user.id, type, since);
  res.json({ type, days, points: rows });
});

// 录入 / 更新指标
router.post('/metrics', (req, res) => {
  const { type, value, value2, unit, recorded_at, source, note } = req.body;
  if (!type || value == null) {
    return res.status(400).json({ error: 'missing type or value' });
  }
  const r = db.prepare(`
    INSERT INTO metrics (user_id, type, value, value2, unit, recorded_at, source, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, type, value, value2 ?? null, unit ?? null,
         recorded_at || new Date().toISOString(),
         source || 'manual', note ?? null);
  const row = db.prepare('SELECT * FROM metrics WHERE id = ?').get(r.lastInsertRowid);
  res.json(row);
});

export default router;
