import assert from 'node:assert/strict';
import { parseChineseNumber, parseHealthDescription } from './lib/healthTextParser.js';

assert.equal(parseChineseNumber('一百二十八'), 128);
assert.equal(parseChineseNumber('一百三'), 130);
assert.equal(parseChineseNumber('七个半'), 7.5);
assert.equal(parseChineseNumber('7个半'), 7.5);
assert.equal(parseChineseNumber('五点八'), 5.8);

const result = parseHealthDescription('我早上静坐后量血压128/85，空腹血糖5.8，静息心率72，血氧97%，体重56.2公斤，昨晚睡了七个半小时，今天走了4820步，体温36.5度，呼吸频率18次。');
const byType = Object.fromEntries(result.records.map(record => [record.type, record]));
assert.deepEqual([byType.bp.value, byType.bp.value2], [128, 85]);
assert.equal(byType.bp.measurement_condition, 'morning_rest');
assert.equal(byType.glucose.value, 5.8);
assert.equal(byType.glucose.measurement_condition, 'fasting');
assert.equal(byType.hr.value, 72);
assert.equal(byType.hr.measurement_condition, 'resting');
assert.equal(byType.spo2.value, 97);
assert.equal(byType.weight.value, 56.2);
assert.equal(byType.sleep.value, 7.5);
assert.equal(byType.steps.value, 4820);
assert.equal(byType.temp.value, 36.5);
assert.equal(byType.resp.value, 18);
assert.equal(result.records.length, 9);

const incomplete = parseHealthDescription('今天血压有点高，高压145。');
assert.equal(incomplete.records.length, 0);
assert.match(incomplete.warnings.join(''), /同时包含高压和低压/);

const fused = parseHealthDescription('血压是一百三，，，血压是一百三八十五。');
assert.deepEqual([fused.records[0].value, fused.records[0].value2], [130, 85]);
assert.equal(fused.records[0].parse_mode, 'spoken_fused');

const repeated = parseHealthDescription('血压是一百三，血压是八十五。');
assert.deepEqual([repeated.records[0].value, repeated.records[0].value2], [130, 85]);

const spaced = parseHealthDescription('今天测的血压 130 85，心率七十二。');
assert.deepEqual([spaced.records[0].value, spaced.records[0].value2], [130, 85]);

console.log('health text parser: PASS');
