// 规则优先的意图路由：稳定、可测试，无法确定时仍交给 DeepSeek 做自然语言解释。
export function routeIntent(message = '') {
  const text = String(message).trim();
  const risk = /(高血压|血压).{0,10}(风险|预测|概率)|(风险|预测|概率).{0,10}(高血压|血压)/.test(text);
  const diseaseRisk = /(糖尿病|心脏病|心血管|脑卒中|中风).{0,12}(风险|概率|预测)|(风险|概率|预测).{0,12}(糖尿病|心脏病|心血管|脑卒中|中风)/.test(text);
  const trend = /最近|趋势|走势|变化|上升|下降|波动|越来越高|越来越低/.test(text);
  const behavior = /步数|走得少|活动量|运动量|睡眠|睡得/.test(text);
  const device = /设备|蓝牙|同步|电量|连接/.test(text);
  const alerts = /提醒|预警|异常值|异常记录|待处理/.test(text);
  const healthSummary = /总体|整体|身体怎么样|健康情况|健康状况|最近身体|各项指标/.test(text);
  const knowledge = /为什么|怎么办|注意|危险|饮食|复测|正常范围|是什么/.test(text);
  const action = /帮我|安排|提醒|待办|复测|通知家属/.test(text);
  return { type: risk ? 'risk_query' : diseaseRisk ? 'disease_risk_query' : healthSummary ? 'health_summary' : device ? 'device_query' : alerts ? 'alert_query' : behavior ? 'behavior_query' : trend ? 'trend_query' : knowledge ? 'knowledge_query' : action ? 'plan_request' : 'common_health_question', risk, diseaseRisk, healthSummary, trend, behavior, device, alerts, knowledge, action };
}
