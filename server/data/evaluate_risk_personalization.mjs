// 多疾病风险个性化评估：同一模型在不同真实账户数据上的输出对照。
// 运行：Node 22 server/data/evaluate_risk_personalization.mjs
import fs from 'node:fs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3001';
const cases = [
  { id: 1, profile: 'stable' },
  { id: 11, profile: 'hypertension' },
  { id: 19, profile: 'diabetes' },
  { id: 27, profile: 'mixed' },
  { id: 33, profile: 'sparse' },
  { id: 37, profile: 'recovery' },
];
const diseases = ['hypertension', 'diabetes', 'heart_disease', 'stroke'];

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text.slice(0, 200)}`);
  return { body, headers: res.headers };
}

function cookieFrom(headers) { return (headers.get('set-cookie') || '').split(';')[0]; }
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }

const rows = [];
const failures = [];
for (const c of cases) {
  const account = `系统测试老人${String(c.id).padStart(2, '0')}`;
  const login = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: account, password: '123456' }) });
  const cookie = cookieFrom(login.headers);
  for (const disease of diseases) {
    try {
      const result = (await jsonFetch(`/api/prediction/disease/${disease}`, { headers: { Cookie: cookie } })).body;
      const p = Number(result.risk_probability);
      const missing = Array.isArray(result.missing_features) ? result.missing_features : [];
      const sources = Array.isArray(result.data_sources) ? result.data_sources : [];
      const completeness = result.data_completeness || {};
      const row = {
        profile: c.profile,
        account,
        disease,
        success: result.success === true,
        risk_probability: Number.isFinite(p) ? p : null,
        risk_percent: result.risk_percent ?? null,
        risk_level: result.risk_level ?? null,
        confidence: result.confidence ?? null,
        missing_count: missing.length,
        missing_features: missing,
        data_source_count: sources.length,
        data_sources: sources.slice(0, 8),
        model: result.model ?? null,
        horizon_years: result.horizon_years ?? null,
        disclaimer: result.disclaimer ?? null,
        data_completeness: completeness,
      };
      rows.push(row);
      if (!row.success || row.risk_probability == null || row.risk_probability < 0 || row.risk_probability > 1) failures.push(`${account}/${disease}: 概率不在 [0,1]`);
      if (row.risk_percent != null && Math.abs(Number(row.risk_percent) - row.risk_probability * 100) > 0.02) failures.push(`${account}/${disease}: percent 与 probability 不一致`);
      if (row.horizon_years !== 2 || !row.disclaimer || !row.model) failures.push(`${account}/${disease}: 缺少风险模型元数据或免责声明`);
      if (!row.data_source_count) failures.push(`${account}/${disease}: 缺少实际数据来源`);
      if ((row.missing_count >= 5) !== (row.confidence === 'low')) failures.push(`${account}/${disease}: 缺失字段与可信度不一致`);
      if (completeness.missing_count !== missing.length || completeness.total_features !== missing.length + completeness.available_features || !Array.isArray(completeness.next_steps)) failures.push(`${account}/${disease}: 数据完整度契约不一致`);
    } catch (err) {
      failures.push(`${account}/${disease}: 请求失败 ${err.message}`);
    }
  }
}

const byDisease = Object.fromEntries(diseases.map(disease => {
  const values = rows.filter(r => r.disease === disease).map(r => r.risk_probability).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  return [disease, { n: values.length, min, max, mean: mean(values), range: min == null ? null : +(max - min).toFixed(4), personalized_variation: values.length > 1 && max > min }];
}));

for (const disease of diseases) {
  if (!byDisease[disease].personalized_variation) failures.push(`${disease}: 不同画像风险没有可见变化`);
}

const out = { generated_at: new Date().toISOString(), base_url: BASE, cases, diseases, rows, by_disease: byDisease, checks: { rows: rows.length, failed: failures.length, passed: failures.length === 0 }, failures, limitations: ['风险输出是队列筛查概率，不是个体诊断。', '演示账户为合成/演示数据，需独立真实队列验证后才能用于正式科研结论。'] };
fs.writeFileSync(new URL('../../reports/risk-personalization-raw-2026-08-20.json', import.meta.url), JSON.stringify(out, null, 2), 'utf8');

const lines = [
  '# 多疾病风险个性化评估（2026-08-20）', '',
  `- 结果：${out.checks.passed ? 'PASS' : 'FAIL'}`,
  `- 账号：${cases.length}；疾病：${diseases.length}；有效评估行：${rows.length}`,
  '- 目标：验证不同账户数据是否产生不同风险概率，并检查概率、元数据、来源和可信度契约。', '',
  '## 按疾病汇总', '',
  '| 疾病 | 样本数 | 最低概率 | 最高概率 | 均值 | 范围 | 是否因人变化 |',
  '|---|---:|---:|---:|---:|---:|---|',
];
for (const disease of diseases) {
  const x = byDisease[disease];
  lines.push(`| ${disease} | ${x.n} | ${x.min == null ? '—' : (x.min * 100).toFixed(2) + '%'} | ${x.max == null ? '—' : (x.max * 100).toFixed(2) + '%'} | ${x.mean == null ? '—' : (x.mean * 100).toFixed(2) + '%'} | ${x.range == null ? '—' : (x.range * 100).toFixed(2) + 'pp'} | ${x.personalized_variation ? '是' : '否'} |`);
}
lines.push('', '## 账户明细', '', '| 画像 | 疾病 | 风险 | 等级 | 可信度 | 缺失字段数 | 数据来源数 |', '|---|---|---:|---|---|---:|---:|');
for (const r of rows) lines.push(`| ${r.profile} | ${r.disease} | ${r.risk_probability == null ? '—' : (r.risk_probability * 100).toFixed(2) + '%'} | ${r.risk_level || '—'} | ${r.confidence || '—'} | ${r.missing_count} | ${r.data_source_count} |`);
lines.push('', '## 失败项', '', ...(failures.length ? failures.map(x => `- ${x}`) : ['- 无']), '', '## 限制', '', ...out.limitations.map(x => `- ${x}`));
fs.writeFileSync(new URL('../../reports/risk-personalization-evaluation-2026-08-20.md', import.meta.url), `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify(out, null, 2));
if (failures.length) process.exitCode = 1;
