// Conservative publication gate. A model may still run for research auditing,
// but personal probability is returned only when every production criterion is
// backed by the same evaluated artifact.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const reportPath = path.join(root, 'ml', 'reports', 'national-award-risk-temporal-disjoint-evaluation-20260821.json');
const modelsDir = path.join(root, 'ml', 'disease_risk', 'models');

function loadJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
const report = loadJson(reportPath);

function ece(calibration = {}) {
  const bins = calibration.bins || [];
  const total = bins.reduce((sum, bin) => sum + Number(bin.n || 0), 0);
  if (!total) return null;
  return bins.reduce((sum, bin) => sum + Number(bin.n || 0) * Math.abs(Number(bin.predicted) - Number(bin.observed)), 0) / total;
}

function sha256(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
}

export function diseaseModelGate(disease) {
  const evaluated = report?.models?.find(item => item.disease === disease);
  const metadata = loadJson(path.join(modelsDir, `${disease}_model_metadata.json`));
  const artifactSha256 = sha256(path.join(modelsDir, `${disease}_calibrated.joblib`));
  if (!evaluated || !metadata || !artifactSha256) return { passed: false, reason_code: 'GATE_EVIDENCE_MISSING', checks: {} };
  const metrics = evaluated.test_metrics || {};
  const positives = Number(evaluated.test_transition?.positive || 0);
  const total = Number(evaluated.test_transition?.n || 0);
  const prevalence = total ? positives / total : null;
  const nullBrier = prevalence == null ? null : prevalence * (1 - prevalence);
  const brierSkill = nullBrier ? 1 - Number(metrics.brier) / nullBrier : null;
  const calibrationSlope = Number(metrics.calibration?.slope);
  const calibrationEce = ece(metrics.calibration);
  const ciLower = Number(metrics.bootstrap_auc?.ci95?.[0]);
  const checks = {
    participant_disjoint: evaluated.participant_disjoint === true && Number(evaluated.test_transition?.participants_overlap_with_train) === 0,
    auc: Number(metrics.roc_auc) >= 0.60,
    auc_ci: ciLower > 0.50,
    brier_skill: Number.isFinite(brierSkill) && brierSkill > 0,
    calibration_slope: calibrationSlope >= 0.7 && calibrationSlope <= 1.3,
    calibration_ece: Number.isFinite(calibrationEce) && calibrationEce <= 0.05,
    subgroup_fairness: false, // no age/sex subgroup audit is bound to this report
    artifact_binding: false, // evaluated report does not contain the deployed artifact hash
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    passed, reason_code: passed ? null : 'MODEL_NOT_APPROVED_FOR_PERSONAL_PROBABILITY', checks,
    evaluation_run_id: report.run_id, evaluated_model: evaluated.selected_model,
    deployed_model: metadata.model, artifact_sha256: artifactSha256,
    metrics: { roc_auc: metrics.roc_auc, auc_ci95: metrics.bootstrap_auc?.ci95 || null, brier: metrics.brier,
      brier_skill: brierSkill, calibration_slope: calibrationSlope, ece: calibrationEce },
  };
}
