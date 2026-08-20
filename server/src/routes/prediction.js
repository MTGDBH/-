// 健康预测路由
// 健康指标曲线：统一调用 ml/curve/health_curve.py，Node 只负责数据与契约转换。
// 同龄人平均：按年龄段返回各指标参考均值
import express from 'express';
import db from '../db.js';
import { scoreMetric } from '../lib/scoring.js';
import { runPythonTool } from '../lib/htnPredictor.js';
import { predictDisease, DISEASES } from '../lib/diseasePredictor.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURVE_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'ml', 'curve', 'health_curve.py');
const CURVE_METRICS = new Set(['systo', 'diasto', 'pulse', 'weight', 'bmi', 'mwaist', 'waist', 'glucose', 'hbalc', 'hba1c', 'cholesterol', 'uricacid', 'sleep', 'spo2', 'steps', 'temp', 'resp', 'grip', 'bodyfat', 'health_score']);

// 指标元数据：以 metric_defs 表为单一数据源
// 展示附加属性（dual/invasive）仅在此保留，指标定义本身不重复维护
const ALL_METRICS = new Map(
  db.prepare('SELECT type, name, unit, color, icon, value_type, normal_min, normal_max FROM metric_defs ORDER BY sort')
    .all()
    .map(r => {
      const dual = r.value_type === 'dual';
      const invasive = ['uricacid', 'cholesterol', 'hba1c', 'glucose'].includes(r.type) ? 'mini' : 'none';
      return [r.type, { ...r, dual, invasive }];
    })
);

// 同龄人平均参考值（按年龄段）
const PEER_AVERAGES = {
  '60-69': {
    bp: { value: 125, value2: 78 }, glucose: { value: 5.6 }, hr: { value: 72 },
    sleep: { value: 7.0 }, spo2: { value: 96 }, weight: { value: 65 }, steps: { value: 5500 },
    temp: { value: 36.5 }, resp: { value: 16 }, grip: { value: 28 }, bodyfat: { value: 26 },
    waist: { value: 85 }, uricacid: { value: 340 }, cholesterol: { value: 5.2 }, hba1c: { value: 5.8 },
  },
  '70-79': {
    bp: { value: 130, value2: 80 }, glucose: { value: 5.8 }, hr: { value: 70 },
    sleep: { value: 6.5 }, spo2: { value: 95 }, weight: { value: 63 }, steps: { value: 4000 },
    temp: { value: 36.4 }, resp: { value: 17 }, grip: { value: 24 }, bodyfat: { value: 28 },
    waist: { value: 87 }, uricacid: { value: 360 }, cholesterol: { value: 5.5 }, hba1c: { value: 6.0 },
  },
  '80+': {
    bp: { value: 135, value2: 82 }, glucose: { value: 6.0 }, hr: { value: 68 },
    sleep: { value: 6.0 }, spo2: { value: 94 }, weight: { value: 60 }, steps: { value: 2500 },
    temp: { value: 36.3 }, resp: { value: 18 }, grip: { value: 20 }, bodyfat: { value: 30 },
    waist: { value: 90 }, uricacid: { value: 380 }, cholesterol: { value: 5.8 }, hba1c: { value: 6.2 },
  },
};

function getAgeGroup(age) {
  if (!age || age < 60) return '60-69';
  if (age < 70) return '60-69';
  if (age < 80) return '70-79';
  return '80+';
}

function isoFromSeconds(seconds) {
  return new Date(Number(seconds) * 1000).toISOString();
}

function mapTrend(direction) {
  return direction === 'rising' ? 'up' : direction === 'falling' ? 'down' : 'stable';
}

function statsFromValues(values) {
  if (!values.length) return null;
  return {
    avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
    min: Math.min(...values), max: Math.max(...values), count: values.length,
  };
}

