import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../prediction.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../assets/css/styles.css', import.meta.url), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/)?.[1];
assert.ok(script, 'inline prediction script is required');
new Function(script);
assert.match(html, /CHARLS 长期人群估计/);
assert.match(html, /研究用途 · 非临床诊断 · 不能替代直接测量或规范化验/);
assert.match(html, /异常风险概率/);
assert.match(html, /RESEARCH_METRICS\.has\(m\.type\)/, 'unsupported metrics must not call population API');
assert.match(html, /data-retry-population/);
assert.match(css, /\.pred-research-card/);
assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.pred-research-bp/);
assert.doesNotMatch(html, /预测化验值/);
console.log('prediction research preview static acceptance: PASS');
