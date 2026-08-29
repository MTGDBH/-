// 评估、待办、设备、对话路由（alerts 路由已拆分到 routes/alerts.js）
import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { evaluateHealth, aggregateMetrics } from '../lib/scoring.js';
import { chat } from '../ai/agent.js';
import { buildHealthContext, buildEvidenceCard } from '../ai/contextBuilder.js';
import { ensureConversation, refreshConversationSummary, resolveAgentSubject, runAgentV2 } from '../ai/orchestratorV2.js';
import { runAgentV3 } from '../ai/orchestratorV3.js';
import { listFollowups } from '../lib/followups.js';
import { recordLLM, recordSafetyRule } from '../services/opsMetrics.js';
import { interventionRepository } from '../repositories/interventionRepository.js';

const router = express.Router();
const agentV2Enabled = () => process.env.AGENT_ORCHESTRATOR_V2 !== '0';
const agentV3Enabled = () => process.env.AGENT_ORCHESTRATOR_V3 !== '0';

function parseJSON(value, fallback = null) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

function shanghaiDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function tipExcerpt(row) {
  return String(row.summary || row.body || '')
    .replace(/#{1,6}\s*/g, '').replace(/\*\*/g, '').replace(/^[-*]\s+/gm, '')
    .replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function matchingTipPreference(subjectId, tags) {
  const tagText = (tags || []).join('、');
  const allowed = [];
  if (/饮食|营养|喝水/.test(tagText)) allowed.push('diet');
  if (/运动|活动|拉伸|步行/.test(tagText)) allowed.push('goal');
  if (/睡眠|作息/.test(tagText)) allowed.push('schedule');
  if (!allowed.length) return null;
  return db.prepare(`SELECT category,content FROM agent_memories WHERE subject_user_id=? AND status='confirmed'
    AND category IN (${allowed.map(() => '?').join(',')}) AND (valid_until IS NULL OR valid_until>?) ORDER BY updated_at DESC LIMIT 1`)
    .get(subjectId, ...allowed, new Date().toISOString()) || null;
}

export function dailyTipForSubject(subject) {
  const rows = db.prepare(`SELECT id,title,summary,body,tags,audience,review_status,review_version,reviewed_at
    FROM knowledge_articles WHERE category='tip' AND audience IN ('senior','all') AND review_status<>'rejected' ORDER BY id`).all();
  const date = shanghaiDate();
  if (!rows.length) return { date, subject: { id: subject.id, name: subject.name }, status: 'empty', tip: null };
  const digest = crypto.createHash('sha256').update(`${date}:${subject.id}`).digest();
  const row = rows[digest.readUInt32BE(0) % rows.length];
  const tags = parseJSON(row.tags, []);
  const approved = row.review_status === 'approved';
  const preference = approved ? matchingTipPreference(subject.id, tags) : null;
  return {
    date, subject: { id: subject.id, name: subject.name }, status: 'ready',
    tip: {
      id: row.id, title: row.title, text: tipExcerpt(row), tags,
      display_status: approved ? 'approved' : 'research_preview', status_label: approved ? '已审核' : '研究预览',
      personalized: !!preference, why_for_you: preference ? '结合了您已确认的相关生活目标或偏好。' : null,
      review_version: approved ? row.review_version : null, reviewed_at: approved ? row.reviewed_at : null,
      source_label: '本地健康知识库', source_url: `knowledge.html?id=${row.id}`,
      safety_text: approved ? '这是日常健康管理参考，身体不适时请及时咨询医生。' : '该内容尚未完成医学审核，仅供研究预览，不作为个人医学建议。',
    },
  };
}

function serializeChatRow(row) {
  if (!row) return null;
  const feedback = row.id && row.actor_user_id ? db.prepare('SELECT rating,reason FROM agent_message_feedback WHERE message_id=? AND actor_user_id=?').get(row.id, row.actor_user_id) : null;
  return {
    ...row,
    plan: parseJSON(row.plan, null), confidence: parseJSON(row.confidence, { type: 'common_sense' }),
    evidence: parseJSON(row.evidence, null), presentation: parseJSON(row.presentation, null), graph_evidence: parseJSON(row.graph_evidence, null),
    prediction_snapshot: parseJSON(row.prediction_snapshot, null), graph_evidence_snapshot: parseJSON(row.graph_evidence_snapshot, null),
    linkage_version: row.linkage_version || null,
    tool_calls: parseJSON(row.tool_calls, []),
    feedback: feedback || null,
    llm: { provider: row.provider || 'unknown', model: row.model || null, call_status: row.call_status || 'unknown', latency_ms: row.latency_ms, tool_calls: parseJSON(row.tool_calls, []), fallback_reason: row.fallback_reason || null },
  };
}

function resolveAgentRequestSubject(req, rawId) {
  const resolved = resolveAgentSubject(req.user, rawId);
  if (resolved.error) return resolved;
  return resolved;
}

async function handleChatV2(req, res) {
  const message = String(req.body?.message || '').trim();
  const resolved = resolveAgentRequestSubject(req, req.body?.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const conversation = ensureConversation(req.user.id, resolved.subject.id, req.body?.conversation_id);
  if (!conversation) return res.status(404).json({ error: '对话不存在或不属于当前老人' });
  if (conversation.status !== 'active') return res.status(409).json({ error: '该对话已归档，请新建对话后继续' });
  const clientRequestId = String(req.body?.client_request_id || crypto.randomUUID()).slice(0, 100);
  const existingRun = db.prepare(`SELECT id,subject_user_id,conversation_id,status,output_message_id FROM agent_runs
    WHERE actor_user_id=? AND client_request_id=?`).get(req.user.id, clientRequestId);
  const sameRequestScope = existingRun && Number(existingRun.subject_user_id) === Number(resolved.subject.id)
    && Number(existingRun.conversation_id) === Number(conversation.id);
  if (sameRequestScope && existingRun.status === 'completed' && existingRun.output_message_id) {
    const existing = serializeChatRow(db.prepare('SELECT * FROM chat_messages WHERE id=?').get(existingRun.output_message_id));
    return res.json({
      ...existing,
      conversation_id: conversation.id,
      run_id: existingRun.id,
      tool_trace: existing.evidence?.tool_trace || [],
      memory_candidates: [],
      action_previews: [],
      idempotent_replay: true,
    });
  }
  if (existingRun) return res.status(409).json({ error: 'client_request_id 已被使用，请不要跨对话重复使用' });
  let userMessageId = null;
  if (req.body?._reuse_user_message_id) {
    const reused = db.prepare(`SELECT id FROM chat_messages WHERE id=? AND role='user' AND conversation_id=? AND actor_user_id=? AND subject_user_id=?`)
      .get(Number(req.body._reuse_user_message_id), conversation.id, req.user.id, resolved.subject.id);
    if (!reused) return res.status(404).json({ error: '原始用户消息不存在' });
    userMessageId = reused.id;
  } else {
    const userInsert = db.prepare(`INSERT INTO chat_messages
      (user_id,role,content,conversation_id,actor_user_id,subject_user_id,client_request_id)
      VALUES (?,'user',?,?,?,?,?)`).run(req.user.id, message, conversation.id, req.user.id, resolved.subject.id, clientRequestId);
    userMessageId = Number(userInsert.lastInsertRowid);
  }
  let result;
  try {
    result = agentV3Enabled()
      ? await runAgentV3({ actor: req.user, subject: resolved.subject, conversation, message, clientRequestId, userMessageId })
      : await runAgentV2({ actor: req.user, subject: resolved.subject, conversation, message, clientRequestId, userMessageId });
  } catch (error) {
    db.prepare(`UPDATE agent_runs SET status='error',error_code=?,completed_at=? WHERE actor_user_id=? AND client_request_id=?`).run(agentV3Enabled() ? 'AGENT_V3_FAILED' : 'AGENT_V2_FAILED', new Date().toISOString(), req.user.id, clientRequestId);
    console.error(agentV3Enabled() ? '[agent-v3] failed:' : '[agent-v2] failed:', error.message);
    return res.status(500).json({ error: 'agent error' });
  }
  const needsPersonalEvidence = !!result.context_manifest?.live_context_loaded;
  const healthContext = needsPersonalEvidence ? buildHealthContext(resolved.subject, 90) : null;
  const evidenceTypes = new Set(result.context_manifest?.live_metric_types || []);
  const evidenceContext = healthContext && evidenceTypes.size ? {
    ...healthContext,
    latest: Object.fromEntries(Object.entries(healthContext.latest || {}).filter(([type]) => evidenceTypes.has(type))),
    trend_by_type: Object.fromEntries(Object.entries(healthContext.trend_by_type || {}).filter(([type]) => evidenceTypes.has(type))),
    quality_by_type: Object.fromEntries(Object.entries(healthContext.quality_by_type || {}).filter(([type]) => evidenceTypes.has(type))),
    data_points_by_type: Object.fromEntries(Object.entries(healthContext.data_points_by_type || {}).filter(([type]) => evidenceTypes.has(type))),
  } : healthContext;
  const backendEvidence = evidenceContext ? buildEvidenceCard(evidenceContext, message, result.confidence) : null;
  const mergedEvidence = (backendEvidence || result.evidence) ? { ...(backendEvidence || {}), graph: result.evidence || null, tool_trace: result.tool_trace || [] } : { tool_trace: result.tool_trace || [] };
  const llm = result.__llm || result.llm || { provider: result.source || 'tool', model: null, call_status: result.source === 'safety_rule' ? 'safety_rule' : 'tool', tool_calls: [] };
  recordLLM(llm.call_status || 'tool', llm.latency_ms);
  if (result.source === 'safety_rule') recordSafetyRule();
  const assistantInsert = db.prepare(`INSERT INTO chat_messages
    (user_id,role,content,plan,confidence,evidence,presentation,graph_evidence,prediction_snapshot,graph_evidence_snapshot,linkage_version,
     provider,model,call_status,latency_ms,tool_calls,fallback_reason,conversation_id,actor_user_id,subject_user_id,parent_message_id,supersedes_message_id,run_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      req.user.id, 'assistant', result.content || '', JSON.stringify(result.plan || []), JSON.stringify(result.confidence || { type: 'common_sense' }), JSON.stringify(mergedEvidence), JSON.stringify(result.presentation || { mode: 'plain' }),
      result.graph_evidence_snapshot ? JSON.stringify(result.graph_evidence_snapshot) : null,
      result.prediction_snapshot ? JSON.stringify(result.prediction_snapshot) : null,
      result.graph_evidence_snapshot ? JSON.stringify(result.graph_evidence_snapshot) : null,
      result.linkage_version || null,
      llm.provider || result.source || 'tool', llm.model || null, llm.call_status || 'tool', Number.isFinite(Number(llm.latency_ms)) ? Number(llm.latency_ms) : null,
      JSON.stringify((result.tool_trace || []).map(item => item.name)), llm.fallback_reason || null,
      conversation.id, req.user.id, resolved.subject.id, userMessageId, req.body?._supersedes_message_id || null, result.run_id);
  db.prepare(`INSERT INTO llm_call_logs
    (user_id,chat_message_id,provider,model,status,latency_ms,tool_calls,fallback_reason,graph_index_version)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
      req.user.id, assistantInsert.lastInsertRowid, llm.provider || result.source || 'tool', llm.model || null,
      llm.call_status || 'tool', Number.isFinite(Number(llm.latency_ms)) ? Number(llm.latency_ms) : null,
      JSON.stringify((result.tool_trace || []).map(item => item.name)), llm.fallback_reason || null,
      result.evidence?.index_version || result.evidence?.version || null);
  db.prepare('UPDATE agent_runs SET output_message_id=? WHERE id=?').run(assistantInsert.lastInsertRowid, result.run_id);
  db.prepare('UPDATE agent_conversations SET updated_at=? WHERE id=?').run(new Date().toISOString(), conversation.id);
  refreshConversationSummary(conversation.id);
  return res.json({
    id: assistantInsert.lastInsertRowid, role: 'assistant', content: result.content, plan: result.plan || [], confidence: result.confidence || { type: 'common_sense' },
    evidence: mergedEvidence, presentation: result.presentation || { mode: 'plain' }, source: result.source || llm.provider, llm, conversation_id: conversation.id, run_id: result.run_id,
    tool_trace: result.tool_trace || [], memory_candidates: result.memory_candidates || [], action_previews: result.action_previews || [],
    prediction_snapshot: result.prediction_snapshot || null, graph_evidence_snapshot: result.graph_evidence_snapshot || null,
    linkage_version: result.linkage_version || null,
  });
}

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

  // ADL / IADL：优先读取统一健康档案问卷，旧 assessments 记录仅作兼容回退。
  const latestIntake = db.prepare(`
    SELECT scores, recorded_at FROM health_intakes
    WHERE subject_user_id = ? AND status = 'completed'
    ORDER BY recorded_at DESC, id DESC LIMIT 1
  `).get(req.user.id);
  let intakeScores = {};
  try { intakeScores = latestIntake ? JSON.parse(latestIntake.scores || '{}') : {}; } catch { intakeScores = {}; }
  const lastAssess = db.prepare(`
    SELECT adl, iadl FROM assessments WHERE user_id = ? ORDER BY id DESC LIMIT 1
  `).get(req.user.id);
  const adl = Number.isFinite(Number(intakeScores.adlab_c)) ? Number(intakeScores.adlab_c) : (lastAssess?.adl ?? null);
  const iadl = Number.isFinite(Number(intakeScores.iadl)) ? Number(intakeScores.iadl) : (lastAssess?.iadl ?? null);

  res.json({
    total_score: evaluation.total_score,
    subscores: evaluation.subscores,
    scoring_details: evaluation.scoring_details,
    adl,
    iadl,
    functional_evaluated_at: latestIntake?.recorded_at ?? null,
    functional_complete: adl != null && iadl != null,
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
router.get('/chat/conversations', (req, res) => {
  const resolved = resolveAgentRequestSubject(req, req.query.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const items = db.prepare(`SELECT id,title,status,summary,created_at,updated_at FROM agent_conversations
    WHERE actor_user_id=? AND subject_user_id=? ORDER BY updated_at DESC,id DESC LIMIT 50`).all(req.user.id, resolved.subject.id)
    .map(row => ({ ...row, summary: parseJSON(row.summary, {}) }));
  res.json({ subject: { id: resolved.subject.id, name: resolved.subject.name }, items });
});

router.post('/chat/conversations', (req, res) => {
  const resolved = resolveAgentRequestSubject(req, req.body?.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const title = String(req.body?.title || '新对话').trim().slice(0, 80) || '新对话';
  const inserted = db.prepare('INSERT INTO agent_conversations (actor_user_id,subject_user_id,title) VALUES (?,?,?)').run(req.user.id, resolved.subject.id, title);
  res.status(201).json(db.prepare('SELECT * FROM agent_conversations WHERE id=?').get(inserted.lastInsertRowid));
});

router.post('/chat/conversations/:id/archive', (req, res) => {
  const updated = db.prepare(`UPDATE agent_conversations SET status='archived',updated_at=? WHERE id=? AND actor_user_id=?`).run(new Date().toISOString(), Number(req.params.id), req.user.id);
  if (!updated.changes) return res.status(404).json({ error: '对话不存在' });
  res.json({ ok: true });
});

router.get('/agent/daily-tip', (req, res) => {
  const resolved = resolveAgentRequestSubject(req, req.query.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  res.json(dailyTipForSubject(resolved.subject));
});

router.get('/agent/memories', (req, res) => {
  const resolved = resolveAgentRequestSubject(req, req.query.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const items = db.prepare(`SELECT id,category,memory_key,content,status,source_message_id,valid_until,confirmed_at,created_at,updated_at
    FROM agent_memories WHERE subject_user_id=? AND status IN ('candidate','confirmed')
    AND (status='candidate' OR valid_until IS NULL OR valid_until>?) ORDER BY status,updated_at DESC`).all(resolved.subject.id, new Date().toISOString());
  res.json({ subject: { id: resolved.subject.id, name: resolved.subject.name }, items });
});

router.post('/agent/memories/:id/confirm', (req, res) => {
  const memory = db.prepare('SELECT * FROM agent_memories WHERE id=?').get(Number(req.params.id));
  if (!memory) return res.status(404).json({ error: '记忆候选不存在' });
  const resolved = resolveAgentRequestSubject(req, memory.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const now = new Date().toISOString();
  db.transaction(() => {
    const oldRows = db.prepare(`SELECT id FROM agent_memories WHERE subject_user_id=? AND memory_key=? AND status='confirmed' AND id<>?`).all(memory.subject_user_id, memory.memory_key, memory.id);
    db.prepare(`UPDATE agent_memories SET status='confirmed',confirmed_at=?,updated_at=? WHERE id=? AND status IN ('candidate','confirmed')`).run(now, now, memory.id);
    for (const old of oldRows) db.prepare(`UPDATE agent_memories SET status='superseded',superseded_by=?,updated_at=? WHERE id=?`).run(memory.id, now, old.id);
  })();
  res.json(db.prepare('SELECT * FROM agent_memories WHERE id=?').get(memory.id));
});

router.post('/agent/memories/:id/reject', (req, res) => {
  const memory = db.prepare('SELECT * FROM agent_memories WHERE id=?').get(Number(req.params.id));
  if (!memory) return res.status(404).json({ error: '记忆候选不存在' });
  const resolved = resolveAgentRequestSubject(req, memory.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  db.prepare(`UPDATE agent_memories SET status='rejected',updated_at=? WHERE id=?`).run(new Date().toISOString(), memory.id);
  res.json({ ok: true });
});

router.patch('/agent/memories/:id', (req, res) => {
  const memory = db.prepare('SELECT * FROM agent_memories WHERE id=?').get(Number(req.params.id));
  if (!memory) return res.status(404).json({ error: '记忆不存在' });
  const resolved = resolveAgentRequestSubject(req, memory.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const content = String(req.body?.content || '').trim().slice(0, 240);
  if (!content) return res.status(400).json({ error: '记忆内容不能为空' });
  if (/风险|概率|确诊|诊断|急救|血压.{0,8}\d|血糖.{0,8}\d|\d+\s*(?:mg|毫克|片|粒)/i.test(content)) return res.status(400).json({ error: '健康数值、风险和药物剂量不能保存为长期记忆' });
  if (memory.status !== 'confirmed') {
    db.prepare('UPDATE agent_memories SET content=?,updated_at=? WHERE id=?').run(content, new Date().toISOString(), memory.id);
    return res.json(db.prepare('SELECT * FROM agent_memories WHERE id=?').get(memory.id));
  }
  const now = new Date().toISOString();
  let replacementId;
  db.transaction(() => {
    const inserted = db.prepare(`INSERT INTO agent_memories
      (subject_user_id,actor_user_id,category,memory_key,content,status,source_message_id,valid_until,confirmed_at,updated_at)
      VALUES (?,?,?,?,?,'confirmed',?,?,?,?)`).run(
        memory.subject_user_id, req.user.id, memory.category, memory.memory_key, content,
        memory.source_message_id, memory.valid_until, now, now);
    replacementId = Number(inserted.lastInsertRowid);
    db.prepare(`UPDATE agent_memories SET status='superseded',superseded_by=?,updated_at=? WHERE id=?`).run(replacementId, now, memory.id);
  })();
  res.json(db.prepare('SELECT * FROM agent_memories WHERE id=?').get(replacementId));
});

router.delete('/agent/memories/:id', (req, res) => {
  const memory = db.prepare('SELECT * FROM agent_memories WHERE id=?').get(Number(req.params.id));
  if (!memory) return res.status(404).json({ error: '记忆不存在' });
  const resolved = resolveAgentRequestSubject(req, memory.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  db.prepare('DELETE FROM agent_memories WHERE id=?').run(memory.id);
  res.json({ ok: true });
});

router.post('/chat/messages/:id/regenerate', async (req, res) => {
  const assistant = db.prepare(`SELECT * FROM chat_messages WHERE id=? AND role='assistant' AND actor_user_id=?`).get(Number(req.params.id), req.user.id);
  if (!assistant?.parent_message_id) return res.status(404).json({ error: '可重新生成的回答不存在' });
  const userMessage = db.prepare(`SELECT * FROM chat_messages WHERE id=? AND role='user' AND conversation_id=?`).get(assistant.parent_message_id, assistant.conversation_id);
  if (!userMessage) return res.status(404).json({ error: '原始用户消息不存在' });
  req.body = {
    message: userMessage.content, conversation_id: assistant.conversation_id, subject_user_id: assistant.subject_user_id,
    client_request_id: String(req.body?.client_request_id || crypto.randomUUID()).slice(0, 100),
    _reuse_user_message_id: userMessage.id, _supersedes_message_id: assistant.id,
  };
  return handleChatV2(req, res);
});

router.get('/agent/inbox', (req, res) => {
  const resolved = resolveAgentRequestSubject(req, req.query.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const allItems = listFollowups(resolved.subject.id, { activeOnly: false, limit: 50 });
  const items = allItems.filter(row => ['scheduled','due','overdue','pending_result_confirmation'].includes(row.status));
  const actions = db.prepare(`SELECT id,action_type,payload,status,created_at FROM action_requests
    WHERE actor_user_id=? AND subject_user_id=? AND status='pending_confirmation' ORDER BY id DESC LIMIT 20`).all(req.user.id, resolved.subject.id)
    .map(row => ({ ...row, payload: parseJSON(row.payload, {}) }));
  const interventions = interventionRepository.listForSubject(resolved.subject.id, { limit: 30 });
  const activeInterventions = interventions.filter(row => ['active','evaluating'].includes(row.status));
  const recentEvaluations = db.prepare(`SELECT e.evaluation_id,e.target_metric,e.evidence_level,e.reason_code,e.created_at,i.intervention_id,i.title
    FROM intervention_evaluations e JOIN interventions i ON i.id=e.intervention_db_id
    WHERE e.subject_user_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 5`).all(resolved.subject.id);
  res.json({ subject: { id: resolved.subject.id, name: resolved.subject.name },
    due: items.filter(row => row.status === 'due'), overdue: items.filter(row => row.status === 'overdue'),
    pending_result_confirmation: items.filter(row => row.status === 'pending_result_confirmation'),
    scheduled: items.filter(row => row.status === 'scheduled'), recently_completed: allItems.filter(row => row.status === 'completed').sort((a,b) => String(b.completed_at || '').localeCompare(String(a.completed_at || ''))).slice(0, 3), pending_actions: actions,
    active_interventions: activeInterventions, recent_intervention_evaluations: recentEvaluations,
    counts: { total: items.length, due: items.filter(row => row.status === 'due').length, overdue: items.filter(row => row.status === 'overdue').length,
      pending_confirmation: items.filter(row => row.status === 'pending_result_confirmation').length,
      active_interventions: activeInterventions.length } });
});

router.put('/agent/messages/:id/feedback', (req, res) => {
  const message = db.prepare(`SELECT m.*,r.intent FROM chat_messages m LEFT JOIN agent_runs r ON r.id=m.run_id
    WHERE m.id=? AND m.role='assistant' AND m.actor_user_id=?`).get(Number(req.params.id), req.user.id);
  if (!message) return res.status(404).json({ error: '回答不存在' });
  const resolved = resolveAgentRequestSubject(req, message.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const rating = String(req.body?.rating || '');
  if (!['like', 'dislike'].includes(rating)) return res.status(400).json({ error: 'rating must be like or dislike' });
  const allowedReasons = new Set(['没看懂', '数据不对', '建议没用', '没有回答问题']);
  const reason = rating === 'dislike' && allowedReasons.has(req.body?.reason) ? req.body.reason : null;
  const mode = parseJSON(message.presentation, {})?.mode || null;
  db.prepare(`INSERT INTO agent_message_feedback (message_id,run_id,actor_user_id,subject_user_id,rating,reason,intent,presentation_mode)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(message_id,actor_user_id) DO UPDATE SET rating=excluded.rating,reason=excluded.reason,intent=excluded.intent,presentation_mode=excluded.presentation_mode,updated_at=datetime('now','localtime')`)
    .run(message.id, message.run_id, req.user.id, message.subject_user_id, rating, reason, message.intent || '{}', mode);
  res.json(db.prepare('SELECT rating,reason,updated_at FROM agent_message_feedback WHERE message_id=? AND actor_user_id=?').get(message.id, req.user.id));
});

router.delete('/agent/messages/:id/feedback', (req, res) => {
  const message = db.prepare(`SELECT id,subject_user_id FROM chat_messages WHERE id=? AND role='assistant' AND actor_user_id=?`).get(Number(req.params.id), req.user.id);
  if (!message) return res.status(404).json({ error: '回答不存在' });
  const resolved = resolveAgentRequestSubject(req, message.subject_user_id);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  db.prepare('DELETE FROM agent_message_feedback WHERE message_id=? AND actor_user_id=?').run(message.id, req.user.id);
  res.json({ ok: true });
});

router.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (agentV2Enabled()) return handleChatV2(req, res);

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
    recordLLM(llm.call_status || 'unknown', llm.latency_ms);
    if (result.source === 'safety_rule') recordSafetyRule();
    const graphIndexVersion = result.evidence?.index_version || result.evidence?.retrieval_trace?.index_version || null;
    const ins = db.prepare(`
      INSERT INTO chat_messages (user_id, role, content, plan, confidence, evidence, graph_evidence,
        prediction_snapshot, graph_evidence_snapshot, linkage_version,
        provider, model, call_status, latency_ms, tool_calls, fallback_reason, graph_index_version)
      VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, result.content || '', planJson, confidenceJson, evidenceJson, graphEvidenceJson,
      result.prediction_snapshot ? JSON.stringify(result.prediction_snapshot) : null,
      result.graph_evidence_snapshot ? JSON.stringify(result.graph_evidence_snapshot) : null,
      result.linkage_version || null,
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
      prediction_snapshot: result.prediction_snapshot || null,
      graph_evidence_snapshot: result.graph_evidence_snapshot || null,
      linkage_version: result.linkage_version || null,
    });
});

router.get('/chat/history', (req, res) => {
  if (agentV2Enabled()) {
    const resolved = resolveAgentRequestSubject(req, req.query.subject_user_id);
    if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
    const conversation = ensureConversation(req.user.id, resolved.subject.id, req.query.conversation_id);
    if (!conversation) return res.status(404).json({ error: '对话不存在或不属于当前老人' });
    const rows = db.prepare(`SELECT m.* FROM (
      SELECT * FROM chat_messages WHERE conversation_id=? AND actor_user_id=?
      ORDER BY id DESC LIMIT 50
    ) m WHERE NOT EXISTS (SELECT 1 FROM chat_messages newer WHERE newer.supersedes_message_id=m.id)
    ORDER BY m.id ASC`).all(conversation.id, req.user.id).map(serializeChatRow);
    return res.json(rows.map(row => ({ ...row, conversation_id: conversation.id })));
  }
  const rows = db.prepare(`
      SELECT id, role, content, plan, confidence, evidence, graph_evidence, prediction_snapshot, graph_evidence_snapshot, linkage_version, provider, model, call_status, latency_ms, tool_calls, fallback_reason, graph_index_version, created_at FROM (
       SELECT id, role, content, plan, confidence, evidence, graph_evidence, prediction_snapshot, graph_evidence_snapshot, linkage_version, provider, model, call_status, latency_ms, tool_calls, fallback_reason, graph_index_version, created_at FROM chat_messages
      WHERE user_id = ? ORDER BY id DESC LIMIT 50
    ) ORDER BY id ASC
  `).all(req.user.id);
  res.json(rows.map(r => ({
    ...r,
    plan: r.plan ? JSON.parse(r.plan) : null,
    confidence: r.confidence ? JSON.parse(r.confidence) : { type: 'common_sense' },
    evidence: r.evidence ? JSON.parse(r.evidence) : null,
      graph_evidence: r.graph_evidence ? JSON.parse(r.graph_evidence) : null,
      prediction_snapshot: r.prediction_snapshot ? JSON.parse(r.prediction_snapshot) : null,
      graph_evidence_snapshot: r.graph_evidence_snapshot ? JSON.parse(r.graph_evidence_snapshot) : null,
      linkage_version: r.linkage_version || null,
      llm: { provider: r.provider, model: r.model, call_status: r.call_status, latency_ms: r.latency_ms, tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : [], fallback_reason: r.fallback_reason, graph_index_version: r.graph_index_version },
  })));
});

export default router;
