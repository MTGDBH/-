import db from '../db.js';
import { classifyAgentIntent, emergencyReply, planAgentTools, runAgentV2 } from './orchestratorV2.js';
import { resolveGoal, taskStateFor } from './goalResolver.js';

function parseJSON(value, fallback = {}) { try { return JSON.parse(value || '') || fallback; } catch { return fallback; } }
function nowIso() { return new Date().toISOString(); }

function explicitDays(message) {
  const match = String(message).match(/(?:最近)?\s*(\d{1,3})\s*天/);
  if (match) return Math.max(7, Math.min(365, Number(match[1])));
  if (/最近一周|这一周|近一周/.test(message)) return 7;
  if (/最近一个月|这一个月|近一月/.test(message)) return 30;
  return null;
}

function differentNamedSubject(message, subject) {
  const names = db.prepare('SELECT id,name FROM users WHERE name IS NOT NULL AND name<>?').all(subject.name);
  return names.find(row => String(message).includes(row.name)) || null;
}

function clarification(runId, conversation, choices, text, reason) {
  const presentation = { mode: 'clarification', status: { title: '请选择一项', text, tone: 'insufficient' }, choices: choices.slice(0, 4), safety: { level: 'routine', text: '选择后我再读取对应数据，不会自动修改健康记录。' } };
  db.prepare('UPDATE agent_runs SET status=?,context_manifest=?,latency_ms=?,completed_at=? WHERE id=?').run('completed', JSON.stringify({ clarification: reason, live_context_loaded: false, tool_budget: 0 }), 0, nowIso(), runId);
  return {
    source: 'deterministic_clarification', content: text, plan: [],
    confidence: { type: 'common_sense', score: 100, sources: ['后端目标解析'], reasoning: '缺少一个会改变工具路由的关键条件' },
    task_state: { goal: '明确本轮健康管理目标', status: 'waiting_user', next_step: '选择或补充一个关键条件', success_criteria: '健康对象、指标和时间范围明确' },
    presentation, run_id: runId, conversation_id: conversation.id, tool_trace: [], memory_candidates: [], action_previews: [],
    context_manifest: { clarification: reason, live_context_loaded: false, orchestrator_version: 'v3' },
  };
}

export function resolveDialogueTurn(conversation, subject, message) {
  const prior = parseJSON(conversation.dialogue_state, {});
  const intent = classifyAgentIntent(message);
  const explicitMetrics = [...intent.trendMetrics];
  const days = explicitDays(message);
  const isReference = /^(?:那|再|它|刚才|这个)|再看|呢[?？]?$|最近一周|最近一个月/.test(String(message).trim());
  let inherited = false;
  if (intent.trendHit && !intent.trendMetrics.length && isReference && Array.isArray(prior.metrics) && prior.metrics.length) {
    intent.trendMetrics = prior.metrics;
    inherited = true;
  }
  if (intent.trendHit && days) intent.days = days;
  else if (intent.trendHit && inherited && prior.days) intent.days = prior.days;
  if ((intent.riskHit || intent.diseaseRiskHit) && !/(高血压|血压|糖尿病|心脏病|心血管|脑卒中|中风)/.test(message) && prior.disease) intent.disease = prior.disease;
  const next = {
    schema_version: 'agent-dialogue-state.v1', metrics: explicitMetrics.length ? explicitMetrics : intent.trendMetrics.length ? intent.trendMetrics : prior.metrics || [],
    days: days || intent.days || prior.days || 90, disease: intent.disease || prior.disease || null,
    last_intent: intent.type, updated_at: nowIso(), subject_user_id: subject.id,
  };
  const additions = [];
  if (inherited) additions.push(`指标=${intent.trendMetrics.join(',')}`);
  if (days) additions.push(`时间范围=${days}天`);
  return { intent, next, inherited, resolvedMessage: additions.length ? `${message}\n[已确认上下文：${additions.join('；')}]` : message };
}

