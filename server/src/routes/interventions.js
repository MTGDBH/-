import express from 'express';
import db from '../db.js';
import { hasPermission } from '../contracts/accessControl.js';
import { resolveCareAccess } from '../contracts/careAccess.js';
import {
  INTERVENTION_REASON_CODES, INTERVENTION_STATUSES, canTransitionIntervention,
  validateExecutionLogInput, validateInterventionInput,
} from '../contracts/interventionContract.js';
import { interventionRepository } from '../repositories/interventionRepository.js';
import { resolveInterventionFollowup } from '../lib/followups.js';
import { validateEvaluationRequest } from '../contracts/interventionEvaluationContract.js';
import { evaluateIntervention } from '../services/interventionEvaluationService.js';

const router = express.Router();

function failure(res, status, reasonCode, message, details = undefined) {
  return res.status(status).json({ reason_code: reasonCode, message, ...(details ? { details } : {}) });
}

function resolveSubjectAccess(req, rawSubjectId, operation = 'view') {
  const subjectId = Number(rawSubjectId || req.user.id);
  if (!Number.isInteger(subjectId) || subjectId <= 0) return { error: 400, reasonCode: INTERVENTION_REASON_CODES.INVALID_INPUT, message: 'subject_user_id 不正确' };
  const subject = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(subjectId);
  if (!subject) return { error: 404, reasonCode: INTERVENTION_REASON_CODES.NOT_FOUND, message: '健康数据主体不存在' };
  if (req.user.id === subjectId) {
    if (req.user.role !== 'senior' || !hasPermission(req.user.role, 'manage_own_interventions')) {
      return { error: 403, reasonCode: INTERVENTION_REASON_CODES.FORBIDDEN, message: '只有老人账号可以管理本人的个体干预' };
    }
    return { allowed: true, subject, accessRole: 'self', canManage: true, canRecord: true, canView: true };
  }
  if (req.user.role === 'admin') return { error: 403, reasonCode: INTERVENTION_REASON_CODES.FORBIDDEN, message: '管理员不能默认读取或管理个人健康干预' };
  if (operation === 'manage') return { error: 403, reasonCode: INTERVENTION_REASON_CODES.FORBIDDEN, message: req.user.role === 'doctor' ? '医生不能代替老人确认、结束或取消干预' : '家属不能代替老人确认、结束或取消干预' };
  const requiredScope = operation === 'record' ? 'record_adherence' : 'view_interventions';
  const delegated = resolveCareAccess(subjectId, req.user.id, requiredScope, { resource: req.path });
  if (!delegated.allowed) return { error: delegated.status || 403, reasonCode: INTERVENTION_REASON_CODES.FORBIDDEN, message: delegated.message };
  const canRecord = delegated.scopes.includes('record_adherence') && req.user.role === 'caregiver';
  if (operation === 'record' && !canRecord) return { error: 403, reasonCode: INTERVENTION_REASON_CODES.FORBIDDEN, message: '当前授权不允许协助记录干预执行情况' };
  return { allowed: true, subject, relationship: delegated.relationship, accessRole: delegated.role, canManage: false, canRecord, canView: true };
}

function accessForIntervention(req, intervention, operation = 'view') {
  if (!intervention) return { error: 404, reasonCode: INTERVENTION_REASON_CODES.NOT_FOUND, message: '个体干预不存在' };
  return resolveSubjectAccess(req, intervention.subject_user_id, operation);
}

function invalidTransition(res, intervention, target) {
  return failure(res, 409, INTERVENTION_REASON_CODES.INVALID_TRANSITION,
    `当前状态 ${intervention.status} 不能转换为 ${target}`, { current_status: intervention.status, requested_status: target });
}

router.get('/', (req, res) => {
  const access = resolveSubjectAccess(req, req.query.subject_user_id, 'view');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  const status = req.query.status ? String(req.query.status) : null;
  if (status && !INTERVENTION_STATUSES.includes(status)) return failure(res, 400, INTERVENTION_REASON_CODES.INVALID_INPUT, 'status 不受支持');
  return res.json({ schema_version: 'n-of-1-intervention-list.v1', subject: access.subject, access_role: access.accessRole,
    items: interventionRepository.listForSubject(access.subject.id, { status, limit: req.query.limit }) });
});

