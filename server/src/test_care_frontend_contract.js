import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../care.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../assets/css/styles.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../../assets/js/care.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../../assets/js/auth.js', import.meta.url), 'utf8');
new Function(js);

assert.match(js, /replace\(\/\[&<>"'\]\/g/);
assert.ok((js.match(/escapeHTML\(/g) || []).length >= 35, 'dynamic care data must be escaped consistently');
const hostile = `<img src=x onerror=alert(1)>${'超长审核意见'.repeat(200)}`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
assert.ok(!escape(hostile).includes('<img'));
assert.match(css, /overflow-wrap:anywhere/);

for (const text of ['还没有授权关系', '暂无有效照护授权', '暂无逾期复测', '暂无待审核关系', '暂无活跃干预计划']) assert.ok(js.includes(text), `${text} empty state missing`);
for (const text of ['照护协同暂时无法读取', '重新加载', '每次访问都重新核验授权', '未授权字段不会下发']) assert.ok(html.includes(text) || js.includes(text), `${text} error/security state missing`);
assert.match(js, /capabilities\?\.\[scope\]/);
assert.ok(!/location\.search|URLSearchParams/.test(js), 'dashboard must not trust subject_id from URL');

for (const scope of ['view_summary','view_alerts','view_retest','view_interventions','view_adherence','record_intake','remind_execution','view_trends','view_clinical_evidence','review_graphrag','review_interventions']) assert.ok(js.includes(scope), `${scope} capability missing`);
for (const endpoint of ['/api/care/subjects','/api/care/invitations','/api/care/accept','/api/prediction/intakes','/reminders','/clinical-evidence','/graphrag/reviews','/interventions/']) assert.ok(js.includes(endpoint), `${endpoint} API missing`);

assert.match(html, /<dialog[^>]+id="care-confirm-dialog"/);
assert.match(html, /id="care-confirm-check" type="checkbox"/);
assert.match(html, /id="entry-confirm" type="checkbox"/);
assert.match(js, /确认撤回授权/);
assert.match(js, /确认发送执行提醒/);
assert.match(js, /确认接受照护授权/);
assert.match(js, /elements\.confirmed/);

assert.match(css, /@media\(max-width:640px\)/);
assert.match(css, /\.care-card-actions\{display:grid;grid-template-columns:1fr\}/);
assert.match(css, /\.care-scope-option:focus-within/);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
assert.ok((html.match(/<button\b/g) || []).length >= 8);
assert.match(html, /aria-live="polite"/);
assert.match(html, /<dialog/);
assert.match(auth, /care\.html/);

console.log('care frontend contract: PASS');
