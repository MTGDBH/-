// 评估、待办、设备、对话路由（alerts 路由已拆分到 routes/alerts.js）
import express from 'express';
import db from '../db.js';
import { evaluateHealth, aggregateMetrics } from '../lib/scoring.js';
import { chat } from '../ai/agent.js';

const router = express.Router();

// ============= 评估 =============
router.get('/assessments/latest', (req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const metrics = db.prepare(`
    SELECT * FROM metrics
    WHERE user_id = ? AND recorded_at >= ?
    ORDER BY recorded_at DESC
  `).all(req.user.id, sevenDaysAgo);

  const todayDate = new Date().toISOString().slice(0, 10);
  const todos = db.prepare(`
    SELECT * FROM todos WHERE user_id = ? AND date = ?
  `).all(req.user.id, todayDate);
  const todoCompletionRate = todos.length
    ? todos.filter(t => t.completed).length / todos.length
    : 0;

  const evaluation = evaluateHealth(metrics, { todoCompletionRate, height: req.user.height });

  // ADL / IADL：读取最近一次评估记录；无记录则为 null（严禁硬编码假值）
  const lastAssess = db.prepare(`
    SELECT adl, iadl FROM assessments WHERE user_id = ? ORDER BY id DESC LIMIT 1
  `).get(req.user.id);

  res.json({
    total_score: evaluation.total_score,
    subscores: evaluation.subscores,
    adl: lastAssess?.adl ?? null,
    iadl: lastAssess?.iadl ?? null,
    suggestions: evaluation.suggestions,
    summary: evaluation.summary,
    evaluated_at: new Date().toISOString(),
  });
});

router.post('/assessments', (req, res) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const metrics = db.prepare(`
    SELECT * FROM metrics WHERE user_id = ? AND recorded_at >= ?
  `).all(req.user.id, sevenDaysAgo);

  const ev = evaluateHealth(metrics, { height: req.user.height });
  const lastAssess = db.prepare(`
    SELECT adl, iadl FROM assessments WHERE user_id = ? ORDER BY id DESC LIMIT 1
  `).get(req.user.id);

  const r = db.prepare(`
    INSERT INTO assessments (user_id, total_score, subscores, adl, iadl, suggestions, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    ev.total_score,
    JSON.stringify(ev.subscores),
    lastAssess?.adl ?? null,
    lastAssess?.iadl ?? null,
    JSON.stringify(ev.suggestions),
    ev.summary
  );
  res.json(db.prepare('SELECT * FROM assessments WHERE id = ?').get(r.lastInsertRowid));
});

router.get('/assessments', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM assessments WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 30
  `).all(req.user.id);
  res.json(rows);
});

// ============= 待办 =============
router.get('/todos/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const todos = db.prepare(`
    SELECT * FROM todos WHERE user_id = ? AND date = ? ORDER BY time ASC
  `).all(req.user.id, today);
  res.json(todos);
});

router.patch('/todos/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { completed } = req.body;
  const completed_at = completed ? new Date().toISOString() : null;
  db.prepare(`
    UPDATE todos SET completed = ?, completed_at = ? WHERE id = ? AND user_id = ?
  `).run(completed ? 1 : 0, completed_at, id, req.user.id);
  res.json(db.prepare('SELECT * FROM todos WHERE id = ?').get(id));
});

router.post('/todos', (req, res) => {
  const { title, time, kind, date } = req.body;
  if (!title || !time) return res.status(400).json({ error: 'title and time required' });
  const r = db.prepare(`
    INSERT INTO todos (user_id, title, time, kind, date) VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, title, time, kind || 'todo', date || new Date().toISOString().slice(0, 10));
  res.json(db.prepare('SELECT * FROM todos WHERE id = ?').get(r.lastInsertRowid));
});

router.delete('/todos/:id', (req, res) => {
  db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(parseInt(req.params.id, 10), req.user.id);
  res.json({ ok: true });
});

// ============= 设备 =============
router.get('/devices', (req, res) => {
  const rows = db.prepare(`SELECT * FROM devices WHERE user_id = ?`).all(req.user.id);
  res.json(rows);
});

// ============= 对话 =============
router.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const history = db.prepare(`
    SELECT role, content FROM chat_messages
    WHERE user_id = ? ORDER BY id DESC LIMIT 10
  `).all(req.user.id).reverse();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const metrics = db.prepare(`
    SELECT * FROM metrics WHERE user_id = ? AND recorded_at >= ?
  `).all(req.user.id, sevenDaysAgo);
  const { total_score, subscores } = aggregateMetrics(metrics, { height: req.user.height });
  const healthSummary = { total_score, subscores };

  db.prepare(`INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'user', ?)`)
    .run(req.user.id, message);

  let result;
  try {
    result = await chat(history, message, healthSummary);
  } catch (err) {
    console.error('[chat] error:', err);
    return res.status(500).json({ error: 'agent error', detail: err.message });
  }

  const planJson = result.plan ? JSON.stringify(result.plan) : null;
  const confidenceJson = result.confidence ? JSON.stringify(result.confidence) : null;
  const ins = db.prepare(`
    INSERT INTO chat_messages (user_id, role, content, plan, confidence) VALUES (?, 'assistant', ?, ?, ?)
  `).run(req.user.id, result.content || '', planJson, confidenceJson);

  res.json({
    id: ins.lastInsertRowid,
    role: 'assistant',
    content: result.content,
    plan: result.plan || [],
    confidence: result.confidence || { type: 'common_sense' },
    source: result.source,
  });
});

router.get('/chat/history', (req, res) => {
  const rows = db.prepare(`
    SELECT id, role, content, plan, confidence, created_at FROM chat_messages
    WHERE user_id = ? ORDER BY id ASC LIMIT 50
  `).all(req.user.id);
  res.json(rows.map(r => ({
    ...r,
    plan: r.plan ? JSON.parse(r.plan) : null,
    confidence: r.confidence ? JSON.parse(r.confidence) : { type: 'common_sense' },
  })));
});

export default router;
