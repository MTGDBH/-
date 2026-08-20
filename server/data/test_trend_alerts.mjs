// 主动趋势提醒回归：异常/明显趋势生成提醒，并验证 24 小时去重。
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const name = `趋势提醒回归${Date.now()}`;
async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text(); let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text}`);
  return { body, headers: res.headers };
}
const login = await request('/api/auth/register', {
  method: 'POST', body: JSON.stringify({ name, age: 79, gender: 'male', password: '123456' }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const auth = { Cookie: cookie };
try {
  const now = Date.now();
  for (let i = 0; i < 15; i += 1) {
    // 15 天的单调上升序列，足以触发明显趋势，但仍处于设备物理范围内。
    await request('/api/health/metrics', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ type: 'bp', value: 118 + i * 2, value2: 76 + Math.round(i * 0.4), unit: 'mmHg', source: 'manual', recorded_at: new Date(now - (14 - i) * 86400000).toISOString() }),
    });
  }
  // 异步分析不应阻塞保存，等待其完成后再检查提醒。
  await new Promise(resolve => setTimeout(resolve, 2500));
  const first = (await request('/api/alerts', { headers: auth })).body.items || [];
  const bpAlerts = first.filter(a => ['bp', 'systo', 'diasto'].includes(a.metric_type) || a.type === 'bp' || /血压|收缩压|舒张压/.test(a.title || a.message || ''));
  if (!bpAlerts.length) throw new Error(`expected a trend alert, got ${JSON.stringify(first)}`);
  const sameTitles = new Map();
  for (const alert of bpAlerts) sameTitles.set(alert.title || alert.message, (sameTitles.get(alert.title || alert.message) || 0) + 1);
  for (const count of sameTitles.values()) if (count > 1) throw new Error('duplicate alert within 24h');
  // 再次保存同指标后触发同一规则，数量不应无界增长。
  await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'bp', value: 150, value2: 84, unit: 'mmHg', source: 'manual' }) });
  await new Promise(resolve => setTimeout(resolve, 1200));
  const second = (await request('/api/alerts', { headers: auth })).body.items || [];
  if (second.length > first.length + 1) throw new Error('alert deduplication failed');
  console.log(JSON.stringify({ pass: true, total_alerts: second.length, bp_alerts: bpAlerts.length, dedup_checked: true }));
} finally {
  const deleted = await request('/api/profile/me', { method: 'DELETE', headers: auth });
  if (!deleted.body?.ok) throw new Error('trend alert test account cleanup failed');
}
