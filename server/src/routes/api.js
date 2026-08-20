// 评估、待办、设备、对话路由（alerts 路由已拆分到 routes/alerts.js）
import express from 'express';
import db from '../db.js';
import { evaluateHealth, aggregateMetrics } from '../lib/scoring.js';
import { chat } from '../ai/agent.js';
import { buildHealthContext, buildEvidenceCard } from '../ai/contextBuilder.js';

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

router.post('/devices', (req, res) => {
  const { name, kind, battery_level } = req.body || {};
  if (!name || !kind) return res.status(400).json({ error: 'name and kind are required' });
  const battery = battery_level == null ? null : Math.max(0, Math.min(100, Number(battery_level)));
  const r = db.prepare('INSERT INTO devices (user_id, name, kind, status, battery_level) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, String(name).slice(0, 80), String(kind).slice(0, 40), 'connected', Number.isFinite(battery) ? battery : null);
  res.status(201).json(db.prepare('SELECT * FROM devices WHERE id = ?').get(r.lastInsertRowid));
});

router.patch('/devices/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const device = db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!device) return res.status(404).json({ error: 'device not found' });
  const fields = []; const values = [];
  if (req.body.status !== undefined && ['connected', 'disconnected', 'error'].includes(req.body.status)) { fields.push('status = ?'); values.push(req.body.status); }
  if (req.body.battery_level !== undefined) { const b = Number(req.body.battery_level); if (Number.isFinite(b) && b >= 0 && b <= 100) { fields.push('battery_level = ?'); values.push(Math.round(b)); } }
  if (req.body.sync_error !== undefined) { fields.push('sync_error = ?'); values.push(req.body.sync_error ? String(req.body.sync_error).slice(0, 240) : null); }
  if (!fields.length) return res.json(device);
  values.push(id, req.user.id);
  db.prepare(`UPDATE devices SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM devices WHERE id = ?').get(id));
});

// 真实 Web Bluetooth 与模拟设备共用这一入库接口，统一写入 metrics.source=device。
router.post('/devices/:id/sync', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const device = db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!device) return res.status(404).json({ error: 'device not found' });
  const { type, value, value2, unit, recorded_at, battery_level, measurement_condition } = req.body || {};
  const markError = (message) => { db.prepare('UPDATE devices SET status = ?, sync_error = ? WHERE id = ? AND user_id = ?').run('error', String(message).slice(0, 240), id, req.user.id); };
  const def = type ? db.prepare('SELECT type, unit, value_type, min_value, max_value FROM metric_defs WHERE type = ?').get(type) : null;
  const numeric = Number(value);
  if (!def || !Number.isFinite(numeric)) { markError('unsupported metric or invalid value'); return res.status(400).json({ error: 'unsupported metric or invalid value' }); }
  if (def.min_value != null && numeric < def.min_value || def.max_value != null && numeric > def.max_value) { markError('value outside physical range'); return res.status(400).json({ error: 'value outside physical range' }); }
  const at = recorded_at && !Number.isNaN(Date.parse(recorded_at)) ? new Date(recorded_at).toISOString() : new Date().toISOString();
  if (def.value_type === 'dual' && (!Number.isFinite(Number(value2)) || Number(value2) < 30 || Number(value2) > 180)) { markError('invalid secondary metric value'); return res.status(400).json({ error: 'invalid secondary metric value' }); }
  const duplicate = db.prepare(`SELECT id FROM metrics WHERE user_id = ? AND type = ? AND value = ? AND COALESCE(value2, -999999) = COALESCE(?, -999999) AND abs(julianday(recorded_at) - julianday(?)) < (60.0 / 86400.0) LIMIT 1`).get(req.user.id, type, numeric, value2 == null ? null : Number(value2), at);
  if (duplicate) return res.status(200).json({ device, metric: db.prepare('SELECT * FROM metrics WHERE id = ?').get(duplicate.id), duplicate: true });
  const quality = { valid: true, duplicate: false, flags: [], source: 'device', device_id: id, condition_present: Boolean(measurement_condition) };
  const inserted = db.prepare('INSERT INTO metrics (user_id, type, value, value2, unit, recorded_at, source, device_id, measurement_condition, data_quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, type, numeric, value2 == null ? null : Number(value2), unit || def.unit, at, 'device', id, measurement_condition || null, JSON.stringify(quality));
  const battery = battery_level == null ? device.battery_level : Number(battery_level);
  db.prepare('UPDATE devices SET status = ?, last_sync = ?, battery_level = ?, sync_error = NULL WHERE id = ? AND user_id = ?')
    .run('connected', new Date().toISOString(), Number.isFinite(battery) ? Math.max(0, Math.min(100, battery)) : device.battery_level, id, req.user.id);
  res.status(201).json({ device: db.prepare('SELECT * FROM devices WHERE id = ?').get(id), metric: db.prepare('SELECT * FROM metrics WHERE id = ?').get(inserted.lastInsertRowid), quality });
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
  const healthSummary = { total_score, subscores, context: buildHealthContext(req.user, 90) };

  db.prepare(`INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'user', ?)`)
    .run(req.user.id, message);

  let result;
  try {
    result = await chat(history, message, healthSummary, req.user);
  } catch (err) {
    console.error('[chat] error:', err);
    return res.status(500).json({ error: 'agent error', detail: err.message });
  }

  const planJson = result.plan ? JSON.stringify(result.plan) : null;
  const confidenceJson = result.confidence ? JSON.stringify(result.confidence) : null;
  const evidence = buildEvidenceCard(healthSummary.context, message, result.confidence);
  const mergedEvidence = (evidence || result.evidence) ? { ...(evidence || {}), graph: result.evidence || null } : null;
    const evidenceJson = mergedEvidence ? JSON.stringify(mergedEvidence) : null;
    const graphEvidenceJson = result.evidence ? JSON.stringify(result.evidence) : null;
    const llm = result.llm || {
      provider: result.source || 'unknown',
      model: null,
      call_status: result.source === 'mock' ? 'mock' : result.source === 'tool' ? 'tool' : 'fallback',
      fallback_reason: result.source === 'mock' ? '未配置 DeepSeek' : null,
    };
    const graphIndexVersion = result.evidence?.index_version || result.evidence?.retrieval_trace?.index_version || null;
    const ins = db.prepare(`
      INSERT INTO chat_messages (user_id, role, content, plan, confidence, evidence, graph_evidence,
        provider, model, call_status, latency_ms, tool_calls, fallback_reason, graph_index_version)
      VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, result.content || '', planJson, confidenceJson, evidenceJson, graphEvidenceJson,
      llm.provider || result.source || 'unknown', llm.model || null, llm.call_status || 'unknown',
      Number.isFinite(Number(llm.latency_ms)) ? Number(llm.latency_ms) : null,
      JSON.stringify(llm.tool_calls || []), llm.fallback_reason || null, graphIndexVersion);
    db.prepare(`
      INSERT INTO llm_call_logs (user_id, chat_message_id, provider, model, status, latency_ms, tool_calls, fallback_reason, graph_index_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, ins.lastInsertRowid, llm.provider || result.source || 'unknown', llm.model || null,
      llm.call_status || 'unknown', Number.isFinite(Number(llm.latency_ms)) ? Number(llm.latency_ms) : null,
      JSON.stringify(llm.tool_calls || []), llm.fallback_reason || null, graphIndexVersion);

  res.json({
    id: ins.lastInsertRowid,
    role: 'assistant',
    content: result.content,
    plan: result.plan || [],
    confidence: result.confidence || { type: 'common_sense' },
      evidence: mergedEvidence,
      source: result.source,
      llm,
    });
});

router.get('/chat/history', (req, res) => {
  const rows = db.prepare(`
      SELECT id, role, content, plan, confidence, evidence, graph_evidence, provider, model, call_status, latency_ms, tool_calls, fallback_reason, graph_index_version, created_at FROM (
       SELECT id, role, content, plan, confidence, evidence, graph_evidence, provider, model, call_status, latency_ms, tool_calls, fallback_reason, graph_index_version, created_at FROM chat_messages
      WHERE user_id = ? ORDER BY id DESC LIMIT 50
    ) ORDER BY id ASC
  `).all(req.user.id);
  res.json(rows.map(r => ({
    ...r,
    plan: r.plan ? JSON.parse(r.plan) : null,
    confidence: r.confidence ? JSON.parse(r.confidence) : { type: 'common_sense' },
    evidence: r.evidence ? JSON.parse(r.evidence) : null,
      graph_evidence: r.graph_evidence ? JSON.parse(r.graph_evidence) : null,
      llm: { provider: r.provider, model: r.model, call_status: r.call_status, latency_ms: r.latency_ms, tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : [], fallback_reason: r.fallback_reason, graph_index_version: r.graph_index_version },
  })));
});

export default router;
