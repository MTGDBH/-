import crypto from 'node:crypto';
import db from '../db.js';
import { routeIntent } from './intentRouter.js';
import { buildHealthContext } from './contextBuilder.js';
import { composeGroundedResponse } from './agent.js';
import { analyzeSelectedHealthTrends } from './tools/healthTrend.js';
import { riskPredict } from './tools/riskPredict.js';
import { predictDisease } from '../lib/diseasePredictor.js';
import { analyzeBehavior } from './tools/behaviorPattern.js';
import { getDeviceStatus } from './tools/deviceStatus.js';
import { getHealthSummary } from './tools/healthSummary.js';
import { getAlertStatus } from './tools/alertStatus.js';
import { queryKnowledgeGraph } from './tools/knowledgeGraph.js';
import { getFollowupStatus } from './tools/followupStatus.js';
import { canActFor } from '../lib/intake.js';
import { buildAgentPresentation, presentationGroundingText } from './presentation.js';
import { localizeVisibleText, metricName } from './elderlyLanguage.js';

const MAX_TOOL_CALLS = 3;
const MAX_CONTEXT_TOKENS = 12000;
const MEMORY_CATEGORIES = new Set(['communication', 'schedule', 'diet', 'activity_limit', 'care_support', 'goal']);
const TOOL_LABELS = {
  health_trend: '健康趋势', htn_risk: '高血压风险筛查', disease_risk: '疾病风险筛查',
  behavior: '睡眠与活动', device: '设备状态', health_summary: '健康摘要', alerts: '待处理预警', knowledge: '知识依据', followup_status: '复测随访',
};

