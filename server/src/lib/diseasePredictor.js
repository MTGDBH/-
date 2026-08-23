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

function latestPredictionInputs(userId) {
  const rows = db.prepare(`SELECT p.field, p.value FROM prediction_inputs p JOIN (
    SELECT field, MAX(recorded_at) recorded_at FROM prediction_inputs WHERE user_id = ? GROUP BY field
  ) x ON x.field=p.field AND x.recorded_at=p.recorded_at WHERE p.user_id = ?`).all(userId, userId);
  return Object.fromEntries(rows.map(row => [row.field, row.value]));
}

function buildFeatures(user, metrics, inputs = {}) {
  const v = (type, field = 'value') => metrics[type]?.[field] ?? null;
  const height = Number(user?.height) || null;
  const weight = v('weight');
  return {
    age: user?.age ?? null, gender: user?.gender === 'female' ? 0 : user?.gender === 'male' ? 1 : null,
    edu: user?.education_level ?? null, systo: v('bp'), diasto: v('bp', 'value2'), pulse: v('hr'),
    bmi: weight != null && height ? +(weight / (height * height)).toFixed(4) : null,
    mwaist: v('waist'), lgrip: v('grip'), rgrip: v('grip'),
    bl_glu: v('glucose') != null ? +(v('glucose') * 18).toFixed(4) : null,
    bl_hbalc: v('hba1c'), bl_cho: v('cholesterol') != null ? +(v('cholesterol') * 38.67).toFixed(4) : null,
    bl_ua: v('uricacid') != null ? +(v('uricacid') / 59.48).toFixed(4) : null,
    sleep: v('sleep'),
    smokev: user?.smoking_status ?? null, smoken: user?.cigarettes_per_day ?? null,
    drinkev: user?.drinking_status ?? null, drinkl: user?.drinking_frequency ?? null,
    exercise: user?.exercise_level ?? null, totmet: user?.exercise_level ?? null,
    srh: inputs.srh ?? user?.self_rated_health ?? null, cesd10: inputs.cesd10 ?? null, total_cognition: inputs.total_cognition ?? null,
    adlab_c: inputs.adlab_c ?? null, iadl: inputs.iadl ?? null,
    chronic: [user?.chronic_diabetes, user?.chronic_heart, user?.chronic_stroke].some(v => v != null) ? 1 : null,
    diabe: user?.chronic_diabetes ?? null, hearte: user?.chronic_heart ?? null, stroke: user?.chronic_stroke ?? null,
    dyslipe: user?.dyslipidemia ?? null, lunge: user?.lung_disease ?? null,
  };
}

export async function predictDisease(userId, user, disease) {
  if (!DISEASES.has(disease)) return { success: false, error: 'unsupported_disease' };
  const metrics = latestMetrics(userId);
  if (!Object.keys(metrics).length) return { success: false, error: 'no_data', disease };
  const features = buildFeatures(user, metrics, latestPredictionInputs(userId));
  const result = await runPythonTool(SCRIPT, { disease, features });
  const missing = Array.isArray(result?.missing_features)
    ? result.missing_features
    : Object.entries(features).filter(([, value]) => value == null).map(([key]) => key);
  const totalFeatures = Object.keys(features).length;
  const availableFeatures = Math.max(0, totalFeatures - missing.length);
  const completeness = totalFeatures ? +(availableFeatures / totalFeatures).toFixed(3) : 0;
  const nextSteps = {
    edu: '补充教育程度', mwaist: '记录腰围', lgrip: '记录握力', rgrip: '记录另一侧握力',
    smokev: '填写吸烟情况', smoken: '填写每日吸烟量', drinkev: '填写饮酒情况', drinkl: '填写饮酒频率',
    exercise: '填写每周运动情况', totmet: '补充活动量', srh: '填写自评健康', cesd10: '完成情绪量表',
    total_cognition: '完成认知筛查', adlab_c: '完成日常活动评估', iadl: '完成工具性活动评估',
    chronic: '补充既往慢病史', diabe: '确认糖尿病史', hearte: '确认心脏病史', stroke: '确认卒中史',
    dyslipe: '确认血脂异常史', lunge: '确认肺部疾病史',
  };
  return {
    ...result,
    disease,
    features,
    data_sources: Object.entries(metrics).map(([type, r]) => ({ type, recorded_at: r.recorded_at, source: r.source })),
    data_completeness: {
      total_features: totalFeatures,
      available_features: availableFeatures,
      missing_count: missing.length,
      ratio: completeness,
      level: completeness >= 0.8 ? 'high' : completeness >= 0.5 ? 'medium' : 'low',
      next_steps: missing.map(key => nextSteps[key] || `补充${key}`),
    },
  };
}
