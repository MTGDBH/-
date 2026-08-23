import assert from 'node:assert/strict';
import { localizeVisibleText, metricName, unitName } from './ai/elderlyLanguage.js';

assert.equal(metricName('systo'), '高压（收缩压）');
assert.equal(metricName('diasto'), '低压（舒张压）');
assert.equal(unitName('mmHg'), '毫米汞柱');
assert.equal(unitName('mmol/L'), '毫摩尔/升');
assert.equal(unitName('bpm'), '次/分');
assert.equal(unitName('kg'), '千克');

const output = localizeVisibleText('systo 128 mmHg，diasto 85 mmHg，pulse 72 bpm，weight 61 kg');
assert.doesNotMatch(output, /systo|diasto|pulse|mmHg|bpm|\bkg\b/i);
assert.match(output, /高压（收缩压） 128 毫米汞柱/);
assert.match(output, /低压（舒张压） 85 毫米汞柱/);
assert.match(output, /心率 72 次\/分/);
assert.match(output, /体重 61 千克/);

console.log('agent elderly Chinese output guard: PASS');