export const AGENT_TOOL_POLICIES = Object.freeze({
  health_trend: { display_name: '健康趋势', level: 'read', subject_bound: true, timeout_ms: 20000, cache: 'run+data_version', input_schema: { metrics: 'enum[]', days: 'integer:7..365' } },
  htn_risk: { display_name: '高血压风险筛查', level: 'read', subject_bound: true, timeout_ms: 20000, cache: 'run+data_version', input_schema: {} },
  disease_risk: { display_name: '疾病风险筛查', level: 'read', subject_bound: true, timeout_ms: 20000, cache: 'run+data_version', input_schema: { disease: 'hypertension|diabetes|heart_disease|stroke' } },
  behavior: { display_name: '睡眠与活动', level: 'read', subject_bound: true, timeout_ms: 3000, cache: 'run+data_version', input_schema: {} },
  device: { display_name: '设备状态', level: 'read', subject_bound: true, timeout_ms: 3000, cache: 'run+data_version', input_schema: {} },
  health_summary: { display_name: '健康摘要', level: 'read', subject_bound: true, timeout_ms: 3000, cache: 'run+data_version', input_schema: {} },
  alerts: { display_name: '待处理预警', level: 'read', subject_bound: true, timeout_ms: 3000, cache: 'run+data_version', input_schema: {} },
  knowledge: { display_name: '知识依据', level: 'read', subject_bound: true, timeout_ms: 5000, cache: 'run+index_version', input_schema: { question: 'string:max500', disease: 'enum|null' } },
  followup_status: { display_name: '复测随访', level: 'read', subject_bound: true, timeout_ms: 3000, cache: 'run+data_version', input_schema: {} },
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function stableJSON(value) { return JSON.stringify(stable(value)); }
function hash(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJSON(value)).digest('hex'); }
function nowIso() { return new Date().toISOString(); }
function approxTokens(value) { return Math.ceil(JSON.stringify(value || '').length / 2); }

export function resolveAgentSubject(actor, rawSubjectId) {
  const subjectId = rawSubjectId == null || rawSubjectId === '' ? Number(actor.id) : Number(rawSubjectId);
  if (!Number.isInteger(subjectId) || subjectId <= 0) return { error: 400, message: 'subject_user_id 不正确' };
  const access = canActFor(subjectId, actor.id);
  if (!access.allowed) return { error: 403, message: '未获得该老人的授权' };
  const subject = db.prepare('SELECT * FROM users WHERE id = ?').get(subjectId);
  if (!subject) return { error: 404, message: '老人账号不存在' };
  return { subject, access };
}

export function ensureConversation(actorId, subjectId, rawConversationId = null) {
  if (rawConversationId != null && rawConversationId !== '') {
    const id = Number(rawConversationId);
    const conversation = db.prepare('SELECT * FROM agent_conversations WHERE id = ? AND actor_user_id = ? AND subject_user_id = ?').get(id, actorId, subjectId);
    return conversation || null;
  }
  let conversation = db.prepare(`SELECT * FROM agent_conversations WHERE actor_user_id = ? AND subject_user_id = ? AND status = 'active' ORDER BY updated_at DESC,id DESC LIMIT 1`).get(actorId, subjectId);
  if (!conversation) {
    const result = db.prepare('INSERT INTO agent_conversations (actor_user_id,subject_user_id,title) VALUES (?,?,?)').run(actorId, subjectId, '健康对话');
    conversation = db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(result.lastInsertRowid);
  }
  return conversation;
}

export function emergencyReply(message) {
  const text = String(message || '');
  const hit = /突然.{0,30}(?:口角歪|脸歪|说不清|说话.{0,4}(?:不清|含糊)|一侧.{0,6}(?:无力|麻木)|手脚无力)|胸痛|胸口.*(?:压榨|剧痛)|呼吸困难|喘不过气|意识不清|昏迷|抽搐|大量出血/.test(text);
  if (!hit) return null;
  return {
    source: 'safety_rule', content: '你描述的情况可能是急症信号。请立即拨打当地急救电话或让身边的人帮助就医，不要等待智能体分析，也不要自行驾车。',
    plan: [{ icon: '急', title: '立即求助', desc: '联系急救并让家人陪同，记录症状开始时间', color: 'red', action_type: 'contact_doctor' }],
    confidence: { type: 'common_sense' }, evidence: null,
  };
}

function metricNames(message) {
  const metrics = [];
  const high = /高压|收缩压/.test(message), low = /低压|舒张压/.test(message);
  if (/血压/.test(message) || (high && low)) metrics.push('systo', 'diasto');
  else if (high) metrics.push('systo'); else if (low) metrics.push('diasto');
  if (/血糖/.test(message)) metrics.push('glucose');
  if (/心率|脉搏/.test(message)) metrics.push('pulse');
  if (/体重/.test(message)) metrics.push('weight');
  if (/睡眠|睡得/.test(message)) metrics.push('sleep');
  return [...new Set(metrics)];
}

function diseaseFromMessage(message) {
  if (/高血压|血压/.test(message)) return 'hypertension';
  if (/糖尿病|血糖/.test(message)) return 'diabetes';
  if (/脑卒中|中风/.test(message)) return 'stroke';
  if (/心脏病|心血管/.test(message)) return 'heart_disease';
  if (/慢性肾|肾功能|肾脏|肌酐|尿白蛋白/.test(message)) return 'chronic_kidney_disease';
  if (/衰弱|跌倒|握力|营养不良/.test(message)) return 'frailty';
  return null;
}

export function classifyAgentIntent(message) {
  const routed = routeIntent(message);
  const dailyPlanHit = /(?:生成|制定|看看|给我).{0,8}(?:今日|今天).{0,6}(?:健康)?方案|(?:今日|今天).{0,6}(?:健康)?方案/.test(message);
  const dailyTipHit = /(?:今日|今天|日常).{0,8}(?:健康|养生)?贴士|养生建议|今天.{0,6}(?:注意什么|该注意什么)/.test(message);
  const trendHit = routed.trend || /(血压|血糖|心率|体重).{0,8}(偏高|偏低|异常|怎么样)/.test(message);
  const riskHit = routed.risk;
  const diseaseRiskHit = routed.diseaseRisk;
  const graphRelationHit = dailyTipHit || /关系|相关|影响|为什么|怎么办|建议|注意|正常范围|是什么|介绍|概念|科普|如何/.test(message);
  const detectedMetrics = metricNames(message);
  const knowledgeOnlyRelation = graphRelationHit && !detectedMetrics.length && !/(最近|近\d+天|趋势|这次测量)/.test(message);
  const followupHit = /(复测|随访).{0,10}(安排|结果|任务|到期|完成|怎么样)|(安排|结果|任务|到期|完成).{0,10}(复测|随访)/.test(message);
  return {
    ...routed, trendHit: dailyTipHit || knowledgeOnlyRelation ? false : trendHit, riskHit: dailyTipHit ? false : riskHit, diseaseRiskHit: dailyTipHit ? false : diseaseRiskHit, graphRelationHit, followupHit,
    dailyPlanHit, dailyTipHit,
    behaviorHit: dailyPlanHit || (routed.behavior && !/关系|相关|影响/.test(message)),
    deviceHit: routed.device, alertsHit: dailyPlanHit || routed.alerts, healthSummaryHit: dailyPlanHit || routed.healthSummary,
    actionHit: routed.action, forecastRequested: /未来|预测|外推|以后会/.test(message),
    trendMetrics: detectedMetrics, disease: diseaseFromMessage(message),
  };
}

export function planAgentTools(intent, message, { limit = true } = {}) {
  const plan = [];
  const add = (name, args = {}) => { if (!plan.some(item => item.name === name)) plan.push({ name, args }); };
  if (intent.dailyPlanHit) {
    add('health_summary'); add('alerts'); add('behavior');
    return limit ? plan.slice(0, MAX_TOOL_CALLS) : plan;
  }
  if (intent.dailyTipHit) {
    add('knowledge', { question: String(message).slice(0, 500), disease: null });
    return plan;
  }
  // 风险模型优先于曲线，保证单轮最多一个 Python 模型任务。
  if (intent.diseaseRiskHit) add('disease_risk', { disease: intent.disease });
  else if (intent.riskHit) add('htn_risk');
  else if (intent.trendHit) add('health_trend', { metrics: intent.trendMetrics.length ? intent.trendMetrics : ['systo', 'diasto'], days: intent.days || 90 });
  if (intent.healthSummaryHit) { add('health_summary'); add('alerts'); }
  else if (intent.alertsHit) add('alerts');
  if (intent.behaviorHit) add('behavior');
  if (intent.deviceHit) add('device');
  if (intent.followupHit) add('followup_status');
  if (intent.graphRelationHit) add('knowledge', { question: String(message).slice(0, 500), disease: intent.disease });
  return limit ? plan.slice(0, MAX_TOOL_CALLS) : plan;
}

const REGISTRY = {
  health_trend: { python: true, retry: 0, timeout_ms: 20000, validate: x => x?.success === true && Array.isArray(x.metrics), run: (ctx, args) => analyzeSelectedHealthTrends(ctx.subject.id, args.metrics, args.days) },
  htn_risk: { python: true, retry: 0, timeout_ms: 20000, validate: x => x?.success === true && Number.isFinite(Number(x.dataCount)), run: ctx => riskPredict(ctx.subject.id, ctx.subject) },
  disease_risk: { python: true, retry: 0, timeout_ms: 20000, validate: x => x?.success === true && typeof x.disease === 'string' && typeof x.status === 'string', run: (ctx, args) => predictDisease(ctx.subject.id, ctx.subject, args.disease) },
  behavior: { retry: 1, timeout_ms: 3000, validate: x => x?.success === true && x.behavior && typeof x.behavior === 'object', run: ctx => analyzeBehavior(ctx.subject.id, ctx.subject) },
  device: { retry: 1, timeout_ms: 3000, validate: x => x?.success === true && Array.isArray(x.devices) && Array.isArray(x.recent_device_metrics), run: ctx => getDeviceStatus(ctx.subject.id) },
  health_summary: { retry: 1, timeout_ms: 3000, validate: x => x?.success === true && Array.isArray(x.latest) && Number.isFinite(Number(x.data_points)), run: ctx => getHealthSummary(ctx.subject) },
  alerts: { retry: 1, timeout_ms: 3000, validate: x => x?.success === true && Array.isArray(x.alerts) && Number.isFinite(Number(x.pending)), run: ctx => getAlertStatus(ctx.subject.id) },
  knowledge: { retry: 1, timeout_ms: 5000, validate: x => Array.isArray(x?.results) && Array.isArray(x?.citations) && typeof x?.index_version === 'string', run: (ctx, args) => queryKnowledgeGraph(args.question, args.disease, ctx.liveContext, { audience: ctx.audience, topK: 6, maxHops: 2, includeTrace: true }) },
  followup_status: { retry: 1, timeout_ms: 3000, validate: x => x?.success === true && Array.isArray(x.items) && Number.isFinite(Number(x.total)), run: ctx => getFollowupStatus(ctx.subject.id) },
};

function timeout(promise, ms) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('tool timeout'), { code: 'TOOL_TIMEOUT' })), ms); })]).finally(() => clearTimeout(timer));
}

