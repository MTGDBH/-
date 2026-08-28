import assert from 'node:assert/strict';
import db from './db.js';
import { emergencyReply, ensureConversation, runAgentV2 } from './ai/orchestratorV2.js';
import {
  explainInterventionResult, evaluateInterventionTool, proposeIntervention, recordAdherence,
} from './ai/tools/intervention.js';
import { validateInterventionInput } from './contracts/interventionContract.js';
import { interventionRepository } from './repositories/interventionRepository.js';

const stamp = `${Date.now()}-${Math.random()}`;
const seniorId = Number(db.prepare(`INSERT INTO users (name,role,password) VALUES (?,'senior','test-only')`).run(`闭环老人-${stamp}`).lastInsertRowid);
const caregiverId = Number(db.prepare(`INSERT INTO users (name,role,password) VALUES (?,'caregiver','test-only')`).run(`闭环家属-${stamp}`).lastInsertRowid);
db.prepare(`INSERT INTO care_relationships (senior_id,member_id,member_role,status) VALUES (?,?,'caregiver','active')`).run(seniorId, caregiverId);
const senior = db.prepare('SELECT * FROM users WHERE id=?').get(seniorId);
const caregiver = db.prepare('SELECT * FROM users WHERE id=?').get(caregiverId);
const ctx = { actor: senior, subject: senior, message: '' };
const caregiverCtx = { actor: caregiver, subject: senior, message: '' };

db.prepare(`INSERT INTO knowledge_articles
  (category,title,summary,body,tags,audience,review_status,review_version,source_label,source_url)
  VALUES ('topic',?,?,?,?,?,'approved','test-reviewed-v1','合成测试证据','https://example.invalid/synthetic-evidence')`)
  .run(`血糖活动证据-${stamp}`, '规律活动可作为健康管理观察方向；个体效果需要复测。', 'synthetic test body', '["血糖","活动"]', 'senior');
db.prepare(`INSERT INTO metrics (user_id,type,value,unit,recorded_at,source,measurement_condition,data_quality,measurement_context)
  VALUES (?,?,?,?,?,'manual','fasting','{"flags":[]}','{}')`).run(seniorId, 'glucose', 7.1, 'mmol/L', new Date().toISOString());

// 提议：只有预览，不静默创建。
const before = db.prepare('SELECT COUNT(*) n FROM interventions WHERE subject_user_id=?').get(seniorId).n;
const proposal = await proposeIntervention(ctx, { message: '请帮我制定一个观察血糖的饭后散步干预方案，做14天' });
assert.equal(proposal.status, 'confirmation_preview');
assert.equal(db.prepare('SELECT COUNT(*) n FROM interventions WHERE subject_user_id=?').get(seniorId).n, before);
assert.ok(proposal.proposal.what && proposal.proposal.recording && proposal.proposal.recheck && proposal.proposal.stop_and_seek_care);
assert.ok(proposal.proposal.evidence_sources.length);
const parsedProposal = validateInterventionInput(proposal.proposal.intervention_payload);
assert.equal(parsedProposal.ok, true);

// 用户确认后才创建并激活。
const created = interventionRepository.create({ subjectUserId: seniorId, actorUserId: seniorId,
  input: parsedProposal.value, idempotencyKey: `loop-proposal-${stamp}` }).intervention;
assert.equal(created.status, 'pending_confirmation');
const confirmed = interventionRepository.transition(created.intervention_id, ['pending_confirmation'], 'active', { actorUserId: seniorId }).intervention;
assert.equal(confirmed.status, 'active');

// 执行记录同样先预览，再显式写入。
const adherence = recordAdherence({ ...ctx, message: '我今天完成了散步干预' }, {});
assert.equal(adherence.status, 'confirmation_preview');
assert.equal(adherence.adherence_preview.performed, true);
const logged = interventionRepository.appendExecutionLog(created.intervention_id, seniorId, adherence.adherence_preview);
assert.equal(logged.log.performed, true);

// 家属可协助记录，但不能提议或启动评价。
assert.equal(recordAdherence({ ...caregiverCtx, message: '老人今天没做干预' }, {}).adherence_preview.data_source, 'caregiver_report');
assert.equal((await proposeIntervention(caregiverCtx, { message: '请制定一个观察血糖的干预方案' })).reason_code, 'INTERVENTION_PROPOSAL_FORBIDDEN');
assert.equal((await evaluateInterventionTool(caregiverCtx)).reason_code, 'EVALUATION_FORBIDDEN');

function iso(day, hour = 8) { return new Date(Date.UTC(2026, 0, 1 + day, hour)).toISOString(); }
function historicalInput(key, enough = true) {
  return validateInterventionInput({ intervention_type: 'activity', title: `历史干预-${key}`,
    protocol: { planned_execution_count: 7, timezone: 'Asia/Shanghai', expected_measurement_count: { baseline: enough ? 14 : 7, outcome: enough ? 7 : 6 } },
    target_metrics: [enough ? 'glucose' : 'hr'], baseline_start: iso(0, 0), baseline_end: iso(13, 23),
    intervention_start: iso(14, 0), intervention_end: iso(20, 23), outcome_start: iso(21, 0), outcome_end: iso(27, 23),
    adherence_target: { minimum_rate: .7 }, evidence_source_ids: ['knowledge:test'] }).value;
}
function createEvaluating(key, enough = true) {
  const item = interventionRepository.create({ subjectUserId: seniorId, actorUserId: seniorId,
    input: historicalInput(key, enough), idempotencyKey: `${key}-${stamp}` }).intervention;
  interventionRepository.transition(item.intervention_id, ['pending_confirmation'], 'active', { actorUserId: seniorId });
  return interventionRepository.transition(item.intervention_id, ['active'], 'evaluating', { actorUserId: seniorId }).intervention;
}

