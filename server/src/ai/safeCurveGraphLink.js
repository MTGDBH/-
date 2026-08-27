import crypto from 'node:crypto';

export const CURVE_GRAPH_LINK_VERSION = 'curve-graphrag-link.v1';
export const PREDICTION_EVENT_VERSION = 'curve-prediction-event.v1';
export const GRAPH_EVIDENCE_SNAPSHOT_VERSION = 'graph-evidence-snapshot.v1';

const ALLOWED_PURPOSES = Object.freeze({
  measurement_recheck: /测量|复测|复查|姿势|袖带|空腹|餐后|静息|条件一致/,
  continuous_monitoring: /连续|趋势|监测|记录|多次|一周|数周/,
  danger_signals: /危险信号|急救|胸痛|呼吸困难|意识|单侧无力|言语不清|昏迷|抽搐/,
  clinician_evaluation: /医生|医务|评估|就医|门诊|临床|专业人员/,
  medication_boundary: /药物|用药|药量|剂量|自行调整|停药/,
});

const METRIC_NAMES = Object.freeze({
  systo: '高压（收缩压）', diasto: '低压（舒张压）', pulse: '心率', glucose: '血糖',
  weight: '体重', bmi: '体重指数', mwaist: '腰围', hbalc: '糖化血红蛋白',
  cholesterol: '胆固醇', uricacid: '尿酸', sleep: '睡眠',
});