function sanitizeResult(value, depth = 0) {
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeResult(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 2000) : value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/stack|traceback|model_path|script_path|api_key|password|token/i.test(key)) continue;
    out[key] = sanitizeResult(item, depth + 1);
  }
  return out;
}

function toolManifest(result) {
  return {
    success: result?.success !== false,
    status: result?.status || (result?.success === false ? 'error' : 'ok'),
    data_points: result?.data_points ?? result?.total ?? result?.metrics?.length ?? result?.latest?.length ?? null,
    freshness: result?.data_freshness || result?.evidence_freshness || result?.latest?.[0]?.recorded_at || result?.alerts?.[0]?.created_at || null,
  };
}

function readableKnowledgeCitation(row = {}) {
  const publisher = String(row.publisher || '').trim();
  const year = String(row.publication_year || '').trim();
  if (publisher) return `${publisher}${year ? `（${year}）` : ''}`;
  return '健康知识来源';
}

function modelResultView(name, result) {
  if (name === 'health_trend') return {
    success: result.success,
    period_days: result.requested_days || result.period_days || result.days || 90,
    data_freshness: result.data_freshness || null,
    metrics: (result.metrics || []).slice(0, 4).map(row => ({
      metric: row.metric, status: row.status, unit: row.unit, data_points: row.data_points,
      long_term_trend: row.long_term_trend, recent_trend: row.recent_trend,
      latest_value: row.latest_value, previous_value: row.previous_value, change: row.change,
      time_span_days: row.time_span_days, fluctuation: row.fluctuation,
      forecast: row.forecast ? { available: row.forecast.available, horizon_days: row.forecast.horizon_days, reason: row.forecast.reason } : null,
      eligibility: row.eligibility || null,
    })),
  };
  if (name === 'knowledge') return {
    query: result.query, disease: result.disease, index_version: result.index_version,
    results: (result.results || []).slice(0, 6).map(row => ({
      text: String(row.text || '').slice(0, 600), citation: readableKnowledgeCitation(row), evidence_level: row.evidence_level,
      publisher: row.publisher, publication_year: row.publication_year, review_status: row.review_status,
    })),
    citations: (result.citations || []).slice(0, 6).map(row => ({
      label: readableKnowledgeCitation(row), url: row.source_url || row.url || null,
      publisher: row.publisher || null, publication_year: row.publication_year || null,
      evidence_level: row.evidence_level || null, review_status: row.review_status || null,
    })),
    research_relationships: (result.relationship_candidates || []).slice(0, 3).map(row => ({
      labels: row.node_labels || [], explanation: row.allowed_expression,
      status: '测试版研究预览', direct_causality_proven: false, not_for_actions: true,
    })),
    safety_flags: result.safety_flags || [], uncertainty: result.uncertainty || null,
  };
  return result;
}

