export const INTERVENTION_SCHEMA_VERSION = 'n-of-1-intervention.v1';
export const INTERVENTION_RULE_VERSION = 'n-of-1-foundation.2026-08.v1';

export const INTERVENTION_STATUSES = Object.freeze([
  'proposed', 'pending_confirmation', 'active', 'evaluating', 'completed',
  'cancelled', 'insufficient_data', 'safety_stopped',
]);

export const INTERVENTION_TRANSITIONS = Object.freeze({
  proposed: ['pending_confirmation', 'cancelled'],
  pending_confirmation: ['active', 'cancelled'],
  active: ['evaluating', 'cancelled', 'insufficient_data', 'safety_stopped'],
  evaluating: ['completed', 'cancelled', 'insufficient_data', 'safety_stopped'],
  completed: [], cancelled: [], insufficient_data: [], safety_stopped: [],
});

export const INTERVENTION_TYPES = Object.freeze([
  'activity', 'sleep_hygiene', 'diet_behavior', 'measurement_routine',
  'stress_management', 'other_non_medication',
]);

export const EXECUTION_DATA_SOURCES = Object.freeze([
  'self_report', 'caregiver_report', 'device', 'system', 'imported',
]);

export const INTERVENTION_REASON_CODES = Object.freeze({
  INVALID_INPUT: 'INTERVENTION_INVALID_INPUT',
  INVALID_DATE_RANGE: 'INTERVENTION_INVALID_DATE_RANGE',
  INVALID_METRIC: 'INTERVENTION_INVALID_TARGET_METRIC',
  MEDICAL_BOUNDARY: 'INTERVENTION_MEDICAL_BOUNDARY_VIOLATION',
  FORBIDDEN: 'INTERVENTION_FORBIDDEN',
  NOT_FOUND: 'INTERVENTION_NOT_FOUND',
  INVALID_TRANSITION: 'INTERVENTION_INVALID_STATE_TRANSITION',
  NOT_SUBMITTED: 'INTERVENTION_NOT_SUBMITTED',
  CONFIRMATION_REQUIRED: 'INTERVENTION_CONFIRMATION_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'INTERVENTION_IDEMPOTENCY_CONFLICT',
  INVALID_EXECUTION_LOG: 'INTERVENTION_INVALID_EXECUTION_LOG',
  INVALID_SUPERSEDED_LOG: 'INTERVENTION_INVALID_SUPERSEDED_LOG',
  INSUFFICIENT_DATA: 'INTERVENTION_INSUFFICIENT_DATA',
  SAFETY_STOPPED: 'INTERVENTION_SAFETY_STOPPED',
  USER_REJECTED: 'INTERVENTION_USER_REJECTED',
  USER_CANCELLED: 'INTERVENTION_USER_CANCELLED',
  WINDOW_NOT_ENDED: 'INTERVENTION_WINDOW_NOT_ENDED',
  INTERNAL: 'INTERVENTION_INTERNAL_ERROR',
});

const FORBIDDEN_MEDICAL_PATTERN = /(处方|开药|换药|停药|加药|减药|药物剂量|剂量调整|自行用药|替代就医|无需就医|不用看医生|不必就医|药.{0,16}(从.{0,8}(改|调)|[一二两三四五六七八九十\d]+\s*(片|粒|毫克|mg)))/i;

export function canTransitionIntervention(from, to) {
  return (INTERVENTION_TRANSITIONS[from] || []).includes(to);
}

export function containsForbiddenMedicalInstruction(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return FORBIDDEN_MEDICAL_PATTERN.test(text);
}

function asIso(value, field, errors, { required = true } = {}) {
  if ((value == null || value === '') && !required) return null;
  if (value == null || value === '' || Number.isNaN(Date.parse(value))) {
    errors.push(`${field} 必须是有效时间`); return null;
  }
  return new Date(value).toISOString();
}

function stringArray(value, max = 20) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, max);
}

