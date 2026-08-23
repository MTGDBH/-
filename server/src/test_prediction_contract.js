import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import db from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(here, '..', '..', 'ml', 'prediction_contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const rows = db.prepare('SELECT type, prediction_mode FROM metric_defs ORDER BY sort').all();

assert.equal(rows.length, 18, 'database must expose exactly 18 home-oriented core metrics');
assert.ok(!rows.some(row => row.type === 'ecg'), 'ECG must not remain in the active home metric catalog');
assert.deepEqual(new Set(contract.allowed_prediction_modes), new Set(['value', 'range', 'risk', 'anomaly', 'derived', 'not_supported']));
for (const row of rows) {
  assert.ok(contract.metrics[row.type], `missing contract metric: ${row.type}`);
  assert.equal(row.prediction_mode, contract.metrics[row.type].prediction_mode, `mode mismatch: ${row.type}`);
}
assert.equal(contract.value_labels.measured, '直接测量值');
assert.equal(contract.value_labels.estimated, '估计值');
assert.equal(contract.value_labels.predicted, '预测值');
console.log('prediction contract database integration: PASS');
