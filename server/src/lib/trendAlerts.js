// 指标保存后的趋势提醒：只做结构化规则判断，不在后台保存时调用大模型。
import db from '../db.js';
import { analyzeHealthTrend } from '../ai/tools/healthTrend.js';

const DB_TO_TREND = {
  bp: ['systo', 'diasto'],
  hr: ['pulse'],
  weight: ['weight', 'bmi'],
  waist: ['mwaist'],
  glucose: ['glucose'],
  hba1c: ['hbalc'],
  cholesterol: ['cholesterol'],
  uricacid: ['uricacid'],
  sleep: ['sleep'],
};

const TREND_NAMES = {
  systo: '收缩压', diasto: '舒张压', pulse: '心率', weight: '体重', bmi: 'BMI',
  mwaist: '腰围', glucose: '血糖', hbalc: '糖化血红蛋白', cholesterol: '胆固醇',
  uricacid: '尿酸', sleep: '睡眠',
};

function hasForecastBoundaryCrossing(result) {
  const bounds = result?.medical_bounds;
  const curve = result?.forecast?.curve;
  if (!result?.forecast?.available || !bounds || !curve) return false;
  const lower = curve.lower || [];
  const upper = curve.upper || [];
  return upper.some(v => v > bounds[1]) || lower.some(v => v < bounds[0]);
}

function buildRule(result) {
  if (result?.abnormal_spike) return 'abnormal_spike';
  const directional = ['rising', 'falling'].includes(result?.long_term_trend) ||
    ['rising', 'falling'].includes(result?.recent_trend);
  if (result?.trend_strength === 'strong' && directional) return 'strong_trend';
  if (hasForecastBoundaryCrossing(result)) return 'forecast_boundary';
  return null;
}

function buildAlert(result, rule) {
  const name = TREND_NAMES[result.metric] || result.metric;
  const direction = result.long_term_trend === 'falling' ? '下降' : '上升';
  let title = `${name}趋势提醒`;
  let message = `${name}当前记录为 ${result.latest_value}${result.unit || ''}，`;
  if (rule === 'abnormal_spike') {
    title += '：发现异常波动';
    message += '历史数据中发现一次明显异常波动，请先复测确认，不要仅凭单次数据判断。';
  } else if (rule === 'forecast_boundary') {
    title += '：预测区间需关注';
    message += `按最近趋势外推，未来 ${result.forecast.days} 天预测区间可能触及参考范围，请持续监测并在持续异常时咨询医生。`;
  } else {
    title += `：${direction}趋势明显`;
    message += `近期呈${direction}趋势（长期${result.long_term_trend}、近期${result.recent_trend}），建议固定时间继续记录。`;
  }
  return { title, message: `${message} 这是健康管理提醒，不代表医学诊断。` };
}

function alreadyAlerted(userId, metric, title) {
  return db.prepare(`
    SELECT id FROM alerts
    WHERE user_id = ? AND metric_type = ? AND title = ?
      AND created_at >= datetime('now', '-1 day')
    LIMIT 1
  `).get(userId, metric, title);
}

/**
 * 在指标保存后异步调用。返回本次新建的提醒，异常不向保存接口传播。
 */
export async function triggerTrendAlerts(userId, dbType) {
  const metrics = DB_TO_TREND[dbType] || [];
  if (!metrics.length) return [];
  const results = await Promise.all(metrics.map(metric =>
    analyzeHealthTrend(userId, { metric, days: 90 })
  ));
  const created = [];
  for (const result of results) {
    if (!result?.success || result.status !== 'ok') continue;
    const rule = buildRule(result);
    if (!rule) continue;
    const alert = buildAlert(result, rule);
    if (alreadyAlerted(userId, result.metric, alert.title)) continue;
    const inserted = db.prepare(`
      INSERT INTO alerts (user_id, metric_type, severity, title, message, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(userId, result.metric, 'warning', alert.title, alert.message);
    created.push({ id: Number(inserted.lastInsertRowid), metric: result.metric, rule });
  }
  return created;
}

