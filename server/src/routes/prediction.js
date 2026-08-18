// 健康预测路由
// 简单时间序列预测：线性回归 + 历史波动噪声
// 同龄人平均：按年龄段返回各指标参考均值
import express from 'express';
import db from '../db.js';
import { scoreMetric } from '../lib/scoring.js';

const router = express.Router();

// 指标元数据：以 metric_defs 表为单一数据源
// 展示附加属性（dual/invasive）仅在此保留，指标定义本身不重复维护
const ALL_METRICS = new Map(
  db.prepare('SELECT type, name, unit, color, icon, value_type FROM metric_defs ORDER BY sort')
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

/**
 * 简单线性回归预测
 * 返回预测点数组
 */
function linearPredict(points, futureDays) {
  if (points.length === 0) return [];
  if (points.length === 1) {
    // 只有一个点，用常数预测 + 小波动
    const v = points[0].value;
    const result = [];
    for (let i = 1; i <= futureDays; i++) {
      result.push({
        day: i,
        value: +(v + (Math.random() - 0.5) * v * 0.03).toFixed(2),
        predicted: true,
      });
    }
    return result;
  }

  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.value);

  // 线性回归 y = a*x + b
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;

  // 历史残差标准差（用于噪声）
  const residuals = ys.map((y, i) => y - (slope * i + intercept));
  const residualMean = residuals.reduce((a, b) => a + b, 0) / n;
  const variance = residuals.reduce((s, r) => s + (r - residualMean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance) || Math.abs(ys[0]) * 0.02 || 1;

  // 预测：线性趋势 + 小幅随机游走（衰减噪声）
  const result = [];
  let lastPred = ys[n - 1];
  for (let i = 1; i <= futureDays; i++) {
    const trendVal = slope * (n - 1 + i) + intercept;
    // 混合 70% 趋势 + 30% 随机游走
    const noise = (Math.random() - 0.5) * stdDev * 0.8;
    const blended = trendVal * 0.7 + lastPred * 0.3 + noise;
    lastPred = blended;
    result.push({
      day: i,
      value: +blended.toFixed(2),
      predicted: true,
    });
  }
  return result;
}

/**
 * 生成同龄人平均曲线（带轻微波动使其看起来真实）
 */
function generatePeerLine(baseValue, totalDays, seed = 0) {
  const result = [];
  for (let i = 0; i < totalDays; i++) {
    const noise = Math.sin(i * 0.3 + seed) * baseValue * 0.02;
    result.push(+(baseValue + noise).toFixed(2));
  }
  return result;
}

// ===== 路由 =====

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
router.get('/:type', (req, res) => {
  const { type } = req.params;
  const days = Math.min(parseInt(req.query.days || '30', 10), 365);
  const futureDays = Math.min(parseInt(req.query.future || '30', 10), 90);

  const meta = ALL_METRICS.get(type);
  if (!meta) return res.status(400).json({ error: '未知指标类型' });

  // 获取历史数据
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const points = db.prepare(`
    SELECT value, value2, recorded_at, source FROM metrics
    WHERE user_id = ? AND type = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(req.user.id, type, since);

  // 预测
  const actualPoints = points.map((p, i) => ({ day: i, value: p.value, value2: p.value2, recorded_at: p.recorded_at, predicted: false }));
  const predictedPoints = linearPredict(points, futureDays);

  // 同龄人平均
  const ageGroup = getAgeGroup(req.user.age);
  const peerBase = PEER_AVERAGES[ageGroup]?.[type];
  const totalDays = actualPoints.length + predictedPoints.length;
  const peerLine = peerBase ? generatePeerLine(peerBase.value, totalDays, type.charCodeAt(0)) : [];

  // 统计
  const values = points.map(p => p.value);
  const stats = values.length ? {
    avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
    min: Math.min(...values),
    max: Math.max(...values),
    count: values.length,
  } : null;

  // 预测趋势
  let predTrend = 'stable';
  if (predictedPoints.length >= 2) {
    const diff = predictedPoints[predictedPoints.length - 1].value - predictedPoints[0].value;
    const pct = Math.abs(diff) / (Math.abs(predictedPoints[0].value) || 1) * 100;
    if (pct > 3) predTrend = diff > 0 ? 'up' : 'down';
  }

  res.json({
    type,
    meta,
    actual: actualPoints,
    predicted: predictedPoints,
    peer: peerLine,
    peerBase: peerBase || null,
    ageGroup,
    stats,
    predTrend,
    days,
    futureDays,
  });
});

// 综合健康预测（所有指标的归一化拟合曲线）
router.get('/overview/composite', (req, res) => {
  const days = Math.min(parseInt(req.query.days || '30', 10), 365);
  const futureDays = Math.min(parseInt(req.query.future || '30', 10), 90);
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

  // 预测综合健康分
  const compositePredicted = linearPredict(
    compositeActual.map((p, i) => ({ value: p.value, day: i })),
    futureDays
  ).map(p => ({ ...p, predicted: true }));

  // 同龄人平均综合健康分
  const ageGroup = getAgeGroup(req.user.age);
  const peerBaseScore = ageGroup === '60-69' ? 82 : ageGroup === '70-79' ? 78 : 73;
  const totalDays = compositeActual.length + compositePredicted.length;
  const peerLine = generatePeerLine(peerBaseScore, totalDays, 999);

  res.json({
    actual: compositeActual,
    predicted: compositePredicted,
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
