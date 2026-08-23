import assert from 'node:assert/strict';
import {
  CURVE_DISPLAY_METRICS,
  peerReferenceFor,
  referenceFor,
  transformCurve,
} from './routes/prediction.js';

assert.equal(CURVE_DISPLAY_METRICS.length, 11);
assert.deepEqual(CURVE_DISPLAY_METRICS.map(x => x.type), [
  'bp', 'glucose', 'hr', 'weight', 'sleep', 'steps', 'spo2', 'temp', 'resp', 'bmi', 'pulse_pressure',
]);
assert.ok(!CURVE_DISPLAY_METRICS.some(x => ['waist', 'grip', 'bodyfat', 'hba1c'].includes(x.type)));

const maleBp = peerReferenceFor('bp', { age: 66, gender: 'male' });
assert.equal(maleBp.status, 'available');
assert.equal(maleBp.age_group, '60-69');
assert.equal(maleBp.fallback, false);
assert.equal(maleBp.series.length, 2);
assert.ok(maleBp.series.every(x => x.n >= 50 && x.p25 < x.median && x.median < x.p75));

const unknownSex = peerReferenceFor('weight', { age: 75, gender: 'unknown' });
assert.equal(unknownSex.status, 'available');
assert.equal(unknownSex.fallback, true);
assert.equal(unknownSex.series[0].scope, 'age_only');

const unsupported = referenceFor('spo2', { age: 82, gender: 'female' });
assert.equal(unsupported.peer.status, 'unavailable');
assert.equal(unsupported.clinical.status, 'available');

const transformed = transformCurve({
  actual: [{ value: 60 }], raw: [{ value: 60 }], clean: [], smooth: [], fitted: [],
  predicted: [{ value: 62, lower: 58, upper: 66 }],
  forecastInterval: { predicted: [62], lower: [58], upper: [66] },
  stats: { mean: 60, count: 1 },
}, 1 / (1.6 * 1.6));
assert.equal(transformed.actual[0].value, 23.44);
assert.equal(transformed.actual[0].value_kind, 'estimated');
assert.equal(transformed.predicted[0].lower, 22.66);
assert.equal(transformed.stats.count, 1);

console.log('curve reference and derived metric acceptance: PASS');
