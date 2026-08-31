import { localizeVisibleText, unitName } from './elderlyLanguage.js';

const METRICS = {
  bp: { label: '最近血压', unit: '毫米汞柱' },
  glucose: { label: '最近血糖', unit: '毫摩尔/升' },
  hr: { label: '最近心率', unit: '次/分' },
  weight: { label: '最近体重', unit: '千克' },
  sleep: { label: '最近睡眠', unit: '小时' },
  steps: { label: '最近步数', unit: '步' },
  spo2: { label: '最近血氧', unit: '%' },
  temp: { label: '最近体温', unit: '℃' },
  resp: { label: '最近呼吸频率', unit: '次/分' },
};

const TREND_NAMES = { rising: '总体上升', falling: '总体下降', stable: '总体平稳' };
const RISK_NAMES = {
  low: '相对较低', watch: '建议留意', high: '重点关注', evidence_limited: '资料不足',
  management: '已确诊，转入管理', lower_than_threshold: '相对较低', higher_than_threshold: '建议留意',
};

function cleanText(value, max = 220) {
  return localizeVisibleText(value)
    .replace(/\*\*/g, '')
    .replace(/高压（高压）/g, '高压')
    .replace(/低压（低压）/g, '低压')
    .replace(/现在[：:]\s*现在[：:]/g, '现在：')
    .replace(/今天[：:]\s*今天[：:]/g, '今天：')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function statusText(content) {
  const lines = String(content || '').split(/\n+/).map(line => cleanText(line)).filter(Boolean);
  const now = lines.find(line => /^现在[：:]/.test(line));
  const chosen = now || lines[0] || '已完成本次健康信息整理。';
  return cleanText(chosen.replace(/^(?:现在|当前结论)[：:]\s*/, ''), 150);
}

function trendForMetric(type, toolResults) {
  const trend = toolResults.find(item => item.name === 'health_trend' && item.status === 'success')?.result;
  const rows = trend?.metrics || [];
  if (type === 'bp') {
    const systo = rows.find(row => row.metric === 'systo');
    const diasto = rows.find(row => row.metric === 'diasto');
    if (systo && diasto && systo.long_term_trend !== diasto.long_term_trend) {
      return `高压${TREND_NAMES[systo.long_term_trend]?.replace('总体', '') || '暂不判断'}，低压${TREND_NAMES[diasto.long_term_trend]?.replace('总体', '') || '暂不判断'}`;
    }
    return TREND_NAMES[systo?.long_term_trend || diasto?.long_term_trend] || '暂不判断';
  }
  const toolMetric = { hr: 'pulse', glucose: 'glucose', weight: 'weight', sleep: 'sleep' }[type];
  const row = rows.find(item => item.metric === toolMetric);
  return TREND_NAMES[row?.long_term_trend] || '暂不判断';
}

function liveFacts(liveContext, toolResults) {
  const facts = [];
  for (const [type, row] of Object.entries(liveContext?.latest || {})) {
    const def = METRICS[type];
    if (!def || row?.value == null) continue;
    const isBp = type === 'bp' && row.value2 != null;
    const needsCondition = ['bp', 'glucose', 'hr'].includes(type);
    facts.push({
      label: def.label,
      value: isBp ? `${row.value}/${row.value2}` : String(row.value),
      unit: unitName(row.unit || def.unit),
      measured_at: row.recorded_at ? String(row.recorded_at).slice(0, 10) : null,
      context: row.measurement_condition || row.note || (needsCondition ? '测量条件未填写' : null),
      trend: trendForMetric(type, toolResults),
    });
  }
  return facts;
}

function toolFacts(toolResults) {
  const facts = [];
  const risk = toolResults.find(item => ['htn_risk', 'disease_risk'].includes(item.name) && item.status === 'success')?.result;
  if (risk) {
    const tier = risk.existing_diagnosis ? 'management' : risk.risk_tier || risk.risk_level;
    facts.push({ label: '模型估计的 · 筛查分层', value: RISK_NAMES[tier] || '证据有限', unit: '', measured_at: risk.evidence_freshness?.slice?.(0, 10) || null, context: '用于筛查，不是诊断', trend: null });
    const percent = risk.research_details?.risk_percent;
    if (Number.isFinite(Number(percent))) facts.push({ label: '模型估计的 · 筛查值', value: String(percent), unit: '%', measured_at: null, context: '仅在模型通过准入后展示', trend: null });
  }
  const alerts = toolResults.find(item => item.name === 'alerts' && item.status === 'success')?.result;
  if (alerts) {
    facts.push({ label: '待处理提醒', value: String(alerts.pending || 0), unit: '条', measured_at: null, context: alerts.critical ? `其中严重提醒 ${alerts.critical} 条` : '暂无严重提醒', trend: null });
  }
  const device = toolResults.find(item => item.name === 'device' && item.status === 'success')?.result;
  if (device) {
    facts.push({ label: '已连接设备', value: String(device.connected_count || 0), unit: '台', measured_at: null, context: device.sync_failures ? `同步异常 ${device.sync_failures} 台` : '同步状态正常', trend: null });
  }
  const followups = toolResults.find(item => item.name === 'followup_status' && item.status === 'success')?.result;
  if (followups) facts.push({ label: '待处理复测', value: String(followups.total || 0), unit: '项', measured_at: null, context: followups.pending_confirmation ? `其中 ${followups.pending_confirmation} 项需确认新测量` : '暂无待确认测量', trend: null });
  const proposal = toolResults.find(item => item.name === 'propose_intervention' && item.status === 'success')?.result;
  if (proposal) facts.push({ label: '待确认个体方案', value: proposal.proposal.duration, unit: '', measured_at: null,
    context: `观察${proposal.proposal.target_metric}；确认前不写入`, trend: null });
  const active = toolResults.find(item => item.name === 'list_active_interventions' && item.status === 'success')?.result;
  if (active) facts.push({ label: '活动干预', value: String(active.total || 0), unit: '项', measured_at: null, context: '正在进行或等待评价', trend: null });
  const evaluation = toolResults.find(item => item.name === 'evaluate_intervention' && item.status === 'success')?.result?.result;
  if (evaluation) facts.push({ label: evaluation.evidence_level === 'insufficient' ? '数据不足' : evaluation.evidence_level === 'descriptive_only' ? '描述性变化' : '个体证据',
    value: evaluation.absolute_change == null ? '不生成变化量' : String(evaluation.absolute_change), unit: evaluation.target_metric?.unit || '',
    measured_at: null, context: `证据等级：${evaluation.evidence_level}`, trend: null });
  return facts;
}

function linkedCurveFacts(response, toolResults) {
  const events = response?.prediction_snapshot?.events || [];
  const rows = toolResults.find(item => item.name === 'health_trend' && item.status === 'success')?.result?.metrics || [];
  const out = [];
  for (const event of events) {
    const row = rows.find(item => item.metric === event.metric) || {};
    const name = ({ systo: '高压（收缩压）', diasto: '低压（舒张压）', pulse: '心率', glucose: '血糖', weight: '体重', sleep: '睡眠' })[event.metric] || event.metric;
    out.push({ label: `已经测到的 · ${name}`, value: event.latest_value == null ? '暂无有效数值' : String(event.latest_value), unit: unitName(row.unit || ''), measured_at: null, context: '来自本次预测快照，模型不能修改', trend: TREND_NAMES[event.trend] || '暂不判断' });
    if (!event.forecast_available) {
      out.push({ label: `模型估计的 · ${name}`, value: '不提供未来数值', unit: '', measured_at: null, context: '当前预测不可用', trend: null });
    } else {
      const uncertain = /只能说.*不确定/.test(response.content || '');
      const lower = Math.min(...(event.forecast_interval?.lower || []));
      const upper = Math.max(...(event.forecast_interval?.upper || []));
      out.push({ label: `模型估计的 · ${name}`, value: uncertain ? '不确定' : `${lower}–${upper}`, unit: uncertain ? '' : unitName(row.unit || ''), measured_at: null, context: uncertain ? '区间较宽或数据覆盖未达标' : `未来 ${event.forecast_interval.horizon_days} 天估计范围，不是实测值`, trend: null });
    }
  }
  return out;
}

function toneFor(response, toolResults) {
  if (response?.source === 'safety_rule') return 'urgent';
  if (toolResults.some(item => item.status !== 'success')) return 'insufficient';
  const alerts = toolResults.find(item => item.name === 'alerts')?.result;
  if (alerts?.critical) return 'warning';
  const risk = toolResults.find(item => ['htn_risk', 'disease_risk'].includes(item.name))?.result;
  const tier = risk?.risk_tier || risk?.risk_level;
  if (['high', 'higher_than_threshold'].includes(tier)) return 'warning';
  if (['watch', 'management'].includes(tier)) return 'watch';
  const trends = toolResults.find(item => item.name === 'health_trend')?.result?.metrics || [];
  if (trends.some(row => row.status !== 'ok')) return 'insufficient';
  if (trends.some(row => row.long_term_trend === 'rising' || row.abnormal_spike)) return 'watch';
  return 'stable';
}

function defaultAction(intent, tone) {
  if (tone === 'urgent') return { title: '立即求助', description: '联系急救并让身边的人陪同，不要自行驾车。', action_type: 'contact_doctor', requires_confirmation: false };
  if (intent.deviceHit) return { title: '检查设备连接', description: '确认设备电量、蓝牙和最近同步时间。', action_type: null, requires_confirmation: false };
  if (intent.alertsHit || intent.healthSummaryHit) return { title: '先处理重要提醒', description: '优先查看严重项目，再继续规律记录。', action_type: null, requires_confirmation: false };
  if (intent.riskHit || intent.diseaseRiskHit) return { title: '完善筛查资料', description: '补齐缺失资料，持续规范复测，必要时咨询医生。', action_type: null, requires_confirmation: false };
  return { title: '继续规范记录', description: '固定时间和测量条件，保留连续记录。', action_type: null, requires_confirmation: false };
}

function presentationActions(plan, intent, tone, liveContext, strictEvidence = false) {
  const scheduleFields = item => {
    const metricType = item.metric_type || (intent.trendMetrics?.some(metric => ['systo','diasto'].includes(metric)) ? 'bp'
      : intent.trendMetrics?.includes('glucose') ? 'glucose' : intent.trendMetrics?.includes('pulse') ? 'hr'
      : intent.trendMetrics?.includes('weight') ? 'weight' : intent.trendMetrics?.includes('sleep') ? 'sleep' : null);
    return { metric_type: metricType, baseline_metric_id: item.baseline_metric_id || liveContext?.latest?.[metricType]?.id || null,
      schedule_options: [{ key: 'later_today', label: '今天稍后' }, { key: 'tomorrow_morning', label: '明早' }, { key: 'custom', label: '自选时间' }] };
  };
  const actions = (plan || []).slice(0, 2).map(item => ({
    title: cleanText(item.title, 80),
    description: cleanText(item.desc || item.description, 160),
    action_type: item.action_type || null,
    requires_confirmation: !!item.action_type,
    ...(item.action_type === 'schedule_recheck' ? scheduleFields(item) : {}),
    ...(item.action_type === 'n_of_1_intervention' ? { intervention_payload: item.intervention_payload, proposal_details: item.proposal_details } : {}),
    ...(item.action_type === 'record_adherence' ? { intervention_id: item.intervention_id, adherence_payload: item.adherence_payload } : {}),
  })).filter(item => item.title);
  if (!strictEvidence && intent.trendHit && !actions.some(item => item.action_type === 'schedule_recheck')) {
    actions.unshift({ title: '安排一次规范复测', description: '选择时间后先生成待确认预览，确认后才创建站内待办。', action_type: 'schedule_recheck', requires_confirmation: true, ...scheduleFields({}) });
  }
  if (actions.length) return actions.slice(0, 2);
  // 冻结证据链时仍需兑现“下一步”回答契约，但只给不写库、不触发敏感动作的建议。
  return [defaultAction(intent, tone)];
}

function safetyFor(tone, intent, response) {
  if (tone === 'urgent') return { level: 'urgent', text: cleanText(response?.content || '请立即联系急救，不要等待智能体分析。', 220) };
  if (tone === 'insufficient') return { level: 'caution', text: '资料不足时不要自行判断疾病或调整用药；出现明显不适请及时就医。' };
  if (intent.riskHit || intent.diseaseRiskHit) return { level: 'routine', text: '风险筛查不是诊断；若连续指标异常或出现明显不适，请咨询医生。' };
  if (intent.deviceHit) return { level: 'routine', text: '设备状态不能替代人工复测；身体不适时请先处理症状。' };
  return { level: 'routine', text: '若连续复测仍异常，或出现明显不适，请及时咨询医生。' };
}

export function buildAgentPresentation({ response, toolResults = [], liveContext = null, intent = {}, subject = {}, actor = {}, message = '' }) {
  const emergency = response?.source === 'safety_rule';
  const personalCard = emergency || intent.trendHit || intent.riskHit || intent.diseaseRiskHit || intent.healthSummaryHit
    || intent.behaviorHit || intent.deviceHit || intent.alertsHit || intent.actionHit || intent.followupHit || intent.interventionHit || !!liveContext;
  if (!personalCard) return { mode: 'plain' };
  const tone = toneFor(response, toolResults);
  const facts = emergency
    ? [{ label: '发现的情况', value: '您描述了需要立即处理的急症信号', unit: '', measured_at: null, context: null, trend: null }]
    : (response?.prediction_snapshot?.events?.length
      ? linkedCurveFacts(response, toolResults)
      : [...toolFacts(toolResults), ...liveFacts(liveContext, toolResults)]
    ).filter((item, index, rows) => rows.findIndex(old => old.label === item.label) === index).slice(0, 3);
  if (!facts.length) facts.push({ label: '关键数据', value: '暂无足够的规范记录', unit: '', measured_at: null, context: '请先补充记录', trend: null });
  const caregiver = actor?.id && subject?.id && Number(actor.id) !== Number(subject.id);
  return {
    mode: emergency ? 'emergency' : 'health_card',
    subject_name: caregiver ? cleanText(subject.name, 40) : null,
    status: { title: caregiver ? `${cleanText(subject.name, 30)}的当前结论` : '当前结论', text: statusText(response?.content), tone },
    facts,
    actions: presentationActions(emergency ? [] : response?.plan, intent, tone, liveContext, !!response?.linkage_version),
    safety: safetyFor(tone, intent, response),
  };
}

export function presentationGroundingText(presentation) {
  if (!presentation || presentation.mode === 'plain') return '';
  return [
    presentation.status?.text,
    ...(presentation.facts || []).flatMap(item => [item.value, item.unit, item.measured_at, item.context, item.trend]),
    ...(presentation.actions || []).flatMap(item => [item.title, item.description]),
    presentation.safety?.text,
  ].filter(Boolean).join(' ');
}