/** 统一调用 Python 曲线服务，并转换为预测页使用的稳定契约。 */
async function analyzeCurve(metric, unit, points, futureDays, conditionGroup = null) {
  if (!CURVE_METRICS.has(metric)) return { status: 'not_applicable', actual: points, predicted: [], fitted: [] };
  const result = await runPythonTool(CURVE_SCRIPT, {
    metric,
    unit,
    condition_group: conditionGroup,
    points: points.map(p => ({ id: p.id, t: p.recorded_at, v: p.value, condition: p.measurement_condition || 'unknown', source: p.source || null })),
    forecast_days: futureDays,
  });
  const sourceById = new Map(points.map(point => [point.id, point]));
  const raw = result?.curve?.raw_timestamps?.map((t, i) => ({
    id: result.curve.raw_ids?.[i] ?? i,
    day: i, value: result.curve.raw_actual[i], recorded_at: isoFromSeconds(t), predicted: false,
    outlier: (result.curve.raw_outlier_indices || []).includes(i),
    measurement_condition: sourceById.get(result.curve.raw_ids?.[i])?.measurement_condition || conditionGroup || 'unknown',
    source: sourceById.get(result.curve.raw_ids?.[i])?.source || null,
  })) || points.map((p, i) => ({ ...p, day: i, predicted: false, outlier: false }));
  const fittedValues = result?.curve?.fitted || [];
  const fittedTimes = result?.curve?.timestamps || [];
  const fitted = fittedTimes?.map((t, i) => ({ recorded_at: isoFromSeconds(t), value: fittedValues[i] })) || [];
  const fc = result?.forecast?.curve;
  const predicted = result?.forecast?.available && fc?.timestamps?.length
    ? fc.timestamps.map((t, i) => ({ day: i + 1, value: fc.predicted[i], lower: fc.lower[i], upper: fc.upper[i], recorded_at: isoFromSeconds(t), predicted: true }))
    : [];
  return {
    status: result?.status || (result?.success ? 'ok' : 'error'),
    actual: raw, raw, predicted, fitted,
    clean: result?.curve?.clean_timestamps?.map((t, i) => ({ recorded_at: isoFromSeconds(t), value: result.curve.clean_actual[i] })) || [],
    smooth: result?.curve?.smooth_timestamps?.map((t, i) => ({ recorded_at: isoFromSeconds(t), value: result.curve.smooth[i] })) || fitted,
    baseline: result?.baseline || null,
    schemaVersion: result?.schema_version || 'curve.v2',
    conditionGroup,
    forecastInterval: result?.forecast?.curve || null,
    stats: result?.stats || statsFromValues(points.map(p => p.value)),
    predTrend: mapTrend(result?.long_term_trend),
    analysis: result?.success ? {
      model: result.model, confidence: result.confidence, confidenceLevel: result.confidence_level, modelScore: result.model_score,
      dataPoints: result.data_points, rawPoints: result.raw_points,
      removedOutliers: result.removed_outliers, forecastAvailable: !!result.forecast?.available,
      forecastDays: result.forecast?.days || 0, forecastModel: result.forecast?.model || null,
      horizonDays: result.forecast?.horizon_days || 0,
      forecastCoverageTarget: result.forecast?.coverage_target || 0.9,
      calibrationStatus: result.forecast?.calibration_status || 'not_available',
      backtest: result.backtest || null,
      metricPolicy: result.metric_policy || null,
      measurementConditionCoverage: result.measurement_condition_coverage ?? null,
      dateStart: result.curve?.timestamps?.length ? isoFromSeconds(result.curve.timestamps[0]).slice(0, 10) : null,
      dateEnd: result.curve?.timestamps?.length ? isoFromSeconds(result.curve.timestamps[result.curve.timestamps.length - 1]).slice(0, 10) : null,
      forecastReason: result.forecast?.reason || null,
      eligibility: result.eligibility || null,
      medicalBounds: result.medical_bounds || null,
      warning: result.warning,
    } : { error: result?.error || 'curve service unavailable' },
  };
}

/** 同龄人平均参考线：保持为常数，避免把统计参考值伪装成测量波动。 */
function generatePeerLine(baseValue, totalDays) {
  return Array.from({ length: totalDays }, () => +Number(baseValue).toFixed(2));
}

function toCurveSeries(id, label, unit, condition, curve, color) {
  return {
    id,
    label,
    unit,
    condition: condition || 'all',
    color,
    observed: curve?.raw || curve?.actual || [],
    trend: curve?.fitted || curve?.smooth || [],
    baseline: curve?.baseline || null,
    forecast: {
      ...(curve?.forecastInterval || {}),
      available: !!curve?.analysis?.forecastAvailable,
      points: curve?.predicted || [],
      reason: curve?.analysis?.forecastReason || null,
      model: curve?.analysis?.forecastModel || curve?.analysis?.model || null,
    },
    analysis: curve?.analysis || null,
  };
}

