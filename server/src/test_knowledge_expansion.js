import assert from 'node:assert/strict';
import fs from 'node:fs';
import { expandedKnowledgeArticles } from './lib/knowledgeExpansion.js';

assert.ok(expandedKnowledgeArticles.length >= 20, '扩展知识文章不足');
assert.ok(expandedKnowledgeArticles.every(row => row.review_status === 'pending'), '新内容必须默认待审核');
assert.ok(expandedKnowledgeArticles.every(row => /^https:\/\//.test(row.source_url)), '新内容必须有可追溯来源');
const medicationArticles = expandedKnowledgeArticles.filter(row => /药物复核|多种药/.test(row.title));
assert.ok(medicationArticles.length && medicationArticles.every(row => row.body.includes('不要') && row.body.includes('自行')), '用药文章缺少禁止自行调整边界');
const titles = new Set(expandedKnowledgeArticles.map(row => row.title));
assert.equal(titles.size, expandedKnowledgeArticles.length, '文章标题重复');

const html = fs.readFileSync(new URL('../../knowledge.html', import.meta.url), 'utf8');
for (const text of ['研究预览', '已审核', '图谱关联发现', '测试版研究预览', '不代表直接因果', '联网查研究', '外部资料 · 尚未审核', '不发送姓名、健康档案或测量数据']) assert.ok(html.includes(text), `页面缺少：${text}`);

console.log(`knowledge expansion: PASS (${expandedKnowledgeArticles.length} articles)`);