async function executeOne(runId, callIndex, item, ctx, dataVersion) {
  const spec = REGISTRY[item.name];
  if (!spec) return { name: item.name, status: 'error', error_code: 'TOOL_NOT_REGISTERED', result: null };
  const args = stable(item.args || {});
  const dedupeKey = hash({ tool: item.name, subject: ctx.subject.id, args, dataVersion });
  const inserted = db.prepare(`INSERT INTO agent_tool_calls (run_id,call_index,tool_name,subject_user_id,arguments,dedupe_key)
    VALUES (?,?,?,?,?,?)`).run(runId, callIndex, item.name, ctx.subject.id, JSON.stringify(args), dedupeKey);
  const started = Date.now();
  let result = null, fullResult = null, errorCode = null;
  for (let attempt = 0; attempt <= spec.retry; attempt++) {
    try {
      fullResult = sanitizeResult(await timeout(spec.run(ctx, args), spec.timeout_ms));
      if (!fullResult || typeof fullResult !== 'object' || fullResult.success === false) throw Object.assign(new Error('tool result unavailable'), { code: fullResult?.reason_code || 'TOOL_RESULT_INVALID' });
      if (!spec.validate(fullResult)) throw Object.assign(new Error('tool result schema mismatch'), { code: 'TOOL_RESULT_SCHEMA' });
      result = modelResultView(item.name, fullResult);
      break;
    } catch (error) {
      errorCode = ['TOOL_TIMEOUT', 'TOOL_RESULT_INVALID', 'TOOL_RESULT_SCHEMA'].includes(error.code) || String(error.code || '').startsWith('MODEL_') ? error.code : 'TOOL_UNAVAILABLE';
      if (attempt >= spec.retry) { result = null; fullResult = null; }
    }
  }
  const latency = Date.now() - started;
  const manifest = fullResult ? toolManifest(fullResult) : { success: false, status: 'error' };
  db.prepare(`UPDATE agent_tool_calls SET status=?,latency_ms=?,error_code=?,result_manifest=?,result_hash=?,completed_at=? WHERE id=?`)
    .run(result ? 'success' : 'error', latency, errorCode, JSON.stringify(manifest), fullResult ? hash(fullResult) : null, nowIso(), inserted.lastInsertRowid);
  return { name: item.name, label: TOOL_LABELS[item.name], status: result ? 'success' : 'error', latency_ms: latency, error_code: errorCode, manifest, result };
}

function subjectDataVersion(subjectId) {
  const metric = db.prepare('SELECT COUNT(*) AS n,MAX(recorded_at) AS at FROM metrics WHERE user_id = ?').get(subjectId);
  const alert = db.prepare('SELECT COUNT(*) AS n,MAX(created_at) AS at FROM alerts WHERE user_id = ?').get(subjectId);
  const followup = db.prepare('SELECT COUNT(*) AS n,MAX(updated_at) AS at FROM followups WHERE user_id=?').get(subjectId);
  return hash({ metric, alert, followup });
}

function relevantTypes(message, intent) {
  const map = [];
  if (/血压|高压|低压/.test(message)) map.push('bp');
  if (/血糖|糖尿病/.test(message)) map.push('glucose');
  if (/心率|脉搏/.test(message)) map.push('hr');
  if (/睡眠/.test(message)) map.push('sleep');
  if (/步数|活动/.test(message)) map.push('steps');
  if (/体重|BMI/.test(message)) map.push('weight');
  if (intent.healthSummaryHit) return null;
  return [...new Set(map)];
}

function minimalLiveContext(full, message, intent) {
  if (!full) return null;
  const types = relevantTypes(message, intent);
  const keep = object => types == null ? object : Object.fromEntries(Object.entries(object || {}).filter(([key]) => types.includes(key)));
  return {
    as_of: nowIso(), window_days: full.window_days,
    latest: keep(full.latest), quality_by_type: keep(full.quality_by_type),
    behavior: types == null || types.some(type => ['sleep', 'steps'].includes(type)) ? full.behavior : {},
    alerts: intent.healthSummaryHit || intent.alertsHit ? full.alerts : [],
    todos: intent.healthSummaryHit ? full.todos : [],
    profile: (intent.riskHit || intent.diseaseRiskHit || intent.healthSummaryHit || intent.graphRelationHit) ? full.profile : { age: full.profile?.age, gender: full.profile?.gender },
    data_completeness: full.data_completeness,
  };
}