export function validateInterventionInput(body = {}) {
  const errors = [];
  const interventionType = String(body.intervention_type || '').trim();
  const title = String(body.title || '').trim().slice(0, 160);
  const protocol = body.protocol && typeof body.protocol === 'object' && !Array.isArray(body.protocol) ? body.protocol : null;
  const targetMetrics = stringArray(body.target_metrics, 12);
  const evidenceSourceIds = stringArray(body.evidence_source_ids, 30);
  if (!INTERVENTION_TYPES.includes(interventionType)) errors.push('intervention_type 不受支持');
  if (!title) errors.push('title 不能为空');
  if (!protocol) errors.push('protocol 必须是对象');
  if (!targetMetrics.length) errors.push('target_metrics 至少包含一个指标');
  if (containsForbiddenMedicalInstruction({ interventionType, title, protocol })) {
    return { ok: false, reason_code: INTERVENTION_REASON_CODES.MEDICAL_BOUNDARY, message: '干预不得包含处方、药物剂量调整、停换药或替代就医指令' };
  }
  const baselineStart = asIso(body.baseline_start, 'baseline_start', errors);
  const baselineEnd = asIso(body.baseline_end, 'baseline_end', errors);
  const interventionStart = asIso(body.intervention_start, 'intervention_start', errors);
  const interventionEnd = asIso(body.intervention_end, 'intervention_end', errors);
  const outcomeStart = asIso(body.outcome_start, 'outcome_start', errors);
  const outcomeEnd = asIso(body.outcome_end, 'outcome_end', errors);
  if ([baselineStart, baselineEnd, interventionStart, interventionEnd, outcomeStart, outcomeEnd].every(Boolean)) {
    if (!(baselineStart <= baselineEnd && baselineEnd <= interventionStart && interventionStart <= interventionEnd
      && interventionEnd <= outcomeStart && outcomeStart <= outcomeEnd)) {
      return { ok: false, reason_code: INTERVENTION_REASON_CODES.INVALID_DATE_RANGE, message: '时间窗必须按基线、干预、结局顺序排列且各自起止有效' };
    }
  }
  if (errors.length) return { ok: false, reason_code: INTERVENTION_REASON_CODES.INVALID_INPUT, message: errors.join('；') };
  const adherenceTarget = body.adherence_target && typeof body.adherence_target === 'object' && !Array.isArray(body.adherence_target)
    ? body.adherence_target : { minimum_rate: Number(body.adherence_target) };
  if (!Number.isFinite(Number(adherenceTarget.minimum_rate)) || Number(adherenceTarget.minimum_rate) < 0 || Number(adherenceTarget.minimum_rate) > 1) {
    return { ok: false, reason_code: INTERVENTION_REASON_CODES.INVALID_INPUT, message: 'adherence_target.minimum_rate 必须在 0 到 1 之间' };
  }
  return { ok: true, value: {
    intervention_type: interventionType, title, protocol, target_metrics: targetMetrics,
    baseline_start: baselineStart, baseline_end: baselineEnd,
    intervention_start: interventionStart, intervention_end: interventionEnd,
    outcome_start: outcomeStart, outcome_end: outcomeEnd,
    adherence_target: { ...adherenceTarget, minimum_rate: Number(adherenceTarget.minimum_rate) },
    evidence_source_ids: evidenceSourceIds,
    rule_version: String(body.rule_version || INTERVENTION_RULE_VERSION).slice(0, 100),
    followup_id: body.followup_id == null ? null : Number(body.followup_id),
    draft: body.draft === true,
  } };
}

export function validateExecutionLogInput(body = {}) {
  if (typeof body.performed !== 'boolean') return { ok: false, reason_code: INTERVENTION_REASON_CODES.INVALID_EXECUTION_LOG, message: 'performed 必须是布尔值' };
  const performedAt = body.performed_at && !Number.isNaN(Date.parse(body.performed_at)) ? new Date(body.performed_at).toISOString() : null;
  if (!performedAt) return { ok: false, reason_code: INTERVENTION_REASON_CODES.INVALID_EXECUTION_LOG, message: 'performed_at 必须是有效执行时间' };
  if (new Date(performedAt).getTime() > Date.now() + 5 * 60_000) return { ok: false, reason_code: INTERVENTION_REASON_CODES.INVALID_EXECUTION_LOG, message: 'performed_at 不能晚于当前时间' };
  const skipReason = String(body.skip_reason || '').trim().slice(0, 300) || null;
  if (!body.performed && !skipReason) return { ok: false, reason_code: INTERVENTION_REASON_CODES.INVALID_EXECUTION_LOG, message: '未执行时必须填写 skip_reason' };
  const dataSource = String(body.data_source || 'self_report');
  if (!EXECUTION_DATA_SOURCES.includes(dataSource)) return { ok: false, reason_code: INTERVENTION_REASON_CODES.INVALID_EXECUTION_LOG, message: 'data_source 不受支持' };
  return { ok: true, value: {
    performed: body.performed, performed_at: performedAt,
    user_note: String(body.user_note || '').trim().slice(0, 1000) || null,
    skip_reason: skipReason, data_source: dataSource,
    supersedes_execution_log_id: body.supersedes_execution_log_id ? String(body.supersedes_execution_log_id).slice(0, 80) : null,
    change_reason: String(body.change_reason || '').trim().slice(0, 300) || null,
    idempotency_key: body.idempotency_key ? String(body.idempotency_key).slice(0, 100) : null,
  } };
}