export async function runAgentV3(args) {
  const { actor, subject, conversation, message, clientRequestId } = args;
  const started = Date.now();
  const turn = resolveDialogueTurn(conversation, subject, message);
  const goal = resolveGoal(message, turn.intent, parseJSON(conversation.dialogue_state, {}));
  const runInsert = () => db.prepare(`INSERT INTO agent_runs (conversation_id,actor_user_id,subject_user_id,client_request_id,intent) VALUES (?,?,?,?,?)`)
    .run(conversation.id, actor.id, subject.id, clientRequestId || null, JSON.stringify(turn.intent));
  const other = differentNamedSubject(message, subject);
  if (other) {
    const runId = Number(runInsert().lastInsertRowid);
    return clarification(runId, conversation, [{ label: `继续查看${subject.name}`, value: '继续查看当前老人' }, { label: `先切换到${other.name}`, value: `请先切换到${other.name}` }], `当前选中的是${subject.name}，但问题中提到了${other.name}。请先确认要查看谁。`, 'subject_conflict');
  }
  const abnormalConcern = /(偏高|偏低|异常|突然升高|突然降低)/.test(message) && /(血压|血糖|心率|脉搏|血氧)/.test(message);
  const symptomAnswered = /(?:有|没有|无|伴随|不伴随).{0,12}(?:胸痛|呼吸困难|头晕|意识|抽搐|出血|口角|说话|无力|麻木|不适)|没有症状|无症状/.test(message);
  if (abnormalConcern && !symptomAnswered && !emergencyReply(message)) {
    const runId = Number(runInsert().lastInsertRowid);
    return clarification(runId, conversation, [
      { label: '没有明显不适', value: `${message}，目前没有明显不适` },
      { label: '有头晕或不适', value: `${message}，同时有头晕或其他不适` },
    ], '先确认一个关键问题：现在是否有胸痛、明显呼吸困难、意识异常、说话不清、单侧无力或其他明显不适？', 'symptom_check_required');
  }
  if (turn.intent.trendHit && !turn.intent.trendMetrics.length) {
    const runId = Number(runInsert().lastInsertRowid);
    return clarification(runId, conversation, ['血压', '血糖', '心率', '体重'].map(label => ({ label, value: `看看我最近90天的${label}趋势` })), '您想看哪一项健康趋势？', 'metric_missing');
  }
  if (turn.intent.proposeInterventionHit && !/(血压|高压|低压|收缩压|舒张压|血糖|心率|脉搏|体重|睡眠)/.test(message)) {
    const runId = Number(runInsert().lastInsertRowid);
    return clarification(runId, conversation, ['血压', '血糖', '心率', '体重', '睡眠'].map(label => ({
      label, value: `请帮我制定一个观察${label}的非药物个体干预方案`,
    })), '请先明确要观察哪个指标，以及准备怎样复测。', 'intervention_target_missing');
  }
  const fullPlan = planAgentTools(turn.intent, turn.resolvedMessage, { limit: false });
  if (fullPlan.length > 3) {
    const runId = Number(runInsert().lastInsertRowid);
    const choices = fullPlan.slice(0, 4).map(item => ({ label: ({ health_summary: '先看总体健康', behavior: '先看睡眠活动', device: '先看设备', alerts: '先看预警', knowledge: '先看健康知识' }[item.name] || item.name), value: ({ health_summary: '看看我的总体健康状况', behavior: '看看我最近的睡眠和活动', device: '看看设备同步状态', alerts: '看看待处理预警' }[item.name] || item.name) }));
    return clarification(runId, conversation, choices, '这次问题包含的内容较多，请选择想先看的一项。', 'tool_budget_exceeded');
  }
  const response = await runAgentV2({ ...args, message: turn.resolvedMessage, intentOverride: turn.intent });
  turn.next.pending_actions = (response.presentation?.actions || []).filter(item => item.requires_confirmation).map(item => item.action_type).slice(0, 2);
  turn.next.intervention_stage = turn.intent.proposeInterventionHit ? 'proposal_preview'
    : turn.intent.adherenceHit ? 'adherence_preview' : turn.intent.evaluateInterventionHit ? 'evaluated'
      : turn.intent.explainInterventionHit ? 'explained' : turn.next.intervention_stage || null;
  db.prepare('UPDATE agent_conversations SET dialogue_state=?,updated_at=? WHERE id=? AND actor_user_id=? AND subject_user_id=?')
    .run(JSON.stringify(turn.next), nowIso(), conversation.id, actor.id, subject.id);
  response.confidence = {
    type: response.confidence?.type === 'data' ? 'data' : 'common_sense',
    score: Number.isFinite(Number(response.confidence?.score)) ? Number(response.confidence.score) : (response.confidence?.type === 'data' ? 70 : 60),
    sources: Array.isArray(response.confidence?.sources) ? response.confidence.sources : [],
    reasoning: String(response.confidence?.reasoning || '按后端安全与证据规则生成'),
  };
  response.task_state = taskStateFor(response, goal);
  response.context_manifest = {
    ...(response.context_manifest || {}),
    identity: { actor_user_id: actor.id, subject_user_id: subject.id, actor_role: actor.role || 'senior', authority: actor.id === subject.id ? 'self' : 'delegated' },
    trust_levels: { user_text: 'untrusted_user', history: 'untrusted_history', memory: 'confirmed_only', rag: 'untrusted_retrieved_text', tool_results: 'backend_verified', system_policy: 'trusted_backend' },
    fact_priority: ['live_health_data','explicit_user_confirmation','formal_clinician_or_system_record','confirmed_long_term_memory','conversation_summary','model_inference'],
    goal,
    dialogue_state: turn.next, inherited_slots: turn.inherited, orchestrator_version: 'v3', v3_latency_ms: Date.now() - started,
  };
  return response;
}
