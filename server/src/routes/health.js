// 健康数据路由
import express from 'express';
import db from '../db.js';
import { evaluateHealth } from '../lib/scoring.js';
import { triggerTrendAlerts } from '../lib/trendAlerts.js';

const router = express.Router();

// 指标定义（单一数据源：metric_defs 表）
router.get('/metric-defs', (_req, res) => {
  const defs = db.prepare(`
    SELECT type, name, unit, value_type, min_value, max_value, normal_min, normal_max,
           frequency, ml_enabled, description, color, icon, sort
    FROM metric_defs ORDER BY sort
  `).all();
  res.json(defs);
});

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

// 获取所有指标的最新值（内置 + 用户自定义）
router.get('/metrics', (req, res) => {
  // 内置指标列表来自 metric_defs（vision/hearing 已移出核心体系）
  const builtInTypes = db.prepare('SELECT type FROM metric_defs ORDER BY sort').all().map(r => r.type);
  const result = {};
  for (const t of builtInTypes) {
    const row = db.prepare(`
      SELECT * FROM metrics
      WHERE user_id = ? AND type = ?
      ORDER BY recorded_at DESC LIMIT 1
    `).get(req.user.id, t);
    result[t] = row || null;
  }
  // 用户自定义指标
  const customs = db.prepare('SELECT * FROM custom_metrics WHERE user_id = ?').all(req.user.id);
  for (const c of customs) {
    const key = 'custom_' + c.id;
    const row = db.prepare(`
      SELECT * FROM metrics
      WHERE user_id = ? AND type = ?
      ORDER BY recorded_at DESC LIMIT 1
    `).get(req.user.id, key);
    result[key] = row ? { ...row, custom_name: c.name, custom_unit: c.unit, custom_icon: c.icon, custom_color: c.color } : null;
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
// source: manual（用户录入，默认）| device（真实设备）| synthetic（演示/测试）
router.post('/metrics', (req, res) => {
  const { type, value, value2, unit, recorded_at, source, note, device_id, measurement_condition } = req.body;
  if (!type || value == null) {
    return res.status(400).json({ error: 'missing type or value' });
  }
  // 兼容旧数据/调用方：source 白名单外的值归一为 manual
  const src = ['manual', 'device', 'synthetic'].includes(source) ? source : 'manual';
  const def = db.prepare('SELECT type, unit, value_type, min_value, max_value FROM metric_defs WHERE type = ?').get(type);
  const numeric = Number(value);
  if (!def || !Number.isFinite(numeric)) return res.status(400).json({ error: 'unsupported metric or invalid value' });
  const flags = [];
  if (def.min_value != null && numeric < def.min_value || def.max_value != null && numeric > def.max_value) flags.push('outside_physical_range');
  if (def.value_type === 'dual') {
    const second = Number(value2);
    if (!Number.isFinite(second)) flags.push('missing_secondary_value');
    if (Number.isFinite(second) && (second < 30 || second > 180)) flags.push('secondary_outside_physical_range');
  }
  const parsedAt = recorded_at && !Number.isNaN(Date.parse(recorded_at)) ? new Date(recorded_at) : new Date();
  if (parsedAt.getTime() > Date.now() + 5 * 60 * 1000) flags.push('future_timestamp');
  if (flags.length) return res.status(400).json({ error: 'invalid measurement', flags });
  const duplicate = db.prepare(`SELECT id FROM metrics WHERE user_id = ? AND type = ? AND value = ? AND COALESCE(value2, -999999) = COALESCE(?, -999999) AND abs(julianday(recorded_at) - julianday(?)) < (60.0 / 86400.0) LIMIT 1`).get(req.user.id, type, numeric, value2 == null ? null : Number(value2), parsedAt.toISOString());
  if (duplicate) {
    const existing = db.prepare('SELECT * FROM metrics WHERE id = ?').get(duplicate.id);
    return res.status(200).json({ ...existing, duplicate: true, quality: { valid: true, duplicate: true, flags: ['duplicate_measurement'] } });
  }
  const quality = { valid: true, duplicate: false, flags: [], source: src, timestamp_quality: recorded_at ? 'provided' : 'server_time', condition_present: Boolean(measurement_condition || note) };
  const r = db.prepare(`
    INSERT INTO metrics (user_id, type, value, value2, unit, recorded_at, source, note, device_id, measurement_condition, data_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, type, value, value2 ?? null, unit ?? null,
         parsedAt.toISOString(), src, note ?? null, device_id ?? null, measurement_condition ?? null, JSON.stringify(quality));
  const row = db.prepare('SELECT * FROM metrics WHERE id = ?').get(r.lastInsertRowid);
  // 趋势提醒异步执行，不阻塞指标保存；普通变化不会产生提醒。
  if (src !== 'synthetic') {
    triggerTrendAlerts(req.user.id, type).catch(err =>
      console.error('[trend-alert] analysis failed:', err.message)
    );
  }
  res.json({ ...row, quality });
});

export default router;
