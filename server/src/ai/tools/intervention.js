import crypto from 'node:crypto';
import db from '../../db.js';
import { interventionRepository } from '../../repositories/interventionRepository.js';
import { evaluateIntervention as runEvaluation } from '../../services/interventionEvaluationService.js';

export const INTERVENTION_AGENT_TOOL_VERSION = 'agent-intervention-tools.2026-08.v1';
const FORBIDDEN = /(停药|换药|加药|减药|剂量|毫克|\bmg\b|片|粒|代替医生|不用就医)/i;
const URGENT = /胸痛|呼吸困难|喘不过气|意识不清|昏迷|抽搐|大量出血|一侧.{0,6}(无力|麻木)|说话.{0,4}(不清|含糊)/;

function nowIso() { return new Date().toISOString(); }
function plusDays(value, days) { return new Date(new Date(value).getTime() + days * 86400_000).toISOString(); }
function fingerprint(value) { return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }

function metricFromMessage(message) {
  if (/血糖|糖尿病/.test(message)) return { type: 'glucose', label: '血糖', condition: '空腹、餐后2小时或随机必须分别记录和比较' };
  if (/血压|高压|低压|收缩压|舒张压/.test(message)) return { type: 'bp', label: '血压', condition: '保持相同姿势、时段、设备和复测状态' };
  if (/心率|脉搏/.test(message)) return { type: 'hr', label: '心率', condition: '静息与非静息分开记录' };
  if (/体重|减重/.test(message)) return { type: 'weight', label: '体重', condition: '晨起并保持相近衣着条件' };
  if (/睡眠/.test(message)) return { type: 'sleep', label: '睡眠', condition: '固定起止记录口径' };
  return null;
}

function interventionKind(message) {
  if (/走|步行|散步|活动|运动/.test(message)) return { type: 'activity', title: '规律低强度活动观察', what: '在身体允许且环境安全时，按计划进行低强度活动；出现不适立即停止' };
  if (/睡眠|早睡|作息/.test(message)) return { type: 'sleep_hygiene', title: '规律作息观察', what: '保持相对固定的上床和起床时间，并记录睡眠情况' };
  if (/饮食|晚餐|早餐|盐|蔬菜/.test(message)) return { type: 'diet_behavior', title: '饮食行为观察', what: '只调整非药物的日常饮食行为，并保持其它习惯尽量稳定' };
  return { type: 'measurement_routine', title: '规范测量流程观察', what: '按统一条件完成目标指标测量并记录条件' };
}

function localEvidence(metric) {
  const tokens = metric.type === 'bp' ? ['血压', '活动'] : metric.type === 'glucose' ? ['血糖', '饮食', '活动']
    : metric.type === 'hr' ? ['心率', '活动'] : metric.type === 'weight' ? ['体重', '饮食', '活动'] : ['睡眠'];
  for (const token of tokens) {
    const row = db.prepare(`SELECT id,title,summary,source_label,source_url,review_status,review_version
      FROM knowledge_articles WHERE review_status='approved' AND (title LIKE ? OR tags LIKE ? OR summary LIKE ?)
      ORDER BY reviewed_at DESC,id DESC LIMIT 1`).get(`%${token}%`, `%${token}%`, `%${token}%`);
    if (row?.source_url || row?.source_label) return row;
  }
  return null;
}

function latestMetric(subjectId, metric) {
  return db.prepare(`SELECT id,type,value,value2,unit,recorded_at,measurement_condition,data_quality
    FROM metrics WHERE user_id=? AND type=? ORDER BY recorded_at DESC,id DESC LIMIT 1`).get(subjectId, metric);
}

function accessRole(ctx) {
  if (Number(ctx.actor.id) === Number(ctx.subject.id)) return ctx.actor.role === 'senior' ? 'self' : 'forbidden';
  const relation = db.prepare(`SELECT member_role,status FROM care_relationships
    WHERE senior_id=? AND member_id=? AND status='active'`).get(ctx.subject.id, ctx.actor.id);
  return relation?.member_role || 'forbidden';
}

function failure(code, message, evidence = null) {
  return { success: false, tool_version: INTERVENTION_AGENT_TOOL_VERSION, reason_code: code, message,
    evidence_snapshot: evidence };
}