// ===== 路由 =====

// 多疾病两年新发风险（由当前用户指标构建输入，禁止客户端直接传模型字段）
router.get('/disease/:disease', async (req, res) => {
  const disease = String(req.params.disease || '');
  if (!DISEASES.has(disease)) return res.status(400).json({ error: '不支持的疾病类型', supported: [...DISEASES] });
  try {
    const result = await predictDisease(req.user.id, req.user, disease);
    if (!result.success) return res.status(result.error === 'no_data' ? 200 : 503).json(result);
    res.json(result);
  } catch (e) {
    console.error('[disease-risk] unexpected error:', e);
    res.status(500).json({ success: false, error: 'prediction service internal error' });
  }
});

// 获取所有可用指标类型（内置 + 用户自定义）
router.get('/metrics', (req, res) => {
  const builtIn = [...ALL_METRICS.entries()].map(([key, v]) => ({ key, ...v, custom: false }));
  const custom = db.prepare('SELECT * FROM custom_metrics WHERE user_id = ?').all(req.user.id)
    .map(c => ({
      key: 'custom_' + c.id,
      name: c.name,
      unit: c.unit,
      color: c.color,
      icon: c.icon,
      dual: false,
      invasive: 'none',
      custom: true,
      ref_min: c.ref_min,
      ref_max: c.ref_max,
    }));
  res.json([...builtIn, ...custom]);
});