export function needsLiveHealthContext(message, intent) {
  if (intent.trendHit || intent.riskHit || intent.diseaseRiskHit || intent.healthSummaryHit || intent.behaviorHit) return true;
  return intent.graphRelationHit && /我|我的|本人|结合.{0,6}(?:记录|数据)|根据.{0,6}(?:记录|数据)/.test(message);
}

function confirmedMemories(subjectId, message) {
  const rows = db.prepare(`SELECT id,category,memory_key,content,confirmed_at,valid_until FROM agent_memories
    WHERE subject_user_id=? AND status='confirmed' AND (valid_until IS NULL OR valid_until>?) ORDER BY updated_at DESC LIMIT 20`).all(subjectId, nowIso());
  const categoryHints = /吃|饮食|口味/.test(message) ? ['diet'] : /早|晚|时间|作息/.test(message) ? ['schedule'] : /运动|走|活动/.test(message) ? ['activity_limit', 'goal'] : null;
  return rows.sort((a, b) => Number(categoryHints?.includes(b.category)) - Number(categoryHints?.includes(a.category))).slice(0, 8);
}

function recentMessages(conversationId) {
  return db.prepare(`SELECT id,role,content,created_at FROM chat_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 12`).all(conversationId).reverse();
}

function parseSummary(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }

export function buildContextPlan(conversation, subject, message, intent, liveContext, actor = null) {
  let memories = confirmedMemories(subject.id, message);
  let summary = parseSummary(conversation.summary);
  let recent = recentMessages(conversation.id);
  const manifest = { max_tokens: MAX_CONTEXT_TOKENS, immutable: ['safety_policy', 'identity_authority', 'live_context', 'tool_results'], pruned: [] };
  const current = () => ({
    current_time: nowIso(),
    identity: { actor_id: actor?.id || subject.id, actor_name: actor?.name || subject.name, subject_id: subject.id, subject_name: subject.name, authority: actor && actor.id !== subject.id ? 'caregiver' : 'self' },
    liveContext, memories, summary, recent,
  });
  while (approxTokens(current()) > MAX_CONTEXT_TOKENS && memories.length) { memories.pop(); manifest.pruned.push('memory'); }
  if (approxTokens(current()) > MAX_CONTEXT_TOKENS && summary && Object.keys(summary).length) { summary = { topics: (summary.topics || []).slice(-3) }; manifest.pruned.push('summary_details'); }
  while (approxTokens(current()) > MAX_CONTEXT_TOKENS && recent.length > 4) { recent.shift(); manifest.pruned.push('oldest_turn'); }
  manifest.estimated_tokens = approxTokens(current());
  manifest.recent_messages = recent.length;
  manifest.confirmed_memories = memories.length;
  manifest.live_context_loaded = !!liveContext;
  manifest.live_metric_types = Object.keys(liveContext?.latest || {});
  return { memories, summary, recent, manifest };
}

function numericTokens(value) {
  return String(value || '').match(/\d+(?:\.\d+)?/g) || [];
}

export function groundedNumbersMatch(content, toolResults, liveContext) {
  const claimed = numericTokens(content);
  if (!claimed.length) return true;
  const evidence = new Set(numericTokens(stableJSON({
    live_context: liveContext,
    tool_results: toolResults.map(item => item?.result).filter(Boolean),
  })));
  return claimed.every(value => evidence.has(value));
}

function fitToolResultsIntoContext(contextPlan, toolResults) {
  const toolTokens = approxTokens(toolResults.map(item => item.result).filter(Boolean));
  const total = () => approxTokens({
    memories: contextPlan.memories,
    summary: contextPlan.summary,
    recent: contextPlan.recent,
  }) + toolTokens;
  while (total() > MAX_CONTEXT_TOKENS && contextPlan.memories.length) { contextPlan.memories.pop(); contextPlan.manifest.pruned.push('memory_for_tool_evidence'); }
  if (total() > MAX_CONTEXT_TOKENS && contextPlan.summary && Object.keys(contextPlan.summary).length) {
    contextPlan.summary = { topics: (contextPlan.summary.topics || []).slice(-2) };
    contextPlan.manifest.pruned.push('summary_for_tool_evidence');
  }
  while (total() > MAX_CONTEXT_TOKENS && contextPlan.recent.length > 4) { contextPlan.recent.shift(); contextPlan.manifest.pruned.push('oldest_turn_for_tool_evidence'); }
  contextPlan.manifest.tool_result_tokens = toolTokens;
  contextPlan.manifest.estimated_tokens = total();
  contextPlan.manifest.recent_messages = contextPlan.recent.length;
  contextPlan.manifest.confirmed_memories = contextPlan.memories.length;
}

function stripHealthFacts(text) {
  return String(text || '').replace(/\b\d+(?:\.\d+)?\s*(?:mmHg|mmol\/L|bpm|kg|%|毫克|mg|片|粒)?/gi, '[数值已省略]').slice(0, 160);
}

