import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MODELS_DIR = path.resolve(__dirname, '..', '..', '..', 'ml', 'models');
const EXPECTED_SCHEMA = 'health-model-bundle.v1';
const EXPECTED_CONTRACT = 'health-prediction.v1';
const POPULATION_TARGETS = new Set(['bp', 'hr', 'weight', 'waist', 'grip', 'glucose', 'hba1c', 'cholesterol', 'uricacid', 'creatinine']);
let cached = null;

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.includes('..') || parts.includes('')) return null;
  return parts.join('/');
}

export function inspectModelBundle(modelsDir = MODELS_DIR) {
  const manifestPath = path.join(modelsDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { status: 'missing', reason_code: 'MODEL_BUNDLE_MISSING', bundle_version: null, targets: [] };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.schema_version !== EXPECTED_SCHEMA || manifest.prediction_contract_version !== EXPECTED_CONTRACT) {
      return { status: 'incompatible', reason_code: 'MODEL_BUNDLE_INCOMPATIBLE', bundle_version: manifest.bundle_version || null, targets: [] };
    }
    const entries = Array.isArray(manifest.files) ? manifest.files : [];
    const seen = new Set();
    for (const entry of entries) {
      const relative = safeRelative(entry.path);
      if (!relative || seen.has(relative)) throw new Error('invalid manifest path');
      seen.add(relative);
      const file = path.resolve(modelsDir, ...relative.split('/'));
      if (!file.startsWith(path.resolve(modelsDir) + path.sep) || !fs.statSync(file).isFile()) throw new Error('missing artifact');
      const stat = fs.statSync(file);
      if (stat.size !== Number(entry.size) || digest(file) !== entry.sha256) throw new Error('artifact checksum mismatch');
    }
    const numericTargets = ['systo', 'diasto', 'hr', 'weight', 'waist', 'grip'];
    const riskStems = ['glucose', 'hba1c', 'cholesterol', 'uricacid', 'creatinine'].flatMap(t => ['noninvasive', 'micro_anchor'].map(tier => `risk_${t}_${tier}`));
    const required = [
      ...numericTargets.map(t => `population/numeric_${t}.metadata.json`),
      ...riskStems.flatMap(stem => [`population/${stem}.metadata.json`, `population/${stem}.joblib`]),
      'htn_xgb/candidate_model.json', 'htn_xgb/calibrator_isotonic.pkl', 'htn_xgb/calibrator_platt.pkl',
      'htn_xgb/threshold.json', 'htn_xgb/candidate_metadata.json',
    ];
    for (const target of numericTargets) {
      const metadataPath = `population/numeric_${target}.metadata.json`;
      if (!seen.has(metadataPath)) continue;
      const metadata = JSON.parse(fs.readFileSync(path.join(modelsDir, ...metadataPath.split('/')), 'utf8'));
      if (metadata.selected_model !== 'last_value') required.push(`population/numeric_${target}.joblib`);
    }
    if (required.some(relative => !seen.has(relative))) throw new Error('required signed artifact missing');
    return { status: 'ready', reason_code: null, bundle_version: manifest.bundle_version || 'unknown', targets: [...POPULATION_TARGETS] };
  } catch {
    return { status: 'invalid', reason_code: 'MODEL_BUNDLE_INVALID', bundle_version: null, targets: [] };
  }
}

export function getModelBundleStatus({ force = false } = {}) {
  let signature = 'missing';
  try {
    const stat = fs.statSync(path.join(MODELS_DIR, 'manifest.json'));
    signature = `${stat.mtimeMs}:${stat.size}`;
  } catch { /* missing bundle */ }
  if (!force && cached?.signature === signature) return cached.value;
  const value = inspectModelBundle(MODELS_DIR);
  cached = { signature, value };
  return value;
}

export function populationCapabilities() {
  const bundle = getModelBundleStatus();
  const modes = {
    bp: 'value', hr: 'value', weight: 'value', waist: 'value', grip: 'value',
    glucose: 'risk', hba1c: 'risk', cholesterol: 'risk', uricacid: 'risk', creatinine: 'risk',
    egfr: 'derived',
  };
  return Object.entries(modes).map(([metric, prediction_mode]) => ({
    metric,
    prediction_mode,
    available: metric === 'egfr' || (bundle.status === 'ready' && bundle.targets.includes(metric)),
  }));
}