function finite(value) { return Number.isFinite(Number(value)); }
function rounded(value) { return finite(value) ? Number(Number(value).toFixed(4)) : null; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
function numericTokens(value) { return String(value || '').match(/\d+(?:\.\d+)?/g) || []; }

function qualityFlags(row) {
  const flags = [];
  if (row.status !== 'ok') flags.push('insufficient_data');
  if (Number(row.removed_outliers || 0) > 0) flags.push('outliers_removed');
  if (row.abnormal_spike) flags.push('abnormal_spike');
  if (row.fluctuation === 'high') flags.push('high_fluctuation');
  if (row.measurement_condition_complete === false) flags.push('measurement_condition_incomplete');
  if (row.forecast?.calibration_status === 'not_available') flags.push('calibration_unavailable');
  if (row.forecast?.boundary_hit) flags.push('medical_display_boundary_hit');
  return [...new Set([...(row.quality_flags || []), ...flags])];
}

function forecastInterval(row) {
  if (!row.forecast?.available) return null;
  const curve = row.forecast.curve || {};
  const lower = (curve.lower || []).map(rounded).filter(value => value != null);
  const upper = (curve.upper || []).map(rounded).filter(value => value != null);
  if (!lower.length || lower.length !== upper.length) return null;
  return {
    lower,
    upper,
    horizon_days: Number(row.forecast.horizon_days || lower.length),
    coverage_target: rounded(row.forecast.coverage_target),
    calibration_coverage: rounded(row.forecast.calibration_coverage),
    mean_width: rounded(row.forecast.mean_interval_width),
  };
}

export function createPredictionEvent(row, predictionTimestamp = new Date().toISOString()) {
  const interval = forecastInterval(row);
  const event = {
    schema_version: PREDICTION_EVENT_VERSION,
    metric: String(row.metric || 'unknown'),
    latest_value: rounded(row.latest_value),
    trend: ['rising', 'falling', 'stable'].includes(row.long_term_trend) ? row.long_term_trend : 'unknown',
    forecast_available: Boolean(row.forecast?.available && interval),
    forecast_interval: interval,
    quality_flags: qualityFlags(row),
    condition_coverage: rounded(row.measurement_condition_coverage),
    boundary_hit: Boolean(row.forecast?.boundary_hit),
    change_point: Boolean(row.change_point),
    model_version: String(row.model_version || `${row.schema_version || 'curve.v2'}:${row.forecast?.model || row.model || 'none'}`),
    prediction_timestamp: String(predictionTimestamp),
  };
  if (!event.forecast_available) event.forecast_interval = null;
  event.snapshot_hash = digest(event);
  return deepFreeze(event);
}

export function buildPredictionSnapshot(trendResult, capturedAt = new Date().toISOString()) {
  const events = (trendResult?.metrics || []).map(row => createPredictionEvent(row, capturedAt));
  const snapshot = { schema_version: PREDICTION_EVENT_VERSION, captured_at: capturedAt, events };
  snapshot.snapshot_hash = digest(snapshot);
  return deepFreeze(snapshot);
}

export function buildControlledGraphQuery(events) {
  const metrics = [...new Set((events || []).map(event => METRIC_NAMES[event.metric] || event.metric))].join('、') || '该指标';
  return `${metrics}：只检索已经人工审核的正确测量与复测方法、连续异常监测建议、危险信号、需要医生评估的条件，以及不得自行调整药物的边界。不要检索诊断结论、预测数值或未经审核阈值。`;
}

export function curveGraphContext(events) {
  const byMetric = Object.fromEntries((events || []).map(event => [event.metric, {
    value: event.latest_value, trend: event.trend, forecast_available: event.forecast_available,
    quality_flags: event.quality_flags, condition_coverage: event.condition_coverage,
  }]));
  const context = { curve_prediction_event: { schema_version: PREDICTION_EVENT_VERSION, metrics: byMetric } };
  const systo = byMetric.systo, diasto = byMetric.diasto;
  if (systo || diasto) context.latest = { bp: { value: systo?.value ?? null, value2: diasto?.value ?? null } };
  else if (byMetric.glucose) context.latest = { glucose: { value: byMetric.glucose.value } };
  else context.latest = {};
  return context;
}

function evidencePurpose(row) {
  const text = `${row.section || ''} ${row.text || ''} ${row.citation || ''}`;
  return Object.entries(ALLOWED_PURPOSES).filter(([, pattern]) => pattern.test(text)).map(([purpose]) => purpose);
}

function isApproved(row) {
  return row?.source_review_state === 'approved' || String(row?.review_status || '').toLowerCase() === 'approved';
}

function citationSupportsAction(action, evidence) {
  const actionText = `${action.action || ''} ${action.reason || ''}`;
  const evidenceText = `${evidence.section || ''} ${evidence.text || ''}`;
  const assertsThreshold = /(?:>=|<=|>|<|达到|超过|高于|低于|不少于|不超过|mmhg|mmol|%)/i.test(actionText);
  if (!assertsThreshold) return true;
  const numbers = numericTokens(actionText);
  return numbers.length > 0 && numbers.every(number => numericTokens(evidenceText).includes(number));
}

export function buildGraphEvidenceSnapshot(graphResult, capturedAt = new Date().toISOString()) {
  const approvedResults = (graphResult?.results || []).filter(isApproved).map(row => ({
    source_id: row.source_id || null, chunk_id: row.chunk_id || null, source_version: row.source_version || null,
    citation: row.citation || null, source_url: row.source_url || '', publisher: row.publisher || '',
    publication_year: row.publication_year || '', evidence_level: row.evidence_level || '',
    review_status: row.review_status || '', source_review_state: row.source_review_state || 'approved',
    purposes: evidencePurpose(row), text: String(row.text || '').slice(0, 800),
  })).filter(row => row.citation && row.purposes.length);
  const byCitation = new Map(approvedResults.map(row => [row.citation, row]));
  const recommendations = (graphResult?.recommendations || []).map(row => {
    const evidence = byCitation.get(row.evidence);
    if (!evidence || !citationSupportsAction(row, evidence)) return null;
    const action = String(row.action || '');
    if (/自行|擅自/.test(action) && /加药|减药|停药|换药|调整.{0,4}(?:剂量|药)/.test(action) && !/不要|不得|不能|请勿/.test(action)) return null;
    return {
      priority: row.priority || 'normal', action, reason: String(row.reason || ''), evidence: row.evidence,
      evidence_purposes: evidence.purposes, action_type: row.action_type || null,
      requires_confirmation: Boolean(row.requires_confirmation), medical_boundary: String(row.medical_boundary || ''),
    };
  }).filter(Boolean);
  const snapshot = {
    schema_version: GRAPH_EVIDENCE_SNAPSHOT_VERSION,
    policy_version: CURVE_GRAPH_LINK_VERSION,
    index_version: graphResult?.index_version || null,
    captured_at: capturedAt,
    results: approvedResults,
    recommendations,
    rejected_result_count: Math.max(0, Number(graphResult?.results?.length || 0) - approvedResults.length),
  };
  snapshot.snapshot_hash = digest(snapshot);
  return deepFreeze(snapshot);
}

export function predictionUncertain(event) {
  if (!event.forecast_available || !event.forecast_interval) return true;
  const interval = event.forecast_interval;
  const widths = interval.lower.map((lower, index) => interval.upper[index] - lower);
  const meanWidth = finite(interval.mean_width) ? Number(interval.mean_width) : widths.reduce((a, b) => a + b, 0) / Math.max(widths.length, 1);
  const relativeWidth = meanWidth / Math.max(Math.abs(Number(event.latest_value || 0)), 1);
  const coverageMiss = finite(interval.calibration_coverage) && finite(interval.coverage_target)
    ? Number(interval.calibration_coverage) < Number(interval.coverage_target) : true;
  const conditionMiss = finite(event.condition_coverage) ? Number(event.condition_coverage) < 0.8 : true;
  return relativeWidth > 0.2 || coverageMiss || conditionMiss || event.boundary_hit
    || event.quality_flags.some(flag => ['high_fluctuation', 'calibration_unavailable', 'insufficient_data'].includes(flag));
}

function eventText(event, unit = '') {
  const name = METRIC_NAMES[event.metric] || event.metric;
  const trend = { rising: '总体上升', falling: '总体下降', stable: '总体平稳', unknown: '暂不判断' }[event.trend];
  const measured = `已经测到的：${name}最近一次为 ${event.latest_value == null ? '暂无有效数值' : `${event.latest_value}${unit ? ` ${unit}` : ''}`}，记录趋势为${trend}。`;
  let estimated;
  if (!event.forecast_available) estimated = '模型估计的：当前不提供未来数值。';
  else if (predictionUncertain(event)) estimated = '模型估计的：当前区间较宽或数据覆盖未达标，只能说“不确定”。';
  else {
    const lower = Math.min(...event.forecast_interval.lower), upper = Math.max(...event.forecast_interval.upper);
    estimated = `模型估计的：未来 ${event.forecast_interval.horizon_days} 天的估计范围为 ${lower}–${upper}${unit ? ` ${unit}` : ''}，不是已经测到的结果。`;
  }
  return { measured, estimated };
}

export function enforceSafeCurveGraphResponse(_candidate, predictionSnapshot, graphSnapshot, units = {}) {
  const eventParts = predictionSnapshot.events.map(event => eventText(event, units[event.metric] || ''));
  const recommendation = graphSnapshot.recommendations[0] || null;
  const guideline = recommendation
    ? `指南建议的：${recommendation.action}${/不要|不得|不能|请勿/.test(recommendation.action) && /药/.test(recommendation.action) ? '' : '；不要自行调整药物。'}`
    : '指南建议的：当前没有足够的已审核证据支持更具体的行动；不要自行调整药物，出现明显不适请联系医生。';
  const content = [...eventParts.flatMap(part => [part.measured, part.estimated]), guideline].join('\n');
  const plan = recommendation ? [{
    icon: recommendation.priority === 'urgent' ? '急' : '测',
    title: recommendation.priority === 'urgent' ? '指南建议的 · 立即求助' : '指南建议的',
    desc: recommendation.action, color: recommendation.priority === 'urgent' ? 'red' : 'orange',
    action_type: recommendation.action_type, requires_confirmation: recommendation.requires_confirmation,
    evidence_citation: recommendation.evidence,
  }] : [];
  return {
    content,
    plan,
    confidence: {
      type: 'data', score: graphSnapshot.recommendations.length ? 82 : 55,
      sources: ['Curve 预测事件快照', ...graphSnapshot.results.slice(0, 2).map(row => row.citation)],
      reasoning: graphSnapshot.recommendations.length ? '预测事实保持原值，行动边界仅来自已审核且用途匹配的证据。' : '预测事实保持原值，但没有足够的已审核行动证据。',
    },
    fact_sections: {
      measured: eventParts.map(part => part.measured), estimated: eventParts.map(part => part.estimated), guideline: [guideline],
    },
    prediction_snapshot: predictionSnapshot,
    graph_evidence_snapshot: graphSnapshot,
    linkage_version: CURVE_GRAPH_LINK_VERSION,
  };
}