export async function proposeIntervention(ctx, args = {}) {
  const message = String(args.message || ctx.message || '');
  if (accessRole(ctx) !== 'self') return failure('INTERVENTION_PROPOSAL_FORBIDDEN', '只有老人本人可以确认并创建个体干预；家属可协助查看和记录执行情况');
  if (URGENT.test(message)) return failure('EMERGENCY_INTERRUPTED', '检测到急症信号，普通干预流程已中止');
  if (!/(我想|请|帮我|建议|制定|试试|开始|干预|方案)/.test(message)) return failure('INTENT_NOT_EXPLICIT', '用户尚未明确请求个体干预');
  if (FORBIDDEN.test(message)) return failure('MEDICATION_OR_MEDICAL_BOUNDARY', '干预不能包含药物剂量调整、停换药或替代就医');
  const metric = metricFromMessage(message);
  if (!metric) return failure('TARGET_METRIC_REQUIRED', '请先明确要观察的目标指标和复测方式');
  const latest = latestMetric(ctx.subject.id, metric.type);
  if (!latest) return failure('BASELINE_MEASUREMENT_REQUIRED', `缺少可追溯的${metric.label}测量，暂不能提出个体干预`);
  const evidence = localEvidence(metric);
  if (!evidence) return failure('TRACEABLE_EVIDENCE_REQUIRED', '当前没有通过审核且可追溯的证据来源，暂不能提出干预');
  const kind = interventionKind(message);
  const durationMatch = message.match(/(\d{1,2})\s*天/);
  const duration = Math.max(7, Math.min(28, Number(durationMatch?.[1] || 14)));
  const now = nowIso();
  const interventionEnd = plusDays(now, duration);
  const outcomeEnd = plusDays(interventionEnd, 7);
  const evidenceSnapshot = {
    schema_version: 'intervention-evidence-snapshot.v1', captured_at: now,
    baseline_measurement: latest,
    sources: [{ source_id: `knowledge_article:${evidence.id}`, title: evidence.title,
      label: evidence.source_label, url: evidence.source_url, review_status: evidence.review_status,
      review_version: evidence.review_version }],
  };
  const payload = {
    intervention_type: kind.type, title: `${kind.title}（${duration}天）`,
    protocol: {
      do_what: kind.what, duration_days: duration,
      recording_method: `每天记录是否完成，并按要求记录${metric.label}测量条件`,
      recheck_plan: `干预结束后7天内按同一条件复测；${metric.condition}`,
      observed_metric: metric.type, rationale: evidence.summary || evidence.title,
      stop_and_seek_care: '出现胸痛、呼吸困难、意识异常、明显头晕乏力、跌倒或指标达到个人急症阈值时立即停止并及时就医',
      planned_execution_count: duration,
      expected_measurement_count: { baseline: 7, outcome: 6 },
      timezone: args.timezone || 'Asia/Shanghai',
    },
    target_metrics: [metric.type], baseline_start: plusDays(now, -14), baseline_end: now,
    intervention_start: now, intervention_end: interventionEnd,
    outcome_start: interventionEnd, outcome_end: outcomeEnd,
    adherence_target: { minimum_rate: 0.7 },
    evidence_source_ids: evidenceSnapshot.sources.map(row => row.source_id),
    idempotency_key: fingerprint({ subject: ctx.subject.id, metric: metric.type, now: now.slice(0, 10), kind: kind.type }).slice(7, 107),
  };
  return { success: true, status: 'confirmation_preview', tool_version: INTERVENTION_AGENT_TOOL_VERSION,
    reason_code: 'INTERVENTION_PROPOSAL_READY', message: '已生成待确认干预卡片；用户确认前不会创建干预记录',
    proposal: { what: kind.what, duration: `${duration}天`, recording: payload.protocol.recording_method,
      recheck: payload.protocol.recheck_plan, target_metric: metric.label, why: payload.protocol.rationale,
      evidence_sources: evidenceSnapshot.sources, stop_and_seek_care: payload.protocol.stop_and_seek_care,
      intervention_payload: payload },
    evidence_snapshot: evidenceSnapshot };
}

export function listActiveInterventions(ctx) {
  const items = interventionRepository.listForSubject(ctx.subject.id, { limit: 50 })
    .filter(row => ['active', 'evaluating'].includes(row.status));
  return { success: true, status: 'ok', tool_version: INTERVENTION_AGENT_TOOL_VERSION,
    reason_code: 'ACTIVE_INTERVENTIONS_LISTED', total: items.length, items,
    evidence_snapshot: { schema_version: 'intervention-list-snapshot.v1', captured_at: nowIso(),
      intervention_ids: items.map(row => row.intervention_id) } };
}

export function recordAdherence(ctx, args = {}) {
  const role = accessRole(ctx);
  if (!['self', 'caregiver'].includes(role)) return failure('ADHERENCE_FORBIDDEN', '当前角色不能记录该老人的干预执行情况');
  const message = String(args.message || ctx.message || '');
  const active = interventionRepository.listForSubject(ctx.subject.id, { status: 'active', limit: 20 });
  const intervention = args.intervention_id ? active.find(row => row.intervention_id === args.intervention_id) : active[0];
  if (!intervention) return failure('ACTIVE_INTERVENTION_NOT_FOUND', '没有可记录执行情况的活动干预');
  const skipped = /没做|未做|漏了|没有完成|跳过/.test(message);
  const payload = { performed: !skipped, performed_at: nowIso(),
    skip_reason: skipped ? String(args.skip_reason || message).slice(0, 300) : null,
    user_note: String(args.note || message).slice(0, 300), data_source: role === 'caregiver' ? 'caregiver_report' : 'self_report',
    idempotency_key: fingerprint({ intervention: intervention.intervention_id, actor: ctx.actor.id, minute: nowIso().slice(0, 16), performed: !skipped }).slice(7, 107) };
  return { success: true, status: 'confirmation_preview', tool_version: INTERVENTION_AGENT_TOOL_VERSION,
    reason_code: 'ADHERENCE_PREVIEW_READY', intervention: { intervention_id: intervention.intervention_id, title: intervention.title },
    adherence_preview: payload, evidence_snapshot: { schema_version: 'adherence-context-snapshot.v1',
      captured_at: nowIso(), intervention_id: intervention.intervention_id, actor_role: role },
    message: '已生成执行记录预览，确认后才会写入' };
}

