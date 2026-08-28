import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db.js';
import { executePython } from './pythonRuntime.js';
import { validateInterventionEvaluationOutput } from '../contracts/interventionEvaluationContract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EVALUATION_SCRIPT = path.resolve(here, '..', '..', '..', 'ml', 'intervention_evaluation', 'evaluate.py');

function parseJSON(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value ?? '') ?? fallback; } catch { return fallback; }
}

function expectedCounts(intervention) {
  const configured = intervention.protocol?.expected_measurement_count;
  return configured && typeof configured === 'object' ? configured : {};
}

export function buildInterventionEvaluationInput(intervention, options) {
  const metric = options.target_metric.metric.startsWith('bp_') ? 'bp' : options.target_metric.metric;
  // SQL cutoff is the first leakage barrier. The Python engine repeats the same
  // cutoff before fitting any preprocessing parameter.
  const measurements = db.prepare(`SELECT id,type,value,value2,unit,recorded_at,source,device_id,
      measurement_condition,data_quality,measurement_context
    FROM metrics WHERE user_id=? AND type=? AND recorded_at>=? AND recorded_at<=?
    ORDER BY recorded_at ASC,id ASC`).all(
    intervention.subject_user_id, metric, intervention.baseline_start, intervention.outcome_end,
  );
  const executionRecords = db.prepare(`SELECT l.*,p.execution_log_id AS supersedes_execution_log_id
    FROM intervention_execution_logs l LEFT JOIN intervention_execution_logs p ON p.id=l.supersedes_log_id
    WHERE l.intervention_db_id=? AND l.performed_at<=? ORDER BY l.performed_at ASC,l.id ASC`)
    .all(intervention.id, intervention.outcome_end).map(row => ({ ...row, performed: Boolean(row.performed) }));
  const concurrent = db.prepare(`SELECT intervention_id,title,intervention_type,intervention_start,intervention_end
    FROM interventions WHERE subject_user_id=? AND id<>? AND status NOT IN ('proposed','pending_confirmation','cancelled')
      AND intervention_start<=? AND intervention_end>=?
    ORDER BY intervention_start ASC`).all(intervention.subject_user_id, intervention.id,
      intervention.outcome_end, intervention.intervention_start);
  const acuteEvents = db.prepare(`SELECT event_key AS type,created_at AS occurred_at,severity,title
    FROM discovery_events WHERE user_id=? AND severity='critical' AND created_at>=? AND created_at<=?
    ORDER BY created_at ASC`).all(intervention.subject_user_id, intervention.intervention_start, intervention.outcome_end);
  const priorEvaluations = db.prepare(`SELECT result FROM intervention_evaluations
    WHERE subject_user_id=? AND target_metric=? AND intervention_db_id<>? ORDER BY created_at DESC LIMIT 10`)
    .all(intervention.subject_user_id, options.target_metric.metric, intervention.id)
    .map(row => parseJSON(row.result, {}));
  const targetMinimum = Number(intervention.adherence_target?.minimum_rate);
  const planned = Number(intervention.protocol?.planned_execution_count);
  return {
    intervention: { intervention_id: intervention.intervention_id, definition: intervention.protocol,
      minimum_adherence_rate: Number.isFinite(targetMinimum) ? targetMinimum : 0.7,
      planned_execution_count: Number.isInteger(planned) && planned > 0 ? planned : executionRecords.length },
    target_metric: options.target_metric,
    baseline_window: { start: intervention.baseline_start, end: intervention.baseline_end },
    intervention_window: { start: intervention.intervention_start, end: intervention.intervention_end },
    outcome_window: { start: intervention.outcome_start, end: intervention.outcome_end },
    execution_records: executionRecords, measurements,
    measurement_conditions: { policy: 'strict_exact_group_v1' },
    data_quality_flags: { source: 'metrics.data_quality', invalid_rows_are_excluded: true },
    concurrent_interventions: concurrent, acute_events: acuteEvents, prior_evaluations: priorEvaluations,
    expected_measurement_count: expectedCounts(intervention), timezone: options.timezone,
    confidence_level: options.confidence_level, random_seed: options.random_seed,
    bootstrap_iterations: options.bootstrap_iterations,
  };
}

export async function evaluateIntervention(intervention, options) {
  const input = buildInterventionEvaluationInput(intervention, options);
  const output = await executePython(EVALUATION_SCRIPT, input, 30_000);
  if (output?.success === false && output?.schema_version == null) {
    return { ok: false, runtimeError: output.error || { code: 'INTERVENTION_EVALUATION_RUNTIME', message: '评价引擎不可用' } };
  }
  const validated = validateInterventionEvaluationOutput(output);
  if (!validated.ok) return { ok: false, contractError: validated.message };
  return { ok: true, result: validated.value, input };
}
