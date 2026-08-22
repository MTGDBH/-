import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectModelBundle } from './lib/modelBundle.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-model-bundle-'));
try {
  assert.equal(inspectModelBundle(root).status, 'missing');
  const names = [
    ...['systo', 'diasto', 'hr', 'weight', 'waist', 'grip'].map(t => `population/numeric_${t}.metadata.json`),
    ...['glucose', 'hba1c', 'cholesterol', 'uricacid', 'creatinine'].flatMap(t => ['noninvasive', 'micro_anchor'].flatMap(tier => [`population/risk_${t}_${tier}.metadata.json`, `population/risk_${t}_${tier}.joblib`])),
    'htn_xgb/candidate_model.json', 'htn_xgb/calibrator_isotonic.pkl', 'htn_xgb/calibrator_platt.pkl', 'htn_xgb/threshold.json', 'htn_xgb/candidate_metadata.json',
  ];
  const files = names.map(relative => {
    const file = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, relative.startsWith('population/numeric_') ? '{"selected_model":"last_value"}\n' : '{}\n');
    const content = fs.readFileSync(file);
    return { path: relative, size: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') };
  });
  const manifest = { schema_version: 'health-model-bundle.v1', prediction_contract_version: 'health-prediction.v1', bundle_version: 'test', files };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  assert.equal(inspectModelBundle(root).status, 'ready');
  fs.appendFileSync(path.join(root, 'htn_xgb', 'threshold.json'), 'broken');
  assert.equal(inspectModelBundle(root).status, 'invalid');
  manifest.prediction_contract_version = 'future.v2';
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  assert.equal(inspectModelBundle(root).status, 'incompatible');
  console.log('model bundle Node integrity: PASS');
} finally {
  const expectedPrefix = path.resolve(os.tmpdir()) + path.sep;
  if (!path.resolve(root).startsWith(expectedPrefix)) throw new Error('refusing to remove non-temporary path');
  fs.rmSync(root, { recursive: true, force: true });
}
