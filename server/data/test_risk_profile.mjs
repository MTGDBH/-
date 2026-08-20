// 风险资料闭环测试：保存档案后，模型输入完整度应提升；结束时恢复演示账号原值。
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const account = '\u7cfb\u7edf\u6d4b\u8bd5\u8001\u4eba40';
async function req(path, options = {}) {
  const r = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await r.text();
  const body = JSON.parse(text);
  if (!r.ok) throw new Error(`${r.status}: ${body.error || text}`);
  return { body, headers: r.headers };
}
const login = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: account, password: '123456' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const auth = { Cookie: cookie };
const before = (await req('/api/profile/me', { headers: auth })).body;
const fields = ['education_level', 'smoking_status', 'cigarettes_per_day', 'drinking_status', 'drinking_frequency', 'exercise_level', 'self_rated_health', 'chronic_diabetes', 'chronic_heart', 'chronic_stroke', 'dyslipidemia', 'lung_disease'];
const snapshot = Object.fromEntries(fields.map(k => [k, before[k] ?? null]));
try {
  await req('/api/profile/me', { method: 'PUT', headers: auth, body: JSON.stringify({ education_level: 4, smoking_status: 0, cigarettes_per_day: 0, drinking_status: 0, drinking_frequency: 0, exercise_level: 120, self_rated_health: 4, chronic_diabetes: 0, chronic_heart: 0, chronic_stroke: 0, dyslipidemia: 0, lung_disease: 0 }) });
  const risk = (await req('/api/prediction/disease/hypertension', { headers: auth })).body;
  if (!risk.success || risk.data_completeness?.missing_count >= 21 || risk.data_completeness?.level === 'low') throw new Error('risk completeness did not improve');
  console.log(JSON.stringify({ pass: true, before_missing: 21, after_missing: risk.data_completeness.missing_count, completeness: risk.data_completeness.ratio }));
} finally {
  await req('/api/profile/me', { method: 'PUT', headers: auth, body: JSON.stringify(snapshot) });
}