export function refreshConversationSummary(conversationId) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id=?').get(conversationId).n;
  if (count <= 12) return null;
  const older = db.prepare(`SELECT id,role,content FROM chat_messages WHERE conversation_id=? ORDER BY id DESC LIMIT -1 OFFSET 12`).all(conversationId).reverse();
  const userMessages = older.filter(row => row.role === 'user').slice(-12).map(row => stripHealthFacts(row.content));
  const topics = userMessages.slice(-8);
  const unresolved = userMessages.filter(text => /[？?]|还没|以后|下次|待/.test(text)).slice(-4);
  const confirmedDecisions = userMessages.filter(text => /我决定|我确认|请记住|以后按|就这样/.test(text)).slice(-4);
  const summary = { schema_version: 'agent-conversation-summary.v1', topics, unresolved, confirmed_decisions: confirmedDecisions, note: '健康数值和模型结论未写入摘要', updated_at: nowIso() };
  const maxId = older.at(-1)?.id || null;
  db.prepare('UPDATE agent_conversations SET summary=?,summary_up_to_message_id=?,updated_at=? WHERE id=?').run(JSON.stringify(summary), maxId, nowIso(), conversationId);
  return summary;
}

function memoryCategory(text) {
  if (/说慢|大字|简单|称呼|叫我/.test(text)) return ['communication', 'communication_style'];
  if (/早上|晚上|每天|通常|习惯|作息|点钟/.test(text)) return ['schedule', 'routine'];
  if (/不吃|喜欢吃|口味|饮食/.test(text)) return ['diet', 'diet_preference'];
  if (/走不动|活动不便|膝|轮椅|拐杖/.test(text)) return ['activity_limit', 'mobility'];
  if (/家属|儿子|女儿|照护|陪同/.test(text)) return ['care_support', 'support'];
  return ['goal', 'personal_goal'];
}

export function createMemoryCandidate(subjectId, actorId, sourceMessageId, message) {
  const text = String(message || '').trim();
  if (!/(请记住|记住|我习惯|我通常|我喜欢|我不喜欢|我每天|我想要)/.test(text)) return null;
  if (/风险|概率|确诊|诊断|急救|血压.{0,8}\d|血糖.{0,8}\d|\d+\s*(?:mg|毫克|片|粒)/i.test(text)) return null;
  const [category, memoryKey] = memoryCategory(text);
  if (!MEMORY_CATEGORIES.has(category)) return null;
  const content = text.replace(/^(请)?记住[：,:，]?\s*/, '').slice(0, 240);
  const existing = db.prepare(`SELECT * FROM agent_memories WHERE subject_user_id=? AND memory_key=? AND content=? AND status IN ('candidate','confirmed') ORDER BY id DESC LIMIT 1`).get(subjectId, memoryKey, content);
  if (existing) return existing;
  const inserted = db.prepare(`INSERT INTO agent_memories (subject_user_id,actor_user_id,category,memory_key,content,source_message_id)
    VALUES (?,?,?,?,?,?)`).run(subjectId, actorId, category, memoryKey, content, sourceMessageId);
  return db.prepare('SELECT * FROM agent_memories WHERE id=?').get(inserted.lastInsertRowid);
}

function actionPreview(message) {
  // 查询复测状态不等于要求创建复测；只有明确行动表达才生成写入预览。
  if (!/(帮我|请.{0,6}(?:安排|创建|设置|提醒|通知)|安排|提醒我|创建待办|设置提醒|通知家属|联系医生|我要复测|想复测|复测一下)/.test(message)) return [];
  const actionType = /通知家属/.test(message) ? 'notify_caregiver' : /联系医生|就医/.test(message) ? 'contact_doctor' : /复测|测血压|测血糖/.test(message) ? 'schedule_recheck' : 'create_todo';
  return [{ icon: '待', color: 'orange', action_type: actionType, title: String(message).replace(/^帮我/, '').slice(0, 80) || '健康待办', desc: '确认后才会写入，不会自动通知外部人员', requires_confirmation: true }];
}

