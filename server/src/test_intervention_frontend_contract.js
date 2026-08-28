import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../intervention.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../assets/css/styles.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../../assets/js/intervention.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../../assets/js/auth.js', import.meta.url), 'utf8');

new Function(js);
const sandbox = {
  window: {},
  document: { addEventListener() {} },
  console,
  setTimeout() {},
  URLSearchParams,
  encodeURIComponent,
};
vm.runInNewContext(js, sandbox);
const contract = sandbox.window.InterventionPageContract;
assert.ok(contract, 'frontend contract helpers must be exposed for deterministic tests');

// HTML 转义与长文本：卡片只能输出转义后的用户/接口内容。
const hostile = `<img src=x onerror=alert('x')>${'很长的计划说明'.repeat(80)}`;
assert.equal(contract.escapeHTML(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
const longCard = contract.planCard({
  intervention_id: 'intv-long', status: 'active', title: hostile,
  protocol: { action: hostile, frequency: '每天一次', safety: hostile },
  target_metrics: ['steps'], evidence_source_ids: [hostile],
  intervention_start: '2026-08-01T00:00:00Z', intervention_end: '2026-08-31T00:00:00Z',
  outcome_start: '2026-09-01T00:00:00Z', execution_logs: [],
});
assert.ok(!longCard.includes('<img src=x'), 'long dynamic content must not become HTML');
assert.ok(longCard.includes('&lt;img'), 'long dynamic content should remain readable as escaped text');
assert.match(css, /overflow-wrap:anywhere/);

// 空状态必须有可理解的标题与下一步提示。
for (const kind of ['pending', 'active', 'today', 'retest', 'completed', 'paused']) {
  const empty = contract.emptyHTML(kind);
  assert.match(empty, /intervention-empty/);
  assert.match(empty, /<strong>[^<]+<\/strong><p>[^<]+<\/p>/);
}

// 数据不足：不得显示伪精确百分比或伪效果结论。
const sparse = { execution_logs: [{ execution_log_id: 'one', performed: true }] };
assert.equal(contract.adherenceText(sparse), '数据积累中（已记录 1 次）');
assert.ok(!contract.adherenceText(sparse).includes('%'));
const insufficient = contract.resultCard({
  intervention_id: 'intv-sparse', status: 'completed', title: '稀疏数据计划', evidence_source_ids: [],
  evaluations: [{ result: { evidence_level: 'insufficient', baseline_summary: null, outcome_summary: null,
    relative_change: null, measurement_count: { baseline: 1, outcome: 0, total: 1 }, message: '数据不足' } }],
});
assert.match(insufficient, /未生成效果百分比/);
assert.ok(!insufficient.includes('%'));

// 六类闭环、完整结果契约、API 失败与权限不足文案。
for (const text of ['待确认计划', '进行中计划', '今日执行打卡', '待复测', '已完成效果', '数据不足或暂停计划']) assert.ok(html.includes(text), `${text} section missing`);
for (const text of ['干预内容', '目标指标', '执行周期', '今日任务', '依从率', '下次复测时间', '证据来源', '安全提示']) assert.ok(js.includes(text), `${text} field missing`);
for (const text of ['个人基线', '干预后结果', '变化幅度', '不确定区间', '数据量', '证据等级', '混杂因素']) assert.ok(js.includes(text), `${text} result field missing`);
for (const text of ['当前账号权限不足', '计划暂时无法读取', '重新加载', '仅可查看']) assert.ok(html.includes(text) || js.includes(text), `${text} error/permission state missing`);
assert.deepEqual({ ...contract.errorCopy(new Error('请求失败 (403)')) }, { title: '当前账号权限不足', message: '您没有查看该老人改善计划的授权，请让本人重新授权。' });
assert.deepEqual({ ...contract.errorCopy(new Error('网络连接不上，请稍后再试')) }, { title: '计划暂时无法读取', message: '网络连接不上，请稍后再试' });
for (const endpoint of ['/api/actions/interventions?subject_user_id=', '/evaluations', '/confirm', '/reject', '/executions', '/cancel']) assert.ok(js.includes(endpoint), `${endpoint} endpoint missing`);

// 敏感写操作二次确认：先开对话框，再勾选明确确认，按钮才可用。
assert.match(html, /<dialog[^>]+id="intervention-dialog"/);
assert.match(html, /id="dialog-confirm-check" type="checkbox"/);
assert.match(html, /id="dialog-confirm" disabled/);
for (const action of ['confirm', 'reject', 'checkin', 'backfill', 'cancel']) assert.ok(js.includes(`${action}: [`), `${action} confirmation copy missing`);

// 移动端与键盘：原生按钮/链接/表单控件、焦点样式、窄屏单列与减弱动画。
assert.match(css, /@media\(max-width:720px\)/);
assert.match(css, /\.intervention-grid\{grid-template-columns:1fr\}/);
assert.match(css, /button:focus-visible/);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
assert.ok((html.match(/<button\b/g) || []).length >= 4);
assert.match(html, /aria-live="polite"/);
assert.match(html, /aria-busy="true"/);
assert.match(auth, /intervention\.html/);
assert.match(fs.readFileSync(new URL('../../agent.html', import.meta.url), 'utf8'), /id="agent-intervention-link"/);

console.log('intervention frontend contract: PASS');
