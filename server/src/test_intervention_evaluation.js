import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executePython } from './services/pythonRuntime.js';
import { validateInterventionEvaluationOutput } from './contracts/interventionEvaluationContract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', '..', 'ml', 'intervention_evaluation', 'evaluate.py');
const start = Date.parse('2026-01-01T00:00:00Z');
const at = (day, hour = 8) => new Date(start + (day * 24 + hour) * 3600_000).toISOString();
const measurements = [];
for (let day = 0; day < 14; day += 1) measurements.push({ recorded_at: at(day), value: 7 + (day % 3) * .1, measurement_condition: 'fasting' });
for (let day = 21; day < 28; day += 1) measurements.push({ recorded_at: at(day), value: 6.2 + (day % 3) * .1, measurement_condition: 'fasting' });

const result = await executePython(script, {
  intervention: { intervention_id: 'synthetic-node-test', minimum_adherence_rate: .7, planned_execution_count: 7 },
  target_metric: { metric: 'glucose', unit: 'mmol/L' },
  baseline_window: { start: at(0, 0), end: at(13, 23) },
  intervention_window: { start: at(14, 0), end: at(20, 23) },
  outcome_window: { start: at(21, 0), end: at(27, 23) },
  execution_records: Array.from({ length: 7 }, (_, i) => ({ execution_log_id: `x${i}`, performed: true })),
  measurements, timezone: 'Asia/Shanghai', random_seed: 7, bootstrap_iterations: 500,
  concurrent_interventions: [], acute_events: [], prior_evaluations: [],
}, 20_000);

assert.equal(result.schema_version, 'n-of-1-intervention-evaluation.v1');
assert.equal(result.evidence_level, 'personal_preliminary');
assert.equal(validateInterventionEvaluationOutput(result).ok, true);
assert.ok(result.absolute_change < 0);
assert.doesNotMatch(result.message, /已证明有效/);
console.log('N-of-1 intervention Python runtime and output contract: PASS');