function deterministicReply(message, toolResults, intent) {
  const ok = toolResults.filter(item => item.status === 'success');
  if (!ok.length && intent.actionHit) return { content: '我已经整理成待确认的行动。只有你点击确认后，系统才会创建记录。', plan: actionPreview(message), confidence: { type: 'common_sense' } };
  if (!ok.length) return { content: intent.type === 'common_health_question' ? '我可以提供一般健康知识；如果要结合个人数据，请明确告诉我想看哪项指标或哪段时间。' : '相关健康工具暂时没有得到可用结果，请稍后重试，或先补充规范记录。', plan: [], confidence: { type: 'common_sense' } };
  const trend = ok.find(item => item.name === 'health_trend')?.result;
  if (trend) {
    const rows = trend.metrics || [];
    const words = rows.map(row => `${metricName(row.metric)}：${row.status === 'ok' ? ({ rising: '总体上升', falling: '总体下降', stable: '总体稳定' }[row.long_term_trend] || '已有趋势') : '数据不足'}`);
    return { content: `根据当前账户的真实记录，${words.join('；') || '暂时没有足够数据判断趋势'}。这不是诊断，异常读数请按同一条件复测。`, plan: [{ icon: '测', title: '继续规范记录', desc: '固定时间和测量条件，出现不适及时就医', color: 'orange', action_type: 'schedule_recheck' }], confidence: { type: 'data', score: 80, sources: ['健康趋势工具'], reasoning: '由后端趋势工具直接生成' } };
  }
  const alerts = ok.find(item => item.name === 'alerts')?.result;
  if (alerts && intent.alertsHit) return { content: alerts.pending ? `目前有 ${alerts.pending} 条待处理提醒${alerts.critical ? `，其中 ${alerts.critical} 条为严重提醒` : ''}。请优先查看严重项目。` : '目前没有待处理提醒。请继续按计划记录健康数据。', plan: [], confidence: { type: 'data', score: 90, sources: ['站内预警'], reasoning: '读取当前老人待处理预警' } };
  const summary = ok.find(item => item.name === 'health_summary')?.result;
  if (intent.dailyPlanHit && summary) {
    const alerts = ok.find(item => item.name === 'alerts')?.result;
    const actions = [];
    if (alerts?.pending) actions.push({ icon: '看', title: '先查看待处理提醒', desc: `目前有 ${alerts.pending} 项待处理，请优先查看严重项目`, color: alerts.critical ? 'red' : 'orange', action_type: null });
    actions.push({ icon: '记', title: '继续规律记录', desc: '固定时间和测量条件，保留连续记录', color: 'green', action_type: null });
    return { content: `已读取近${summary.window_days || 90}天的健康记录，并整理了今天最重要的事项。${summary.missing_common_metrics?.length ? `目前还缺少${summary.missing_common_metrics.map(metricName).join('、')}记录。` : '常用指标记录较完整。'}`, plan: actions.slice(0, 2), confidence: { type: 'data', score: 82, sources: ['健康摘要', '待处理预警', '睡眠与活动'], reasoning: '根据当前老人的实时健康信息生成' } };
  }
  if (summary) return { content: `已读取近${summary.window_days || 90}天健康记录，共 ${summary.data_points || 0} 条。${summary.missing_common_metrics?.length ? `还缺少：${summary.missing_common_metrics.join('、')}。` : '常用指标记录较完整。'}请先处理待办预警，再继续规律测量。`, plan: [], confidence: { type: 'data', score: 82, sources: ['健康摘要工具'], reasoning: '读取当前老人实时健康摘要' } };
  const risk = ok.find(item => ['htn_risk', 'disease_risk'].includes(item.name))?.result;
  if (risk) return { content: risk.existing_diagnosis ? '相关疾病已记录为确诊状态，本次不计算新发概率，转为日常管理和复诊提醒。' : `风险工具已完成筛查，当前分层为${risk.risk_tier || risk.risk_level || '证据有限'}。精确概率只有在模型通过准入门槛时才展示，这不是诊断。`, plan: [], confidence: { type: 'data', score: 75, sources: ['疾病风险筛查工具'], reasoning: '使用通过后端门禁的模型结果' } };
  const followups = ok.find(item => item.name === 'followup_status')?.result;
  if (followups) return { content: followups.total ? `目前有 ${followups.total} 项复测随访，其中 ${followups.due} 项已到期，${followups.overdue} 项已逾期，${followups.pending_confirmation} 项有待确认的新测量。` : '目前没有待处理的复测随访。', plan: [], confidence: { type: 'data', score: 90, sources: ['复测随访工具'], reasoning: '读取当前老人的实时随访状态' } };
  const knowledge = ok.find(item => item.name === 'knowledge')?.result;
  if (knowledge) {
    const links = (knowledge.research_relationships || []).slice(0, 2).map(row => (row.labels || []).join(' → ')).filter(Boolean);
    const preview = links.length ? `测试版还发现了可能的间接关联：${links.join('；')}。这些关系用于拓展观察方向，尚未证明直接因果。` : '';
    return { content: `${knowledge.results?.[0]?.text || '已读取相关健康知识。'}${preview}`, plan: [], confidence: { type: 'data', score: 68, sources: ['健康知识', ...(knowledge.citations || []).map(row => row.label).slice(0, 2)], reasoning: '基于可追溯知识来源，并包含明确标记的测试版间接关联' } };
  }
  return { content: '我已读取与你问题相关的实时信息，并整理了最重要的结论。工具结果仅用于健康管理，不替代医生判断。', plan: actionPreview(message), confidence: { type: 'data', score: 70, sources: ok.map(item => item.label), reasoning: '基于后端已校验工具结果' } };
}

function normalizeOutputPhrases(value) {
  return localizeVisibleText(value)
    .replace(/高压（高压）/g, '高压')
    .replace(/低压（低压）/g, '低压')
    .replace(/现在[：:]\s*现在[：:]/g, '现在：')
    .replace(/今天[：:]\s*今天[：:]/g, '今天：')
    .trim();
}

