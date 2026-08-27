export function validateCurveRequest(rawType, rawDays, knownMetric) {
  const type = String(rawType || '').trim().toLowerCase();
  if (!type || !knownMetric(type)) return { ok: false, status: 400, error: '未知指标类型' };
  const parsedDays = Number.parseInt(rawDays || '30', 10);
  const days = Math.max(7, Math.min(365, Number.isFinite(parsedDays) ? parsedDays : 30));
  return { ok: true, type, days };
}

