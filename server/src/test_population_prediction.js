import 'dotenv/config';
import assert from 'node:assert/strict';

import db from './db.js';
import { buildPopulationFeatures, calculateEgfr2021, projectBloodPressure, runPopulationPrediction } from './routes/prediction.js';

const user = db.prepare('SELECT * FROM users WHERE id = 1').get();
assert.ok(user, 'demo user 1 is required');
const features = buildPopulationFeatures(user.id, user);
assert.ok('systo' in features && 'sleep' in features && 'chronic' in features);

const [s, d] = projectBloodPressure(70, 80);
assert.ok(s - d >= 5, 'joint constraint must keep systolic above diastolic');
assert.ok(calculateEgfr2021(80, 68, 0) > 0, 'eGFR formula should return a positive estimate');
assert.equal(calculateEgfr2021(null, 68, 0), null);

const bp = await runPopulationPrediction(user.id, user, 'bp');
assert.equal(bp.schema_version, 'health-prediction.v1');
assert.ok(['available', 'abstained'].includes(bp.status));
if (bp.status === 'available') {
  assert.ok(bp.components.systolic.point - bp.components.diastolic.point >= 5);
  assert.equal(bp.display_label, '预测值');
}

const glucose = await runPopulationPrediction(user.id, user, 'glucose');
assert.equal(glucose.prediction_mode, 'risk');
assert.equal(glucose.display_label, '估计值');
assert.ok(glucose.abstained || ['low', 'medium', 'high'].includes(glucose.risk_level));
console.log('population prediction API bridge: PASS');
