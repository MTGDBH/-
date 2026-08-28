export const INTERVENTION_EVALUATION_SCHEMA_VERSION = 'n-of-1-intervention-evaluation.v1';
export const INTERVENTION_EVIDENCE_LEVELS = Object.freeze([
  'insufficient', 'descriptive_only', 'personal_preliminary', 'personal_repeated',
]);

const REQUIRED_FIELDS = Object.freeze([
  'baseline_summary', 'outcome_summary', 'absolute_change', 'relative_change',
  'effect_size', 'uncertainty_interval', 'adherence_rate', 'measurement_count',
  'confidence_level', 'evidence_level', 'confounders', 'reason_code', 'message',
]);

export function validateInterventionEvaluationOutput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: '评价引擎返回值必须是对象' };
  }
  if (value.schema_version !== INTERVENTION_EVALUATION_SCHEMA_VERSION) {
    return { ok: false, message: '评价契约版本不受支持' };
  }
  const missing = REQUIRED_FIELDS.filter(field => !(field in value));
  if (missing.length) return { ok: false, message: `评价契约缺少字段：${missing.join(',')}` };
  if (!INTERVENTION_EVIDENCE_LEVELS.includes(value.evidence_level)) {
    return { ok: false, message: 'evidence_level 不受支持' };
  }
  if (!Array.isArray(value.confounders) || typeof value.reason_code !== 'string' || typeof value.message !== 'string') {
    return { ok: false, message: '评价契约字段类型不正确' };
  }
  if (/已证明有效/.test(value.message)) return { ok: false, message: '评价输出越过医疗证据边界' };
  if (value.evidence_level === 'insufficient' && [value.absolute_change, value.relative_change].some(item => item != null)) {
    return { ok: false, message: '数据不足时不得输出变化估计' };
  }
  return { ok: true, value };
}

export function validateEvaluationRequest(body, intervention) {
  const rawTarget = body?.target_metric;
  const target = typeof rawTarget === 'string' ? { metric: rawTarget } : rawTarget;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return { ok: false, message: 'target_metric 必须是字符串或对象' };
  }
  const metric = String(target.metric || '').trim();
  const dbMetric = metric.startsWith('bp_') ? 'bp' : metric;
  if (!metric || !intervention.target_metrics.includes(dbMetric)) {
    return { ok: false, message: 'target_metric 必须属于当前干预的目标指标' };
  }
  const timezone = String(body?.timezone || intervention.protocol?.timezone || 'UTC');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
  catch { return { ok: false, message: 'timezone 必须是有效 IANA 时区' }; }
  const confidenceLevel = body?.confidence_level == null ? 0.95 : Number(body.confidence_level);
  if (!Number.isFinite(confidenceLevel) || confidenceLevel < 0.8 || confidenceLevel > 0.99) {
    return { ok: false, message: 'confidence_level 必须在 0.80 到 0.99 之间' };
  }
  return { ok: true, value: { target_metric: { ...target, metric }, timezone, confidence_level: confidenceLevel,
    random_seed: Number.isInteger(Number(body?.random_seed)) ? Number(body.random_seed) : 20260828,
    bootstrap_iterations: Math.max(500, Math.min(20000, Number(body?.bootstrap_iterations) || 2000)) } };
}
