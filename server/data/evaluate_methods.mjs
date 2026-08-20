// 模板 vs GraphRAG vs DeepSeek/工具链对照评估（演示研究用，不等同临床疗效）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const name = `方法对照${Date.now()}`;
async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text}`);
  return { body, headers: res.headers };
}
function templateReply(profile) {
  return profile === 'high_bp' ? '注意血压，规律作息，适量运动。' : '保持健康生活方式，定期记录指标。';
}
const login = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, age: 78, gender: 'female', password: '123456' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]; const auth = { Cookie: cookie };
const scenarios = [
  { id: 'high_bp', metric: { type: 'bp', value: 155, value2: 96, unit: 'mmHg' }, question: '最近血压偏高怎么办？', disease: 'hypertension' },
  { id: 'normal_bp', metric: { type: 'bp', value: 124, value2: 78, unit: 'mmHg' }, question: '最近血压偏高怎么办？', disease: 'hypertension' },
  { id: 'low_egfr', metric: { type: 'egfr', value: 54, unit: 'mL/min/1.73m²' }, question: '肾功能和血压有什么关系？', disease: 'chronic_kidney_disease' },
];
try {
  const rows = [];
  for (const scenario of scenarios) {
    await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ ...scenario.metric, source: 'synthetic' }) });
    const graph = (await request(`/api/knowledge/graph/query?q=${encodeURIComponent(scenario.question)}&disease=${scenario.disease}&audience=doctor`, { headers: auth })).body;
    const chat = (await request('/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: scenario.question }) })).body;
    rows.push({
      scenario: scenario.id,
      template: templateReply(scenario.id === 'high_bp'),
      graph_action: graph.recommendations?.[0]?.action || null,
      graph_priority: graph.recommendations?.[0]?.priority || null,
      graph_citations: graph.citations?.length || 0,
      graph_paths: graph.graph_paths?.length || 0,
      agent_source: chat.source,
      agent_content: chat.content,
      agent_has_evidence: Boolean(chat.evidence?.graph || chat.evidence?.items?.length),
    });
  }
  const actions = rows.map(x => x.graph_action).filter(Boolean);
  const report = { generated_at: new Date().toISOString(), cases: rows.length, rows, graph_context_change_rate: actions.length > 1 ? new Set(actions).size / actions.length : 0, conclusion: 'GraphRAG输出必须结合用户上下文、引用和关系路径；模板只能作为基线。' };
  const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../reports/graph-method-comparison-2026-08-20.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ ...report, report_file: output }, null, 2));
} finally {
  await request('/api/profile/me', { method: 'DELETE', headers: auth });
}