// 新增自定义指标
router.post('/custom-metrics', (req, res) => {
  const { name, unit, icon, color, ref_min, ref_max } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const r = db.prepare(`
    INSERT INTO custom_metrics (user_id, name, unit, icon, color, ref_min, ref_max)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, name, unit || '', icon || '自', color || '#F4A261',
         ref_min ?? null, ref_max ?? null);
  res.json(db.prepare('SELECT * FROM custom_metrics WHERE id = ?').get(r.lastInsertRowid));
});

// 删除自定义指标
router.delete('/custom-metrics/:id', (req, res) => {
  db.prepare('DELETE FROM custom_metrics WHERE id = ? AND user_id = ?')
    .run(parseInt(req.params.id, 10), req.user.id);
  res.json({ ok: true });
});

// 单指标预测
router.get('/:type', async (req, res) => {
  const { type } = req.params;
  const days = Math.min(parseInt(req.query.days || '30', 10), 365);
  const futureDays = Math.min(parseInt(req.query.future || '30', 10), 30);

  const meta = ALL_METRICS.get(type);
  if (!meta) return res.status(400).json({ error: '未知指标类型' });

  // 获取历史数据
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const points = db.prepare(`
    SELECT id, value, value2, recorded_at, source, measurement_condition FROM metrics
    WHERE user_id = ? AND type = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(req.user.id, type, since);

  const sourcePoints = points.map(p => ({ ...p, value: p.value }));
  let curve;
  let series = [];
  if (type === 'bp') {
    const systolic = await analyzeCurve('systo', meta.unit, sourcePoints, futureDays);
    const diastolicPoints = sourcePoints.filter(p => p.value2 != null).map(p => ({ ...p, value: p.value2 }));
    const diastolic = await analyzeCurve('diasto', meta.unit, diastolicPoints, futureDays);
    curve = systolic;
    series = [
      toCurveSeries('bp.systolic', '收缩压', meta.unit, 'all', systolic, '#F4A261'),
      toCurveSeries('bp.diastolic', '舒张压', meta.unit, 'all', diastolic, '#9C7BC9'),
    ];
  } else if (type === 'glucose') {
    const normalizedConditions = sourcePoints.map(p => String(p.measurement_condition || 'unknown').toLowerCase());
    const knownConditions = [...new Set(normalizedConditions)].filter(condition => ['fasting', 'postprandial_2h', 'random'].includes(condition));
    const groups = [...knownConditions, ...(normalizedConditions.includes('unknown') ? ['unknown'] : [])];
    if (!groups.length) groups.push('unknown');
    const curves = await Promise.all(groups.map(condition => analyzeCurve('glucose', meta.unit, sourcePoints, futureDays, condition)));
    curve = curves.find(c => c.conditionGroup === 'fasting') || curves[0];
    series = curves.map((c, index) => toCurveSeries(`glucose.${groups[index]}`, groups[index] === 'fasting' ? '空腹血糖' : groups[index] === 'postprandial_2h' ? '餐后2小时' : groups[index] === 'random' ? '随机血糖' : '未标记条件', meta.unit, groups[index], c, index ? '#9C7BC9' : '#E0784E'));
  } else if (type === 'hr') {
    const hasResting = sourcePoints.some(point => String(point.measurement_condition || '').toLowerCase() === 'resting');
    const group = hasResting ? 'resting' : 'unknown';
    curve = await analyzeCurve('pulse', meta.unit, sourcePoints, futureDays, group);
    series = [toCurveSeries('hr.resting', hasResting ? '静息心率' : '心率（未标记状态）', meta.unit, group, curve, meta.color)];
  } else if (type === 'ecg') {
    curve = { status: 'not_applicable', actual: sourcePoints.map((p, i) => ({ ...p, day: i, predicted: false })), predicted: [], fitted: [], stats: statsFromValues(sourcePoints.map(p => p.value)), predTrend: 'stable', analysis: { forecastAvailable: false, forecastReason: '心电图不以连续数值曲线外推' } };
    series = [toCurveSeries('ecg.observed', meta.name, meta.unit, 'all', curve, meta.color)];
  } else {
    const curveMetric = type === 'hr' ? 'pulse' : type;
    curve = await analyzeCurve(curveMetric, meta.unit, sourcePoints, futureDays);
    series = [toCurveSeries(type, meta.name, meta.unit, 'all', curve, meta.color)];
  }
  const actualPoints = curve.actual || [];
  const predictedPoints = curve.predicted;

  // 同龄人平均
  const ageGroup = getAgeGroup(req.user.age);
  const peerBase = PEER_AVERAGES[ageGroup]?.[type];
  const totalDays = actualPoints.length + predictedPoints.length;
  const peerLine = peerBase ? generatePeerLine(peerBase.value, totalDays) : [];

  // 统计
  const stats = curve.stats;

  res.json({
    type,
    meta,
    actual: actualPoints,
    raw: curve.raw || actualPoints,
    clean: curve.clean || [],
    smooth: curve.smooth || curve.fitted,
    baseline: curve.baseline || null,
    forecast_interval: curve.forecastInterval || null,
    predicted: predictedPoints,
    peer: peerLine,
    peerBase: peerBase || null,
    ageGroup,
    stats,
    predTrend: curve.predTrend,
    fitted: curve.fitted,
    schema_version: 'curve.v2',
    series,
    eligibility: curve.analysis?.eligibility || null,
    analysis: curve.analysis || null,
    status: curve.status,
    days,
    futureDays,
  });
});

// 综合健康预测（所有指标的归一化拟合曲线）
router.get('/overview/composite', async (req, res) => {
  const days = Math.min(parseInt(req.query.days || '30', 10), 365);
  const futureDays = Math.min(parseInt(req.query.future || '30', 10), 30);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  // 获取所有指标的历史数据
  const allMetrics = db.prepare(`
    SELECT type, value, value2, recorded_at FROM metrics
    WHERE user_id = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(req.user.id, since);

  // 按类型分组，按天聚合
  const byType = {};
  for (const m of allMetrics) {
    if (!byType[m.type]) byType[m.type] = [];
    byType[m.type].push(m);
  }

  // 收集所有日期
  const allDates = [...new Set(allMetrics.map(m => m.recorded_at.slice(0, 10)))].sort();

  // 为每天计算综合健康分
  const compositeActual = allDates.map(date => {
    const dayMetrics = allMetrics.filter(m => m.recorded_at.slice(0, 10) === date);
    const scores = dayMetrics
      .filter(m => ALL_METRICS.has(m.type))
      .map(m => scoreMetric(m.value, m.value2, m.type, { height: req.user.height }))
      .filter(s => s != null);
    if (!scores.length) return null;
    return {
      date,
      value: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      predicted: false,
    };
  }).filter(Boolean);

  // 综合分也走同一套 Python 曲线服务；数据不足时只展示历史，不伪造预测。
  const compositeResult = await runPythonTool(CURVE_SCRIPT, {
    metric: 'health_score', unit: 'score', forecast_days: futureDays,
    points: compositeActual.map(p => ({ t: `${p.date}T00:00:00Z`, v: p.value })),
  });
  // 综合健康分只解释历史构成，不做未来数值外推，避免把多个指标的归一化分数包装成医学预测。
  const compositePredicted = [];

  // 同龄人平均综合健康分
  const ageGroup = getAgeGroup(req.user.age);
  const peerBaseScore = ageGroup === '60-69' ? 82 : ageGroup === '70-79' ? 78 : 73;
  const totalDays = compositeActual.length + compositePredicted.length;
  const peerLine = generatePeerLine(peerBaseScore, totalDays);

  res.json({
    actual: compositeActual,
    predicted: compositePredicted,
    fitted: compositeResult?.curve?.fitted?.map((value, i) => ({ date: compositeResult.curve.timestamps[i], value })) || [],
    status: compositeResult?.status || (compositeResult?.success ? 'ok' : 'error'),
    analysis: compositeResult?.success ? {
      model: compositeResult.model, confidence: compositeResult.confidence,
      warning: compositeResult.warning, forecastAvailable: !!compositeResult.forecast?.available,
      forecastDays: compositeResult.forecast?.days || 0,
      forecastReason: compositeResult.forecast?.reason || null,
    } : null,
    peer: peerLine,
    peerBaseScore,
    ageGroup,
    metricCount: Object.keys(byType).length,
    days,
    futureDays,
  });
});

// 获取所有有数据的指标列表（用于预测页渲染多张图）
router.get('/overview/list', (req, res) => {
  const days = Math.min(parseInt(req.query.days || '30', 10), 365);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const types = db.prepare(`
    SELECT DISTINCT type, COUNT(*) as cnt FROM metrics
    WHERE user_id = ? AND recorded_at >= ?
    GROUP BY type ORDER BY cnt DESC
  `).all(req.user.id, since);

  const result = types
    .filter(t => ALL_METRICS.has(t.type))
    .map(t => ({ type: t.type, ...ALL_METRICS.get(t.type), count: t.cnt }));

  res.json(result);
});

// ===== XGBoost 高血压风险预测（Node → Python Tool）=====
// 说明：
//   - 本接口为 Phase 2.2 的显式输入模式：由请求体直接提供 12 个模型字段，
//     不从数据库读取历史数据（下一阶段再做 数据库→最近数据→模型）
//   - 只接受白名单字段，不允许传入模型路径或任意命令
//   - 字段单位: 血压 mmHg、bmi、腰围 cm、握力 kg、bl_glu/bl_cho/bl_ua = mg/dl、
//     糖化 %、睡眠 h
import { HTN_FEATURES, predictHtn } from '../lib/htnPredictor.js';

router.post('/htn', async (req, res) => {
  const body = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: 'body 必须是 JSON 对象' });
  }

  // 白名单过滤：只取 12 个模型字段，丢弃其他一切键（防注入任意参数）
  const input = {};
  for (const k of HTN_FEATURES) input[k] = body[k];

  try {
    const result = await predictHtn(input);
    if (!result.success) {
      // 传输层/环境错误（对象 error.code）→ 结构化 5xx；Python 校验错误（字符串）→ 4xx
      if (typeof result.error === 'object' && result.error && result.error.code) {
        const statusMap = {
          PYTHON_NOT_FOUND: 503,
          PYTHON_TIMEOUT: 504,
          PYTHON_EXIT: 502,
          PYTHON_EMPTY_OUTPUT: 502,
          PYTHON_BAD_OUTPUT: 502,
        };
        return res.status(statusMap[result.error.code] || 500).json({ error: result.error.message || 'prediction service error' });
      }
      return res.status(400).json({ error: typeof result.error === 'string' ? result.error : 'invalid prediction input' });
    }
    res.json(result);
  } catch (e) {
    console.error('[htn] unexpected error:', e);
    res.status(500).json({ error: 'prediction service internal error' });
  }
});

export default router;