export async function runAgentV2({ actor, subject, conversation, message, clientRequestId, userMessageId, intentOverride = null }) {
  const started = Date.now();
  const intent = intentOverride || classifyAgentIntent(message);
  const runInsert = db.prepare(`INSERT INTO agent_runs (conversation_id,actor_user_id,subject_user_id,client_request_id,intent)
    VALUES (?,?,?,?,?)`).run(conversation.id, actor.id, subject.id, clientRequestId || null, JSON.stringify(intent));
  const runId = Number(runInsert.lastInsertRowid);
  const emergency = emergencyReply(message);
  let liveContext = null;
  let contextPlan;
  if (emergency) {
    contextPlan = {
      memories: [], summary: {}, recent: [],
      manifest: { max_tokens: MAX_CONTEXT_TOKENS, emergency_bypass: true, live_context_loaded: false, live_metric_types: [], recent_messages: 0, confirmed_memories: 0, estimated_tokens: 0, pruned: [] },
    };
  } else {
    const fullContext = needsLiveHealthContext(message, intent) ? buildHealthContext(subject, 90) : null;
    liveContext = minimalLiveContext(fullContext, message, intent);
    contextPlan = buildContextPlan(conversation, subject, message, intent, liveContext, actor);
    contextPlan.recent = contextPlan.recent.filter(row => Number(row.id) !== Number(userMessageId));
    contextPlan.manifest.recent_messages = contextPlan.recent.length;
  }
  db.prepare('UPDATE agent_runs SET context_manifest=? WHERE id=?').run(JSON.stringify(contextPlan.manifest), runId);
  let toolResults = [];
  if (!emergency) {
    const toolPlan = planAgentTools(intent, message);
    const ctx = { actor, subject, audience: actor.role === 'doctor' ? 'doctor' : actor.id === subject.id ? 'elderly' : 'caregiver', liveContext: liveContext || {} };
    const version = subjectDataVersion(subject.id);
    toolResults = await Promise.all(toolPlan.map((item, index) => executeOne(runId, index, item, ctx, version)));
  }
  fitToolResultsIntoContext(contextPlan, toolResults);
  db.prepare('UPDATE agent_runs SET context_manifest=? WHERE id=?').run(JSON.stringify(contextPlan.manifest), runId);
  let response = emergency;
  if (!response) {
    try {
      response = await composeGroundedResponse({
        messages: contextPlan.recent.map(row => ({ role: row.role, content: row.content })), userMessage: message,
        healthSummary: { context: liveContext }, user: subject, actor, authority: actor.id === subject.id ? 'self' : 'caregiver', intent,
        toolResults, memories: contextPlan.memories.map(row => ({ category: row.category, content: row.content })), conversationSummary: contextPlan.summary,
      });
      if (response && (toolResults.length || liveContext) && !groundedNumbersMatch(response.content, toolResults, liveContext)) response = null;
    } catch { response = null; }
    response ||= deterministicReply(message, toolResults, intent);
  }
  const previews = actionPreview(message);
  if (previews.length) response.plan = previews;
  response.plan = (response.plan || []).slice(0, 2);
  response.content = normalizeOutputPhrases(response.content);
  const activeKnowledge = toolResults.find(item => item.name === 'knowledge' && item.status === 'success')?.result || null;
  const activeResearchRelations = (activeKnowledge?.research_relationships || []).slice(0, 2);
  if (intent.graphRelationHit && activeResearchRelations.length && !/测试版关联发现|间接关联线索/.test(response.content)) {
    const paths = activeResearchRelations.map(row => (row.labels || []).join(' → ')).filter(Boolean);
    if (paths.length) response.content = `${response.content}\n测试版关联发现：${paths.join('；')}。这是间接关联线索，尚未证明直接因果。`;
  }
  let presentation = buildAgentPresentation({ response, toolResults, liveContext, intent, subject, actor, message });
  if (presentation.mode !== 'plain' && !groundedNumbersMatch(presentationGroundingText(presentation), toolResults, liveContext)) {
    const fallback = deterministicReply(message, toolResults, intent);
    response = { ...response, ...fallback, plan: previews.length ? previews : fallback.plan };
    response.content = normalizeOutputPhrases(response.content);
    presentation = buildAgentPresentation({ response, toolResults, liveContext, intent, subject, actor, message });
  }
  const memoryCandidate = emergency ? null : createMemoryCandidate(subject.id, actor.id, userMessageId, message);
  const trace = toolResults.map(item => ({ name: item.name, label: item.label, status: item.status, latency_ms: item.latency_ms, freshness: item.manifest?.freshness || null, error_code: item.error_code || null }));
  const knowledgeEvidence = activeKnowledge;
  const mergedEvidence = knowledgeEvidence ? {
    ...knowledgeEvidence,
    ...(response.evidence || {}),
    research_relationships: knowledgeEvidence.research_relationships || [],
  } : response.evidence;
  response = {
    ...response,
    evidence: mergedEvidence,
    run_id: runId,
    conversation_id: conversation.id,
    tool_trace: trace,
    memory_candidates: memoryCandidate ? [memoryCandidate] : [],
    action_previews: previews,
    presentation,
    context_manifest: contextPlan.manifest,
  };
  db.prepare('UPDATE agent_runs SET status=?,latency_ms=?,completed_at=? WHERE id=?').run('completed', Date.now() - started, nowIso(), runId);
  return response;
}