router.get('/pending-evaluation', (req, res) => {
  const access = resolveSubjectAccess(req, req.query.subject_user_id, 'view');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  return res.json({ schema_version: 'n-of-1-pending-evaluation.v1', subject: access.subject,
    items: interventionRepository.listPendingEvaluation(access.subject.id) });
});

router.post('/', (req, res) => {
  const access = resolveSubjectAccess(req, req.body?.subject_user_id, 'manage');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  const parsed = validateInterventionInput(req.body);
  if (!parsed.ok) return failure(res, 400, parsed.reason_code, parsed.message);
  const unknownMetrics = parsed.value.target_metrics.filter(type => !db.prepare('SELECT type FROM metric_defs WHERE type=?').get(type));
  if (unknownMetrics.length) return failure(res, 400, INTERVENTION_REASON_CODES.INVALID_METRIC, 'target_metrics 包含未登记指标', { unknown_metrics: unknownMetrics });
  const linkedFollowup = resolveInterventionFollowup(access.subject.id, parsed.value.target_metrics, parsed.value.followup_id, parsed.value.outcome_start, parsed.value.outcome_end);
  if (linkedFollowup.error) return failure(res, 400, INTERVENTION_REASON_CODES.INVALID_INPUT, 'followup_id 不属于当前老人或目标指标');
  parsed.value.followup_id = linkedFollowup.followup?.id || null;
  const idempotencyKey = req.body?.idempotency_key ? String(req.body.idempotency_key).slice(0, 100) : null;
  const result = interventionRepository.create({ subjectUserId: access.subject.id, actorUserId: req.user.id, input: parsed.value, idempotencyKey });
  return res.status(result.idempotentReplay ? 200 : 201).json({ intervention: result.intervention,
    requires_confirmation: result.intervention.status !== 'proposed', idempotent_replay: result.idempotentReplay,
    message: result.intervention.status === 'proposed' ? '草案已保存，提交后等待本人确认' : '干预建议已创建，必须由老人本人确认后才能激活' });
});

router.get('/:interventionId', (req, res) => {
  const intervention = interventionRepository.findByPublicId(req.params.interventionId, { includeLogs: true });
  const access = accessForIntervention(req, intervention, 'view');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  return res.json({ intervention, access: { role: access.accessRole, can_manage: access.canManage, can_record: access.canRecord } });
});

router.get('/:interventionId/evaluations', (req, res) => {
  const intervention = interventionRepository.findByPublicId(req.params.interventionId);
  const access = accessForIntervention(req, intervention, 'view');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  return res.json({ schema_version: 'n-of-1-intervention-evaluation-list.v1',
    intervention_id: intervention.intervention_id, items: interventionRepository.listEvaluations(intervention.intervention_id) });
});

router.post('/:interventionId/evaluate', async (req, res) => {
  const intervention = interventionRepository.findByPublicId(req.params.interventionId, { includeLogs: true });
  const access = accessForIntervention(req, intervention, 'manage');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  if (intervention.status !== 'evaluating') {
    return failure(res, 409, INTERVENTION_REASON_CODES.INVALID_TRANSITION, '只有处于 evaluating 状态的干预可以运行效果评价',
      { current_status: intervention.status });
  }
  const parsed = validateEvaluationRequest(req.body, intervention);
  if (!parsed.ok) return failure(res, 400, INTERVENTION_REASON_CODES.INVALID_INPUT, parsed.message);
  const evaluated = await evaluateIntervention(intervention, parsed.value);
  if (!evaluated.ok) {
    if (evaluated.runtimeError) return failure(res, 503, evaluated.runtimeError.code, evaluated.runtimeError.message);
    return failure(res, 502, 'INTERVENTION_EVALUATION_CONTRACT_ERROR', evaluated.contractError);
  }
  const saved = interventionRepository.saveEvaluation(intervention.intervention_id, parsed.value.target_metric.metric, evaluated.result);
  return res.status(201).json({ evaluation_id: saved.evaluation_id, evaluation: saved.result,
    message: evaluated.result.evidence_level === 'insufficient'
      ? '评价已安全拒绝：数据不足，不生成效果结论'
      : '个体评价已生成；结果是个人证据，不代表临床有效性已被证明' });
});

