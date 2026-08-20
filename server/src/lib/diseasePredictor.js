// 多疾病新发风险：只从当前登录用户数据库指标构建特征，再调用统一 Python 模型。
import db from '../db.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPythonTool } from './htnPredictor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'ml', 'disease_risk', 'predict_disease.py');
export const DISEASES = new Set(['hypertension', 'diabetes', 'heart_disease', 'stroke']);

function latestMetrics(userId) {
  const rows = db.prepare(`SELECT m.* FROM metrics m JOIN (
    SELECT type, MAX(recorded_at) recorded_at FROM metrics WHERE user_id = ? GROUP BY type
  ) x ON x.type=m.type AND x.recorded_at=m.recorded_at WHERE m.user_id = ?`).all(userId, userId);
  return Object.fromEntries(rows.map(r => [r.type, r]));
}

function buildFeatures(user, metrics) {
  const v = (type, field = 'value') => metrics[type]?.[field] ?? null;
  const height = Number(user?.height) || null;
  const weight = v('weight');
  return {
    age: user?.age ?? null, gender: user?.gender === 'female' ? 0 : user?.gender === 'male' ? 1 : null,
    edu: null, systo: v('bp'), diasto: v('bp', 'value2'), pulse: v('hr'),
    bmi: weight != null && height ? +(weight / (height * height)).toFixed(4) : null,
    mwaist: v('waist'), lgrip: v('grip'), rgrip: v('grip'),
    bl_glu: v('glucose') != null ? +(v('glucose') * 18).toFixed(4) : null,
    bl_hbalc: v('hba1c'), bl_cho: v('cholesterol') != null ? +(v('cholesterol') * 38.67).toFixed(4) : null,
    bl_ua: v('uricacid') != null ? +(v('uricacid') / 59.48).toFixed(4) : null,
    sleep: v('sleep'), smokev: null, smoken: null, drinkev: null, drinkl: null,
    exercise: null, totmet: null, srh: null, cesd10: null, total_cognition: null,
    adlab_c: null, iadl: null, chronic: null, diabe: null, hearte: null, stroke: null,
    dyslipe: null, lunge: null,
  };
}

export async function predictDisease(userId, user, disease) {
  if (!DISEASES.has(disease)) return { success: false, error: 'unsupported_disease' };
  const metrics = latestMetrics(userId);
  if (!Object.keys(metrics).length) return { success: false, error: 'no_data', disease };
  const features = buildFeatures(user, metrics);
  const result = await runPythonTool(SCRIPT, { disease, features });
  return { ...result, disease, features, data_sources: Object.entries(metrics).map(([type, r]) => ({ type, recorded_at: r.recorded_at, source: r.source })) };
}
