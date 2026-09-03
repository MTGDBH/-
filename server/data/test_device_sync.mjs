// 设备闭环回归：添加设备 → 同步测量 → metrics 入库 → 智能体可读取设备状态。
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const name = `\u8bbe\u5907\u56de\u5f52\u6d4b\u8bd5${Date.now()}`;
async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text}`);
  return { body, headers: res.headers };
}
const login = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, age: 74, gender: 'female', password: '123456' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]; const auth = { Cookie: cookie };
try {
  const device = (await request('/api/devices', { method: 'POST', headers: auth, body: JSON.stringify({ name: '回归血压计', kind: 'blood_pressure', battery_level: 88, bluetooth_id: 'integration-ble-device-1' }) })).body;
  const reconnected = (await request('/api/devices', { method: 'POST', headers: auth, body: JSON.stringify({ name: '回归血压计', kind: 'blood_pressure', battery_level: 87, bluetooth_id: 'integration-ble-device-1' }) })).body;
  if (reconnected.id !== device.id || reconnected.battery_level !== 87) throw new Error('bluetooth device reconnect should update instead of duplicating');
  const synced = await request(`/api/devices/${device.id}/sync`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'bp', value: 132, value2: 82, unit: 'mmHg', battery_level: 86 }) });
  if (synced.body.metric?.source !== 'device' || synced.body.metric?.device_id !== device.id) throw new Error('device metric not persisted');
  const list = (await request('/api/devices', { headers: auth })).body;
  if (!list.some(x => x.id === device.id && x.status === 'connected' && x.battery_level === 86)) throw new Error('device state not updated');
  const bad = await request(`/api/devices/${device.id}/sync`, { method: 'POST', headers: auth, body: JSON.stringify({ type: 'bp', value: 999, value2: 80, unit: 'mmHg' }) }).catch(e => ({ body: { error: e.message } }));
  const afterBad = (await request('/api/devices', { headers: auth })).body.find(x => x.id === device.id);
  if (!String(bad.body.error).includes('physical range') || afterBad?.status !== 'error' || !afterBad?.sync_error) throw new Error('device failure state was not recorded');
  const chat = (await request('/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: '\u84dd\u7259\u8bbe\u5907\u540c\u6b65\u600e\u4e48\u6837\uff1f' }) })).body;
  if (!chat.content || !['deepseek', 'openai', 'custom', 'tool', 'tool_fallback', 'mock'].includes(chat.source)) throw new Error('device agent response unavailable');
  console.log(JSON.stringify({ pass: true, metric_source: synced.body.metric.source, battery: synced.body.device.battery_level, agent_source: chat.source }));
} finally {
  // 集成测试使用一次性临时数据库；生产注销必须经过隐私中心二次确认，
  // 因此这里不再调用已禁用的一步删除接口。
}