export async function evaluateInterventionTool(ctx, args = {}) {
  if (accessRole(ctx) !== 'self') return failure('EVALUATION_FORBIDDEN', '只有老人本人可以启动个体干预效果评价');
  const items = interventionRepository.listForSubject(ctx.subject.id, { status: 'evaluating', limit: 20 });
  const intervention = args.intervention_id ? items.find(row => row.intervention_id === args.intervention_id) : items[0];
  if (!intervention) return failure('EVALUATING_INTERVENTION_NOT_FOUND', '没有处于待评价状态的干预');
  const dbMetric = intervention.target_metrics[0];
  const targetMetric = { metric: dbMetric === 'bp' ? 'bp_systolic' : dbMetric,
    unit: db.prepare('SELECT unit FROM metric_defs WHERE type=?').get(dbMetric)?.unit || null };
  const evaluated = await runEvaluation(intervention, { target_metric: targetMetric,
    timezone: intervention.protocol?.timezone || args.timezone || 'Asia/Shanghai', confidence_level: 0.95,
    random_seed: 20260828, bootstrap_iterations: 2000 });
  if (!evaluated.ok) return failure(evaluated.runtimeError?.code || 'EVALUATION_FAILED',
    evaluated.runtimeError?.message || evaluated.contractError || '个体干预评价失败');
  const saved = interventionRepository.saveEvaluation(intervention.intervention_id, targetMetric.metric, evaluated.result);
  return { success: true, status: 'ok', tool_version: INTERVENTION_AGENT_TOOL_VERSION,
    reason_code: evaluated.result.reason_code, evaluation_id: saved.evaluation_id,
    intervention: { intervention_id: intervention.intervention_id, title: intervention.title }, result: saved.result,
    evidence_snapshot: { schema_version: 'intervention-evaluation-reference.v1', captured_at: nowIso(),
      evaluation_id: saved.evaluation_id, input_fingerprint: saved.result.input_fingerprint || null },
    message: saved.result.message };
}

export function explainInterventionResult(ctx, args = {}) {
  const rows = db.prepare(`SELECT e.*,i.intervention_id,i.title FROM intervention_evaluations e
    JOIN interventions i ON i.id=e.intervention_db_id WHERE e.subject_user_id=?
    ORDER BY e.created_at DESC,e.id DESC LIMIT 20`).all(ctx.subject.id);
  const row = args.evaluation_id ? rows.find(item => item.evaluation_id === args.evaluation_id) : rows[0];
  if (!row) return failure('EVALUATION_NOT_FOUND', '没有可解释的个体干预评价结果');
  let result; try { result = JSON.parse(row.result); } catch { return failure('EVALUATION_RESULT_INVALID', '评价结果契约不可用'); }
  const levelText = {
    insufficient: '数据不足：没有生成效果变化量', descriptive_only: '描述性变化：存在重要混杂，不能归因',
    personal_preliminary: '初步个体证据：仅适用于当前个人和当前观察窗', personal_repeated: '重复个体证据：多次个人观察方向一致，仍不是群体临床证明',
  }[result.evidence_level] || '证据等级未知';
  return { success: true, status: 'ok', tool_version: INTERVENTION_AGENT_TOOL_VERSION,
    reason_code: 'INTERVENTION_RESULT_EXPLAINED', intervention: { intervention_id: row.intervention_id, title: row.title },
    explanation: {
      measured_values: result.baseline_summary && result.outcome_summary ? `基线稳健中心 ${result.baseline_summary.value}，结局稳健中心 ${result.outcome_summary.value}` : '匹配后的测量值不足',
      model_prediction: '本结果不使用未来预测作为干预效果；bootstrap 只表示采样不确定性',
      descriptive_change: result.absolute_change == null ? '未计算' : `绝对变化 ${result.absolute_change}，相对变化 ${result.relative_change}`,
      personal_evidence: levelText, uncertainty: result.uncertainty_interval,
      confounders: result.confounders || [], safety_message: result.message,
    },
    evidence_snapshot: { schema_version: 'intervention-explanation-snapshot.v1', captured_at: nowIso(),
      evaluation_id: row.evaluation_id, algorithm_version: row.algorithm_version, input_fingerprint: row.input_fingerprint },
    message: `${levelText}。${result.message}` };
}