router.post('/:interventionId/submit', (req, res) => {
  const intervention = interventionRepository.findByPublicId(req.params.interventionId);
  const access = accessForIntervention(req, intervention, 'manage');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  if (intervention.status !== 'pending_confirmation' && !canTransitionIntervention(intervention.status, 'pending_confirmation')) return invalidTransition(res, intervention, 'pending_confirmation');
  const result = interventionRepository.transition(intervention.intervention_id, ['proposed'], 'pending_confirmation', { actorUserId: req.user.id });
  return res.json({ intervention: result.intervention, requires_confirmation: true, idempotent_replay: result.idempotentReplay });
});

router.post('/:interventionId/confirm', (req, res) => {
  const intervention = interventionRepository.findByPublicId(req.params.interventionId);
  const access = accessForIntervention(req, intervention, 'manage');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  if (intervention.status === 'proposed') return failure(res, 409, INTERVENTION_REASON_CODES.NOT_SUBMITTED, '草案必须先提交为待确认状态');
  if (intervention.status !== 'active' && !canTransitionIntervention(intervention.status, 'active')) return invalidTransition(res, intervention, 'active');
  const result = interventionRepository.transition(intervention.intervention_id, ['pending_confirmation'], 'active', { actorUserId: req.user.id });
  return res.json({ intervention: result.intervention, idempotent_replay: result.idempotentReplay, message: '干预已由本人确认并激活' });
});

router.post('/:interventionId/reject', (req, res) => {
  const intervention = interventionRepository.findByPublicId(req.params.interventionId);
  const access = accessForIntervention(req, intervention, 'manage');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  const note = String(req.body?.reason || '').trim().slice(0, 300);
  if (!note) return failure(res, 400, INTERVENTION_REASON_CODES.INVALID_INPUT, '拒绝时必须填写 reason');
  if (intervention.status !== 'cancelled' && !['proposed','pending_confirmation'].includes(intervention.status)) return invalidTransition(res, intervention, 'cancelled');
  const result = interventionRepository.transition(intervention.intervention_id, ['proposed','pending_confirmation'], 'cancelled',
    { actorUserId: req.user.id, reasonCode: INTERVENTION_REASON_CODES.USER_REJECTED, message: note });
  return res.json({ intervention: result.intervention, idempotent_replay: result.idempotentReplay });
});

router.post('/:interventionId/executions', (req, res) => {
  const intervention = interventionRepository.findByPublicId(req.params.interventionId);
  const access = accessForIntervention(req, intervention, 'record');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  if (!['active','evaluating'].includes(intervention.status)) return failure(res, 409, INTERVENTION_REASON_CODES.CONFIRMATION_REQUIRED, '干预未激活或已结束，不能记录执行情况', { current_status: intervention.status });
  const parsed = validateExecutionLogInput(req.body);
  if (!parsed.ok) return failure(res, 400, parsed.reason_code, parsed.message);
  if (parsed.value.performed_at < intervention.intervention_start || parsed.value.performed_at > intervention.intervention_end) {
    return failure(res, 400, INTERVENTION_REASON_CODES.INVALID_EXECUTION_LOG, 'performed_at 必须位于干预执行时间窗内');
  }
  if (access.accessRole === 'caregiver' && parsed.value.data_source !== 'caregiver_report') {
    return failure(res, 400, INTERVENTION_REASON_CODES.INVALID_EXECUTION_LOG, '家属协助记录时 data_source 必须为 caregiver_report');
  }
  const result = interventionRepository.appendExecutionLog(intervention.intervention_id, req.user.id, parsed.value);
  if (result.invalidSupersededLog) return failure(res, 400, INTERVENTION_REASON_CODES.INVALID_SUPERSEDED_LOG, '被修订的执行日志不存在或不属于该干预');
  if (result.changeReasonRequired) return failure(res, 400, INTERVENTION_REASON_CODES.INVALID_EXECUTION_LOG, '修订既有日志时必须填写 change_reason');
  return res.status(result.idempotentReplay ? 200 : 201).json({ execution_log: result.log, idempotent_replay: result.idempotentReplay });
});

