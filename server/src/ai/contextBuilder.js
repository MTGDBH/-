import db from '../db.js';

function latestRows(userId, days = 90) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare('SELECT type, value, value2, unit, recorded_at, source FROM metrics WHERE user_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC').all(userId, since);
}

export function buildHealthContext(user, days = 90) {
  const rows = latestRows(user.id, days);
  const byType = {};
  for (const row of rows) (byType[row.type] ||= []).push(row);
  const latest = Object.fromEntries(Object.entries(byType).map(([type, values]) => [type, values[values.length - 1]]));
  const trend_by_type = Object.fromEntries(Object.entries(byType).map(([type, values]) => {
    const first = Number(values[0]?.value);
    const last = Number(values[values.length - 1]?.value);
    const delta = Number.isFinite(first) && Number.isFinite(last) ? last - first : null;
    const tolerance = type === 'bp' ? 3 : type === 'glucose' ? 0.2 : type === 'sleep' ? 0.3 : 1;
    return [type, {
      direction: delta == null || Math.abs(delta) <= tolerance ? 'stable' : delta > 0 ? 'rising' : 'falling',
      first_value: Number.isFinite(first) ? first : null,
      last_value: Number.isFinite(last) ? last : null,
      delta: delta == null ? null : +delta.toFixed(2),
      start_date: values[0]?.recorded_at || null,
      end_date: values[values.length - 1]?.recorded_at || null,
    }];
  }));
  const behavior = {};
  for (const type of ['steps', 'sleep']) {
    const values = byType[type] || [];
    if (!values.length) continue;
    const avg = values.reduce((s, x) => s + Number(x.value), 0) / values.length;
    const recent = values.slice(-7);
    const recentAvg = recent.reduce((s, x) => s + Number(x.value), 0) / recent.length;
    behavior[type] = { data_points: values.length, average: +avg.toFixed(2), rolling_7d_average: +recentAvg.toFixed(2), latest: recent[recent.length - 1].value, latest_date: recent[recent.length - 1].recorded_at, interpretation: '行为模式参考，不是疾病未来预测' };
  }
  const todos = db.prepare('SELECT id, title, date, completed FROM todos WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(user.id);
  const alerts = db.prepare('SELECT id, metric_type, severity, title, message, created_at, status FROM alerts WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(user.id);
  return {
    window_days: days,
    data_points: rows.length,
    data_points_by_type: Object.fromEntries(Object.entries(byType).map(([type, values]) => [type, values.length])),
    latest,
    trend_by_type,
    behavior,
    todos,
    alerts,
    missing_common_metrics: ['bp', 'glucose', 'hr', 'sleep'].filter(t => !latest[t]),
    // 仅保留用于健康教育个性化的非敏感档案字段；不把临时模型预测写入长期上下文。
    profile: {
      age: user.age ?? null,
      gender: user.gender ?? null,
      bmi: user.bmi ?? null,
      smoking_status: user.smoking_status ?? null,
      drinking_status: user.drinking_status ?? null,
      exercise_level: user.exercise_level ?? null,
      chronic_diabetes: user.chronic_diabetes ?? null,
      chronic_heart: user.chronic_heart ?? null,
      chronic_stroke: user.chronic_stroke ?? null,
      dyslipidemia: user.dyslipidemia ?? null,
      lung_disease: user.lung_disease ?? null,
    },
  };
}

const EVIDENCE_LABELS = {
  bp: ['血压', 'mmHg'], glucose: ['血糖', 'mmol/L'], hr: ['心率', 'bpm'],
  sleep: ['睡眠', '小时'], steps: ['步数', '步'], weight: ['体重', 'kg'],
  bmi: ['BMI', ''], hba1c: ['糖化血红蛋白', '%'], cholesterol: ['胆固醇', 'mmol/L'],
  uricacid: ['尿酸', 'μmol/L'],
};

/** 由后端实际上下文生成证据卡片，避免模型自行编造日期、数值和来源。 */
export function buildEvidenceCard(context, message = '', confidence = {}) {
  const ctx = context || {};
  const items = Object.entries(ctx.latest || {}).map(([type, row]) => {
    const [label, defaultUnit] = EVIDENCE_LABELS[type] || [type, row?.unit || ''];
    const value = type === 'bp' && row?.value2 != null ? `${row.value}/${row.value2}` : row?.value;
    const trend = ctx.trend_by_type?.[type];
    return {
      metric: label,
      latest_value: value,
      unit: row?.unit || defaultUnit,
      measured_at: row?.recorded_at || null,
      source: row?.source || '未标注',
      data_points: ctx.data_points_by_type?.[type] || 1,
      period_days: ctx.window_days || 90,
      trend: trend?.direction || 'unknown',
      trend_delta: trend?.delta ?? null,
    };
  }).filter(x => x.latest_value != null).slice(0, 8);
  // 总体健康问题也属于数据型问题，不能因为没有点名某个指标而丢失证据卡片。
  const dataRelated = /血压|血糖|心率|睡眠|步数|活动|体重|趋势|风险|预测|建议|注意|健康|身体|总体|各项/.test(message);
  if (!dataRelated || !items.length) return null;
  return {
    generated_by: 'backend_health_context',
    period_days: ctx.window_days || 90,
    data_points: ctx.data_points || items.reduce((sum, x) => sum + x.data_points, 0),
    items,
    missing_metrics: ctx.missing_common_metrics || [],
    confidence: confidence?.type === 'data' ? { type: 'data', score: confidence.score ?? null } : { type: 'context', score: null },
  };
}
