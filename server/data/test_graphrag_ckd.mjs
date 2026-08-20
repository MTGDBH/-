// CKD GraphRAG 合同测试：新指标可入库，关系路径、证据版本和聊天历史可追溯。
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const name = `CKD图谱回归${Date.now()}`;
async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text}`);
  return { body, headers: res.headers };
}
const login = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, age: 79, gender: 'female', password: '123456' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]; const auth = { Cookie: cookie };
try {
  for (const metric of [
    { type: 'bp', value: 148, value2: 92, unit: 'mmHg' },
    { type: 'egfr', value: 54, unit: 'mL/min/1.73m²' },
    { type: 'creatinine', value: 126, unit: 'μmol/L' },
  ]) await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ ...metric, source: 'manual' }) });
  const graph = (await request('/api/knowledge/graph/query?q=肾功能和血压有什么关系？&disease=chronic_kidney_disease&audience=doctor', { headers: auth })).body;
  if (graph.graph_mode !== 'local_hybrid' || !graph.index_version || !graph.graph_paths?.length) throw new Error('graph contract missing paths/version');
  if (!graph.citations?.some(x => x.publisher === 'KDIGO')) throw new Error('KDIGO citation missing');
  if (!graph.personalization?.matched_factors?.includes('recent_bp')) throw new Error('personalization context missing');
  const chat = (await request('/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: '肾功能和血压有什么关系？' }) })).body;
  if (!chat.evidence?.graph?.index_version || !chat.evidence.graph.citations?.length || !chat.evidence.graph.weekly_plan?.length) throw new Error('chat graph evidence not persisted');
  const history = (await request('/api/chat/history', { headers: auth })).body;
  if (!history.some(row => row.graph_evidence?.index_version && row.graph_evidence?.weekly_plan?.length)) throw new Error('graph evidence history missing');
  console.log(JSON.stringify({ pass: true, graph_mode: graph.graph_mode, index_version: graph.index_version, paths: graph.graph_paths.length, citations: graph.citations.length, chat_graph_persisted: true }));
} finally {
  const deleted = await request('/api/profile/me', { method: 'DELETE', headers: auth });
  if (!deleted.body?.ok) throw new Error('CKD GraphRAG test account cleanup failed');
}
