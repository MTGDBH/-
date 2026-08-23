import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../agent.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../assets/css/styles.css', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'agent inline script is required');
new Function(script);

for (const text of ['选择老人', '新对话', '已记住的信息', '要记住这件事吗', '读取依据']) assert.match(html, new RegExp(text));
for (const text of ['当前结论', '关键数据', '下一步行动', '需要帮助时', '查看依据']) assert.match(html, new RegExp(text));
for (const endpoint of ['/api/chat/conversations', '/api/agent/memories', '/api/actions/', '/regenerate']) assert.ok(html.includes(endpoint), `${endpoint} missing`);
for (const field of ['conversation_id', 'subject_user_id', 'client_request_id']) assert.match(html, new RegExp(field));
assert.match(html, /idempotency_key/);
assert.match(html, /\/cancel/);
assert.match(css, /\.agent-context-bar/);
assert.match(css, /\.agent-memory-candidate/);
assert.match(css, /\.agent-action-preview-controls/);
assert.match(css, /\.agent-health-card/);
assert.match(css, /\.agent-health-card\.tone-urgent/);
assert.match(css, /\.agent-facts\{[^}]*grid-template-columns:repeat\(3/);
assert.match(css, /font-size:18px/);
assert.match(css, /min-height:\s*48px/);

console.log('agent v2 frontend static acceptance: PASS');
