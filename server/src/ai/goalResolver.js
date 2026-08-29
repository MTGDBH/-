export function resolveGoal(message, intent = {}, prior = {}) {
  const text = String(message || '').trim();
  let goal = '回答一般健康管理问题';
  if (intent.trendHit) goal = '查看并解释健康指标趋势';
  else if (intent.riskHit || intent.diseaseRiskHit) goal = '查看风险筛查结果及局限';
  else if (intent.followupHit) goal = '跟踪复测计划和结果';
  else if (intent.proposeInterventionHit) goal = '制定待确认的非药物个体观察方案';
  else if (intent.deviceHit) goal = '排查设备同步问题并验证新数据';
  else if (intent.actionHit) goal = '生成待用户确认的健康行动预览';
  else if (intent.healthSummaryHit || intent.dailyPlanHit) goal = '整理当前健康状态和下一步';
  const missing = [];
  if (intent.trendHit && !(intent.trendMetrics || []).length) missing.push('metric');
  if (intent.proposeInterventionHit && !/(血压|血糖|心率|体重|睡眠)/.test(text)) missing.push('target_metric');
  return {
    goal,
    clear: missing.length === 0,
    missing,
    current_metric: (intent.trendMetrics || prior.metrics || [])[0] || null,
    time_range_days: intent.days || prior.days || 90,
    success_criteria: intent.actionHit || intent.proposeInterventionHit ? '用户看到完整确认卡，未确认前不写入' : '结论与工具证据、单位、日期和健康对象一致',
  };
}

export function taskStateFor(response, goal) {
  const waiting = (response.presentation?.mode === 'clarification') || goal.clear === false;
  const confirmation = (response.plan || []).some(item => item.requires_confirmation);
  const failed = (response.tool_trace || []).some(item => item.status === 'error');
  const status = waiting ? 'waiting_user' : confirmation ? 'waiting_confirmation' : failed ? 'needs_followup' : 'completed';
  return {
    goal: goal.goal,
    status,
    next_step: waiting ? '补充一个关键选项' : confirmation ? '核对确认卡后由本人确认' : failed ? '稍后重试失败工具或补充数据' : '按回答中的复测或观察边界继续跟踪',
    success_criteria: goal.success_criteria,
  };
}
