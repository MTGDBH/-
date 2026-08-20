// ============================================================
// Agent Tool: risk_predict —— 高血压风险预测
//
// 数据流: 用户最近的健康数据(DB) → buildHtnPredictionInput(单位换算)
//         → predictHtn(Python XGBoost + 元数据指定的概率校准) → 影响因素分析
//
// 供 Agent 使用：用户问"高血压风险/健康预测"时调用
// ============================================================
import db from '../../db.js';
import { buildHtnPredictionInput, predictHtn } from '../../lib/htnPredictor.js';

const LOOKBACK_DAYS = 90;

/**
 * 计算影响因素：最新值 vs metric_defs 正常区间
 * @returns {Array<{type,name,value,unit,direction}>}
 */
function computeFactors(metrics) {
  const defs = db.prepare('SELECT type,name,unit,normal_min,normal_max FROM metric_defs').all();
  const factors = [];
  for (const d of defs) {
    const row = metrics[d.type];
    if (!row || row.value == null || d.normal_min == null || d.normal_max == null) continue;
    const v = row.value;
    if (v > d.normal_max) factors.push({ type: d.type, name: d.name, value: v, unit: d.unit, direction: 'high' });
    else if (v < d.normal_min) factors.push({ type: d.type, name: d.name, value: v, unit: d.unit, direction: 'low' });
  }
  return factors;
}

/** 读用户最近健康数据（每类最新一条） */
function latestMetrics(userId) {
  const types = db.prepare('SELECT type FROM metric_defs ORDER BY sort').all().map(r => r.type);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  const metrics = {};
  for (const t of types) {
    const row = db.prepare(`
      SELECT * FROM metrics
      WHERE user_id = ? AND type = ? AND recorded_at >= ?
      ORDER BY recorded_at DESC LIMIT 1
    `).get(userId, t, since);
    if (row) metrics[t] = row;
  }
  return metrics;
}

/** 生成数据摘要（供 LLM/文案引用） */
function summarize(metrics) {
  const parts = [];
  const fmt = (v, unit) => (v == null ? null : `${v}${unit || ''}`);
  const bp = metrics.bp;
  if (bp) parts.push(`血压 ${bp.value}/${bp.value2 ?? '--'} mmHg（${(bp.recorded_at || '').slice(0, 10)}）`);
  if (metrics.glucose) parts.push(`血糖 ${fmt(metrics.glucose.value, ' mmol/L')}（${(metrics.glucose.recorded_at || '').slice(0, 10)}）`);
  if (metrics.hr) parts.push(`心率 ${fmt(metrics.hr.value, ' bpm')}`);
  if (metrics.sleep) parts.push(`睡眠 ${fmt(metrics.sleep.value, ' h')}`);
  if (metrics.bmi == null && metrics.weight) parts.push(`体重 ${fmt(metrics.weight.value, ' kg')}`);
  return parts.length ? parts.join('、') : '暂无监测数据';
}

/**
 * 执行风险预测（Agent 工具）
 * @param {number} userId
 * @param {object} user  req.user（需 height 字段）
 * @returns {Promise<object>}
 */
export async function riskPredict(userId, user = {}) {
  const metrics = latestMetrics(userId);
  const dataCount = Object.keys(metrics).length;

  if (dataCount === 0) {
    return { success: false, error: 'no_data', message: '当前没有健康监测数据' };
  }

  const input = buildHtnPredictionInput(metrics, { height: user.height });
  const modelResult = await predictHtn(input); // 结构化，不抛异常

  return {
    ...modelResult,
    input,
    factors: computeFactors(metrics),
    summary: summarize(metrics),
    dataCount,
  };
}