// 复测数据与完整评价。
const sufficient = createEvaluating('sufficient');
const insertMetric = db.prepare(`INSERT INTO metrics (user_id,type,value,unit,recorded_at,source,measurement_condition,data_quality,measurement_context)
  VALUES (?,?,?,?,?,'synthetic','fasting','{"flags":[]}','{}')`);
for (let day = 0; day < 14; day += 1) insertMetric.run(seniorId, 'glucose', 7 + (day % 3) * .1, 'mmol/L', iso(day));
for (let day = 21; day < 28; day += 1) insertMetric.run(seniorId, 'glucose', 6.3 + (day % 3) * .1, 'mmol/L', iso(day));
for (let day = 14; day < 21; day += 1) interventionRepository.appendExecutionLog(sufficient.intervention_id, seniorId, {
  performed: true, performed_at: iso(day), user_note: null, skip_reason: null, data_source: 'self_report',
  supersedes_execution_log_id: null, change_reason: null, idempotency_key: `hist-${day}-${stamp}` });
const evaluated = await evaluateInterventionTool(ctx, { intervention_id: sufficient.intervention_id });
assert.equal(evaluated.result.schema_version, 'n-of-1-intervention-evaluation.v1');
assert.ok(['personal_preliminary', 'descriptive_only'].includes(evaluated.result.evidence_level));
const explained = explainInterventionResult(ctx, { evaluation_id: evaluated.evaluation_id });
assert.match(explained.explanation.model_prediction, /不使用未来预测/);
assert.match(explained.explanation.personal_evidence, /个体证据|描述性变化/);
assert.doesNotMatch(explained.message, /已经证明有效|可以停药|可以代替医生|一定能降低患病风险/);

// 数据不足安全拒绝。
const insufficient = createEvaluating('insufficient', false);
const insufficientResult = await evaluateInterventionTool(ctx, { intervention_id: insufficient.intervention_id });
assert.equal(insufficientResult.result.evidence_level, 'insufficient');
assert.equal(insufficientResult.result.absolute_change, null);

// 用户拒绝：待确认记录转 cancelled，不激活。
const rejected = interventionRepository.create({ subjectUserId: seniorId, actorUserId: seniorId,
  input: parsedProposal.value, idempotencyKey: `reject-${stamp}` }).intervention;
assert.equal(interventionRepository.transition(rejected.intervention_id, ['pending_confirmation'], 'cancelled',
  { actorUserId: seniorId, reasonCode: 'INTERVENTION_USER_REJECTED', message: '用户拒绝' }).intervention.status, 'cancelled');

// 急症打断，且无 LLM 配置时确定性路径仍给出提议确认卡。
assert.equal(emergencyReply('我想做干预，但现在突然胸痛、喘不过气').source, 'safety_rule');
const conversation = ensureConversation(seniorId, seniorId, null);
const deterministic = await runAgentV2({ actor: senior, subject: senior, conversation,
  message: '请帮我制定一个观察血糖的饭后散步干预方案，做14天', clientRequestId: `det-${stamp}`, userMessageId: null });
assert.equal(deterministic.presentation.actions[0].action_type, 'n_of_1_intervention');
assert.ok(deterministic.presentation.actions[0].intervention_payload);
assert.ok(deterministic.tool_trace.some(item => item.name === 'propose_intervention' && item.status === 'success'));
const audited = db.prepare(`SELECT tool_version,evidence_snapshot,failure_reason FROM agent_tool_calls
  WHERE run_id=? AND tool_name='propose_intervention'`).get(deterministic.run_id);
assert.match(audited.tool_version, /agent-intervention-tools/);
assert.ok(JSON.parse(audited.evidence_snapshot).sources.length);
assert.equal(audited.failure_reason, null);

const caregiverConversation = ensureConversation(caregiverId, seniorId, null);
const deniedRun = await runAgentV2({ actor: caregiver, subject: senior, conversation: caregiverConversation,
  message: '请帮我制定一个观察血糖的非药物干预方案', clientRequestId: `denied-${stamp}`, userMessageId: null });
assert.equal(deniedRun.presentation.actions.some(item => item.action_type === 'n_of_1_intervention'), false);
const deniedAudit = db.prepare(`SELECT tool_version,failure_reason FROM agent_tool_calls
  WHERE run_id=? AND tool_name='propose_intervention'`).get(deniedRun.run_id);
assert.match(deniedAudit.tool_version, /agent-intervention-tools/);
assert.equal(deniedAudit.failure_reason, 'INTERVENTION_PROPOSAL_FORBIDDEN');

console.log('agent N-of-1 proposal, confirmation, adherence, recheck, evaluation, rejection, emergency and caregiver loop: PASS');