router.post('/:interventionId/end', (req, res) => {
  const intervention = interventionRepository.findByPublicId(req.params.interventionId);
  const access = accessForIntervention(req, intervention, 'manage');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  if (req.body?.safety_stop === true) {
    if (!['active','evaluating'].includes(intervention.status)) return invalidTransition(res, intervention, 'safety_stopped');
    const note = String(req.body?.reason || '').trim().slice(0, 300) || '用户因安全原因停止干预';
    const stopped = interventionRepository.transition(intervention.intervention_id, ['active','evaluating'], 'safety_stopped',
      { actorUserId: req.user.id, reasonCode: INTERVENTION_REASON_CODES.SAFETY_STOPPED, message: note });
    return res.json({ intervention: stopped.intervention, idempotent_replay: stopped.idempotentReplay });
  }
  if (intervention.status !== 'active') return invalidTransition(res, intervention, 'evaluating');
  if (new Date(intervention.outcome_end) > new Date()) return failure(res, 409, INTERVENTION_REASON_CODES.WINDOW_NOT_ENDED, '结局观察时间窗尚未结束；如需提前停止请取消或使用 safety_stop');
  const availability = interventionRepository.dataAvailability(intervention.intervention_id);
  if (!availability.ready) {
    const insufficient = interventionRepository.transition(intervention.intervention_id, ['active'], 'insufficient_data',
      { actorUserId: req.user.id, reasonCode: INTERVENTION_REASON_CODES.INSUFFICIENT_DATA, message: '基线或结局窗口缺少目标指标记录，无法进入评价' });
    return res.status(200).json({ intervention: insufficient.intervention, data_availability: availability,
      reason_code: INTERVENTION_REASON_CODES.INSUFFICIENT_DATA, message: '数据不足，干预已结束但不生成效果结论' });
  }
  const result = interventionRepository.transition(intervention.intervention_id, ['active'], 'evaluating', { actorUserId: req.user.id });
  return res.json({ intervention: result.intervention, data_availability: availability, message: '数据窗口已就绪，等待独立评价流程' });
});

router.post('/:interventionId/complete', (req, res) => {
  const intervention = interventionRepository.findByPublicId(req.params.interventionId);
  const access = accessForIntervention(req, intervention, 'manage');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  if (intervention.status !== 'completed' && !canTransitionIntervention(intervention.status, 'completed')) return invalidTransition(res, intervention, 'completed');
  const result = interventionRepository.transition(intervention.intervention_id, ['evaluating'], 'completed',
    { actorUserId: req.user.id, message: String(req.body?.evaluation_note || '').trim().slice(0, 500) || '数据收集与人工评价流程已完成' });
  return res.json({ intervention: result.intervention, idempotent_replay: result.idempotentReplay,
    message: '干预记录已完成；该状态不代表算法或临床效果成立' });
});

router.post('/:interventionId/cancel', (req, res) => {
  const intervention = interventionRepository.findByPublicId(req.params.interventionId);
  const access = accessForIntervention(req, intervention, 'manage');
  if (access.error) return failure(res, access.error, access.reasonCode, access.message);
  const note = String(req.body?.reason || '').trim().slice(0, 300);
  if (!note) return failure(res, 400, INTERVENTION_REASON_CODES.INVALID_INPUT, '取消时必须填写 reason');
  if (intervention.status !== 'cancelled' && !canTransitionIntervention(intervention.status, 'cancelled')) return invalidTransition(res, intervention, 'cancelled');
  const result = interventionRepository.transition(intervention.intervention_id,
    ['proposed','pending_confirmation','active','evaluating'], 'cancelled',
    { actorUserId: req.user.id, reasonCode: INTERVENTION_REASON_CODES.USER_CANCELLED, message: note });
  return res.json({ intervention: result.intervention, idempotent_replay: result.idempotentReplay });
});

router.use((error, _req, res, _next) => {
  console.error('[intervention-api]', error?.code || error?.name || 'unknown');
  return failure(res, 500, INTERVENTION_REASON_CODES.INTERNAL, '个体干预服务暂时失败，请稍后重试');
});

export default router;
