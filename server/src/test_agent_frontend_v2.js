import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../agent.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../assets/css/styles.css', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'agent inline script is required');
new Function(script);

for (const text of ['选择老人', '新对话', '已记住的信息', '要记住这件事吗', '读取依据']) assert.match(html, new RegExp(text));
for (const text of ['当前结论', '关键数据', '下一步行动', '需要帮助时', '查看依据']) assert.match(html, new RegExp(text));
for (const text of ['待处理健康事项', '今天稍后', '明早', '自选时间', '是本次复测', '哪里需要改进']) assert.match(html, new RegExp(text));
for (const text of ['看看我的总体健康', '看看最近血压', '生成今日健康方案', '我想问一个健康问题', '今日健康贴士']) assert.ok(html.includes(text), `${text} 单入口内容缺失`);
assert.ok(!html.includes('id="mode-tabs"'), '三模式标签应彻底移除');
assert.ok(!html.includes('data-tab="plan"') && !html.includes('data-tab="qa"') && !html.includes('data-tab="tip"'), '不应保留模式切换按钮');
assert.ok(html.includes('/api/agent/daily-tip?subject_user_id='), '每日贴士接口未接入');
for (const text of ['高压（收缩压）', '低压（舒张压）', '毫米汞柱', '毫摩尔/升', '健康智能分析']) assert.ok(html.includes(text), `${text} 中文展示映射缺失`);
assert.ok(!html.includes("' · ' + llmMeta.model"), '老人端不应显示英文模型名称');
assert.ok(!html.includes('把上面的建议设为今日提醒'), '重复的今日提醒提示应移除');
for (const endpoint of ['/api/chat/conversations', '/api/agent/memories', '/api/actions/', '/regenerate']) assert.ok(html.includes(endpoint), `${endpoint} missing`);
for (const field of ['conversation_id', 'subject_user_id', 'client_request_id']) assert.match(html, new RegExp(field));
assert.match(html, /idempotency_key/);
assert.match(html, /\/cancel/);
assert.match(css, /\.agent-context-bar/);
assert.match(css, /\.agent-memory-candidate/);
assert.match(css, /\.agent-action-preview-controls/);
assert.match(css, /\.agent-health-card/);
assert.match(css, /\.agent-health-card\.tone-urgent/);
assert.match(css, /\.agent-inbox/);
assert.match(css, /\.agent-schedule-picker/);
assert.match(css, /\.agent-clarification-card/);
assert.match(css, /\.agent-facts\{[^}]*grid-template-columns:repeat\(3/);
assert.match(css, /font-size:18px/);
assert.match(css, /min-height:\s*48px/);

console.log('agent v2 frontend static acceptance: PASS');
