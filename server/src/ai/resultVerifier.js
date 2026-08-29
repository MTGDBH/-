const MEDICAL_BOUNDARY = /(?:确诊|诊断为|你得了|开始服用|停止服用|停药|换药|更换药物|增加剂量|减少剂量|加量|减量|每天服用\s*\d)/i;
const FALSE_WRITE_SUCCESS = /(?:已经|已)(?:创建|安排|保存|写入|通知|联系)(?:待办|复测|记录|家属|医生)?/;
const UNITS = /(?:mmHg|mmol\/L|bpm|kg|μmol\/L|mL\/min\/1\.73m²|mg\/g|%)/gi;

function tokens(value, pattern) { return String(value || '').match(pattern) || []; }
function stableText(value) { try { return JSON.stringify(value); } catch { return ''; } }

export function verifyAgentResult({ response, toolResults = [], liveContext = null, actor, subject }) {
  const errors = [];
  const evidenceText = stableText({ liveContext, toolResults: toolResults.map(row => row.result) });
  const content = String(response?.content || '');
  if (MEDICAL_BOUNDARY.test(content)) errors.push('MEDICAL_BOUNDARY_VIOLATION');
  if (actor?.id == null || subject?.id == null) errors.push('IDENTITY_MISSING');
  const claimedUnits = [...new Set(tokens(content, UNITS).map(x => x.toLowerCase()))];
  const evidenceUnits = new Set(tokens(evidenceText, UNITS).map(x => x.toLowerCase()));
  if (response?.confidence?.type === 'data' && claimedUnits.some(unit => !evidenceUnits.has(unit))) errors.push('UNIT_NOT_GROUNDED');
  const successfulWrites = toolResults.some(row => row.status === 'success' && /record|create|schedule|confirm/i.test(row.name));
  const confirmationOnly = (response?.plan || []).some(row => row.requires_confirmation);
  if (FALSE_WRITE_SUCCESS.test(content) && !successfulWrites && !confirmationOnly) errors.push('WRITE_SUCCESS_NOT_PROVEN');
  if ((response?.plan || []).some(row => row.action_type && row.requires_confirmation !== true && !['contact_doctor'].includes(row.action_type))) errors.push('WRITE_CONFIRMATION_MISSING');
  for (const row of toolResults) {
    if (row.status === 'success' && row.manifest?.success === false) errors.push('TOOL_STATUS_CONFLICT');
    const metrics = row.result?.metrics || [];
    for (const metric of metrics) {
      const lastActual = metric.data_freshness || row.result?.data_freshness;
      for (const point of metric.forecast?.curve?.points || []) {
        if (lastActual && point.date && new Date(point.date) <= new Date(lastActual)) errors.push('FORECAST_DATE_NOT_FUTURE');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
