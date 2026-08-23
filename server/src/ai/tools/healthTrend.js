// ============================================================
// Agent Tool: analyze_health_trend —— 健康指标趋势分析
//
// 数据流: 数据库(最近 N 天指标) → health_curve.py(拟合/趋势/异常/forecast) → 结构化结果
//
// 安全:
//   - LLM 只能传 metric、days；userId 由 req.user 注入
//   - metric 白名单校验；days 限 7~365
//   - 禁止 LLM 指定数据库/SQL/模型路径/Python 路径
// ============================================================
import db from '../../db.js';
import { runPythonTool } from '../../lib/htnPredictor.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURVE_SCRIPT = path.resolve(__dirname, '..', '..', '..', '..', 'ml', 'curve', 'health_curve.py');

// APP 字段 → DB type/取值器/单位（只支持实际存在的字段）
export const TREND_METRICS = {
  systo:      { type: 'bp',  pick: r => r.value,  unit: 'mmHg' },
  diasto:     { type: 'bp',  pick: r => r.value2, unit: 'mmHg' },
  pulse:      { type: 'hr',  pick: r => r.value,  unit: 'bpm' },
  weight:     { type: 'weight', pick: r => r.value, unit: 'kg' },
  bmi:        { type: 'weight', pick: r => r.value, unit: 'kg/m²' }, // bmi 由体重+身高推导，见 buildPoints
  mwaist:     { type: 'waist', pick: r => r.value, unit: 'cm' },
  glucose:    { type: 'glucose', pick: r => r.value, unit: 'mmol/L' },
  hbalc:      { type: 'hba1c', pick: r => r.value, unit: '%' },
  cholesterol:{ type: 'cholesterol', pick: r => r.value, unit: 'mmol/L' },
  uricacid:   { type: 'uricacid', pick: r => r.value, unit: 'μmol/L' },
  sleep:      { type: 'sleep', pick: r => r.value, unit: 'h' },
};

const LOOKBACK_MAX = 365;

/** 读取某 DB type 在 days 内的记录（升序） */
function fetchPoints(userId, dbType, sinceIso) {
  return db.prepare(`
    SELECT value, value2, recorded_at FROM metrics
    WHERE user_id = ? AND type = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(userId, dbType, sinceIso);
}

/** 构建单个指标的 points 数组（bmi 用体重+身高推导） */
function buildPoints(userId, metric, days) {
  const def = TREND_METRICS[metric];
  if (!def) return { ok: false, error: `不支持的指标: ${metric}` };
  const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const rows = fetchPoints(userId, def.type, sinceIso);
  const points = [];
  for (const r of rows) {
    let v = def.pick(r);
    if (metric === 'bmi') {
      // bmi = weight / height²；身高缺失则跳过该点
      const u = db.prepare('SELECT height FROM users WHERE id = ?').get(userId);
      if (!u?.height) continue;
      v = r.value / (u.height * u.height);
    }
    if (v == null) continue;
    points.push({ t: r.recorded_at, v: Math.round(v * 10000) / 10000 });
  }
  return { ok: true, points, unit: def.unit, rawCount: rows.length };
}

/**
 * 单指标趋势分析
 * @param {number} userId
 * @param {object} [opts] { metric, days }
 */
export async function analyzeHealthTrend(userId, opts = {}) {
  const metric = String(opts.metric || 'all');
  const days = Math.max(7, Math.min(LOOKBACK_MAX, parseInt(opts.days || '90', 10) || 90));

  if (metric !== 'all') {
    if (!TREND_METRICS[metric]) return { success: false, error: `不支持的指标: ${metric}` };
    const built = buildPoints(userId, metric, days);
    if (!built.ok) return { success: false, error: built.error };
    const result = await runPythonTool(CURVE_SCRIPT, {
      metric, unit: built.unit, points: built.points, forecast_days: 30,
    });
    return { ...result, metric, requested_days: days };
  }

  // metric=all: 一次 Python 调用批量分析所有有数据的指标（性能：单次 spawn）
  const batch = [];
  for (const m of Object.keys(TREND_METRICS)) {
    const built = buildPoints(userId, m, days);
    if (!built.ok || built.points.length === 0) continue;
    batch.push({ metric: m, unit: built.unit, points: built.points });
  }
  if (!batch.length) {
    return { success: true, metric: 'all', requested_days: days, analyzed: [], metrics: [], co_occurrence: {}, note: 'co_occurrence 仅描述多个指标同时出现的变化方向，不表示因果关系' };
  }
  const bulk = await runPythonTool(CURVE_SCRIPT, { batch, forecast_days: 30 });
  if (!bulk.success) return bulk;
  const results = (bulk.metrics || []).filter(r => r.success && r.status === 'ok');
  const dirMap = {};
  for (const r of results) dirMap[r.metric] = r.long_term_trend;
  return {
    success: true,
    metric: 'all',
    requested_days: days,
    analyzed: results.map(r => r.metric),
    metrics: results,
    co_occurrence: dirMap,
    note: 'co_occurrence 仅描述多个指标同时出现的变化方向，不表示因果关系',
  };
}

/** 多指标一次 Python 批处理；只返回本次问题需要的指标。 */
export async function analyzeSelectedHealthTrends(userId, metrics = [], daysInput = 90) {
  const days = Math.max(7, Math.min(LOOKBACK_MAX, parseInt(daysInput || '90', 10) || 90));
  const selected = [...new Set((metrics || []).map(String))].filter(metric => TREND_METRICS[metric]);
  if (!selected.length) return { success: true, metric: 'selected', requested_days: days, analyzed: [], metrics: [] };
  const batch = [];
  for (const metric of selected) {
    const built = buildPoints(userId, metric, days);
    if (built.ok && built.points.length) batch.push({ metric, unit: built.unit, points: built.points });
  }
  if (!batch.length) return { success: true, metric: 'selected', requested_days: days, analyzed: [], metrics: [], status: 'insufficient_data' };
  const bulk = await runPythonTool(CURVE_SCRIPT, { batch, forecast_days: 30 });
  if (!bulk.success) return bulk;
  const results = (bulk.metrics || []).filter(result => selected.includes(result.metric));
  const dataFreshness = batch.flatMap(item => item.points).map(point => point.t).filter(Boolean).sort().at(-1) || null;
  return {
    success: true, metric: 'selected', requested_days: days,
    analyzed: results.filter(result => result.status === 'ok').map(result => result.metric),
    metrics: results,
    data_freshness: dataFreshness,
    note: '多个指标同时变化不代表因果关系',
  };
}
