import db from '../db.js';
import { classifyAgentIntent, planAgentTools, runAgentV2 } from './orchestratorV2.js';

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
  return { source: 'deterministic_clarification', content: text, plan: [], confidence: { type: 'common_sense' }, presentation, run_id: runId, conversation_id: conversation.id, tool_trace: [], memory_candidates: [], action_previews: [], context_manifest: { clarification: reason, live_context_loaded: false } };
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
  const runInsert = () => db.prepare(`INSERT INTO agent_runs (conversation_id,actor_user_id,subject_user_id,client_request_id,intent) VALUES (?,?,?,?,?)`)
    .run(conversation.id, actor.id, subject.id, clientRequestId || null, JSON.stringify(turn.intent));
  const other = differentNamedSubject(message, subject);
  if (other) {
    const runId = Number(runInsert().lastInsertRowid);
    return clarification(runId, conversation, [{ label: `继续查看${subject.name}`, value: '继续查看当前老人' }, { label: `先切换到${other.name}`, value: `请先切换到${other.name}` }], `当前选中的是${subject.name}，但问题中提到了${other.name}。请先确认要查看谁。`, 'subject_conflict');
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
  response.context_manifest = { ...(response.context_manifest || {}), dialogue_state: turn.next, inherited_slots: turn.inherited, orchestrator_version: 'v3', v3_latency_ms: Date.now() - started };
  return response;
}
