// 健康评分算法
// 输入：近 7 天的 metrics 数组
// 输出：{ total_score, subscores: {sleep, nutrition, activity, chronic}, suggestions, summary }
//
// 评分原则：
// - 各项指标按"健康区间"分段打分（参考中国老年健康指南与常见临床阈值）
// - 指标元数据（哪些指标存在、正常范围）以 metric_defs 表为唯一数据源
// - 这里只保留"评分区间"这一份纯评分策略
// - 子项聚合：采用分层加权模型；无数据项不补分，并按实际可用权重归一化
// - 情绪(mood)：当前无真实数据来源，不参与评分（严禁再出现 85 等硬编码默认值）
//
// 注意：本算法为演示用工程实现，未做医学级别校验。
// 真实部署应接专业医学规则库或经临床医生审核。

import db from '../db.js';

// 已注册指标类型（来自 metric_defs 表，启动时加载一次）
const KNOWN_TYPES = new Set(
  db.prepare('SELECT type FROM metric_defs').all().map(r => r.type)
);

const METRIC_META = new Map(
  db.prepare('SELECT type, name, unit FROM metric_defs').all().map(r => [r.type, r])
);

// 健康管理参考权重（不是疾病诊断概率）：
// 慢病控制 40%、活动 25%、营养/体成分 20%、睡眠 15%。
// 设计参考 AHA Life's Essential 8 与 WHO ICOPE 的核心健康领域，
// 并根据本项目当前可采集指标做工程化映射。
export const SCORE_MODEL = {
  version: 'weighted-v1',
  period_days: 7,
  dimensions: {
    chronic: {
      label: '慢病控制', weight: 40,
      metrics: { bp: 30, glucose: 15, hba1c: 15, cholesterol: 10, spo2: 10, uricacid: 10, resp: 5, temp: 5 },
    },
    activity: {
      label: '活动', weight: 25,
      metrics: { steps: 50, grip: 30, hr: 20 },
    },
    nutrition: {
      label: '营养', weight: 20,
      metrics: { weight: 50, waist: 30, bodyfat: 20 },
    },
    sleep: {
      label: '睡眠', weight: 15,
      metrics: { sleep: 100 },
    },
  },
};

// 评分区间（纯评分策略；指标元数据在 metric_defs）
const SCORE_RANGES = {
  bp: {
    dual: true,
    sys: [[90, 130, 100], [130, 140, 80], [140, 160, 60], [160, Infinity, 40], [0, 90, 60]],
    dia: [[60, 85, 100], [85, 90, 80], [90, 100, 60], [100, Infinity, 40], [0, 60, 70]],
  },
  glucose: [[4, 7, 100], [7, 8, 80], [8, 10, 60], [10, Infinity, 40]],
  hr: [[60, 90, 100], [50, 60, 85], [90, 100, 80], [40, 50, 70], [100, Infinity, 50], [0, 40, 50]],
  sleep: [[7, 8, 100], [6, 7, 80], [8, 9, 85], [5, 6, 60], [4, 5, 50], [0, 4, 40]],
  spo2: [[95, 101, 100], [92, 95, 80], [88, 92, 60], [0, 88, 40]],
  weight: 'bmi', // 特殊处理：由 height+weight 推导 BMI
  steps: [[5000, Infinity, 100], [3000, 5000, 80], [1000, 3000, 60], [0, 1000, 40]],
  temp: [[36, 37.3, 100], [35.5, 36, 70], [37.3, 38, 70], [35, 35.5, 50], [38, 39, 50], [0, 35, 30], [39, Infinity, 30]],
  resp: [[14, 20, 100], [12, 14, 80], [20, 24, 80], [10, 12, 60], [24, 28, 60], [0, 10, 40], [28, Infinity, 40]],
  grip: [[25, Infinity, 100], [20, 25, 80], [15, 20, 60], [0, 15, 40]],
  bodyfat: [[20, 32, 100], [32, 38, 75], [15, 20, 75], [38, 45, 55], [45, Infinity, 40], [0, 15, 55]],
  waist: [[70, 90, 100], [90, 100, 75], [60, 70, 75], [100, 110, 55], [110, Infinity, 40], [0, 60, 55]],
  uricacid: [[150, 360, 100], [360, 420, 80], [120, 150, 70], [420, 480, 60], [480, Infinity, 40], [0, 120, 50]],
  cholesterol: [[3.1, 5.2, 100], [5.2, 5.7, 85], [5.7, 6.2, 70], [6.2, 7.8, 50], [7.8, Infinity, 30], [0, 3.1, 70]],
  hba1c: [[4, 6, 100], [6, 6.5, 85], [6.5, 7, 70], [7, 8, 50], [8, Infinity, 30], [0, 4, 60]],
};

/**
 * 单项数值评分
 * @param {number} value 主值
 * @param {number} [value2] 副值（血压场景用）
 * @param {string} type 指标类型
 * @param {object} [ctx] 上下文（身高用于 BMI）
 * @returns {number|null} 分数；未知类型或无法评分返回 null（不再默认 80）
 */
export function scoreMetric(value, value2, type, ctx = {}) {
  if (!KNOWN_TYPES.has(type)) return null;


  const ranges = SCORE_RANGES[type];
  if (!ranges) return null;

  if (type === 'bp') {
    const s = clampScore(scoreRange(value, ranges.sys));
    const d = clampScore(scoreRange(value2, ranges.dia));
    return Math.round(s * 0.6 + d * 0.4);
  }

  if (type === 'weight') {
    const height = ctx.height || 1.6; // m
    const bmi = value / (height * height);
    return clampScore(scoreRange(bmi, [
      [18.5, 24, 100], [24, 28, 80], [28, 32, 60], [16, 18.5, 60], [0, 16, 40], [32, Infinity, 40],
    ]));
  }

  return clampScore(scoreRange(value, ranges));
}

function scoreRange(v, ranges) {
  for (const [min, max, score] of ranges) {
    if (v >= min && v < max) return score;
  }
  return null;
}

function clampScore(s) {
  if (s == null) return null;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * 聚合近 7 天 metrics 为子项分数
 * 无数据子项不出现在结果中；mood 无真实数据源，不参与评分
 */
export function aggregateMetrics(metrics, ctx = {}) {
  // 取每种类型最近一条
  const latestByType = {};
  for (const m of metrics) {
    const cur = latestByType[m.type];
    if (!cur || new Date(m.recorded_at) > new Date(cur.recorded_at)) {
      latestByType[m.type] = m;
    }
  }

  const subscores = {};
  const dimensions = [];
  let totalWeightedScore = 0;
  let availableDimensionWeight = 0;
  let coverageWeight = 0;

  for (const [key, config] of Object.entries(SCORE_MODEL.dimensions)) {
    const metricDetails = [];
    let weightedScore = 0;
    let availableMetricWeight = 0;

    for (const [type, metricWeight] of Object.entries(config.metrics)) {
      const metric = latestByType[type];
      const score = metric ? scoreMetric(metric.value, metric.value2, type, ctx) : null;
      if (score == null) continue;
      const meta = METRIC_META.get(type) || {};
      weightedScore += score * metricWeight;
      availableMetricWeight += metricWeight;
      coverageWeight += config.weight * (metricWeight / 100);
      metricDetails.push({
        type,
        label: meta.name || type,
        unit: meta.unit || '',
        value: metric.value,
        value2: metric.value2 ?? null,
        score,
        weight: metricWeight,
        recorded_at: metric.recorded_at,
      });
    }

    const score = availableMetricWeight
      ? Math.round(weightedScore / availableMetricWeight)
      : null;
    if (score != null) {
      subscores[key] = score;
      totalWeightedScore += score * config.weight;
      availableDimensionWeight += config.weight;
    }
    dimensions.push({
      key,
      label: config.label,
      weight: config.weight,
      score,
      available_metric_weight: availableMetricWeight,
      metrics: metricDetails,
    });
  }

  // 缺失维度不补假分：总分按当前实际参与维度的权重重新归一化。
  const total = availableDimensionWeight
    ? Math.round(totalWeightedScore / availableDimensionWeight)
    : null;
  const scoring_details = {
    model: SCORE_MODEL.version,
    method: 'hierarchical_weighted',
    period_days: SCORE_MODEL.period_days,
    available_weight: availableDimensionWeight,
    coverage_percent: Math.round(coverageWeight),
    dimensions,
  };

  return { total, subscores, scoring_details };
}

/**
 * 根据子项分数生成改善建议
 */
export function generateSuggestions(subscores, latestByType) {
  const tips = [];
  const chronic = subscores.chronic ?? null;
  const activity = subscores.activity ?? null;
  const sleep = subscores.sleep ?? null;
  const nutrition = subscores.nutrition ?? null;

  if (chronic != null && chronic < 80) {
    const bp = latestByType.bp;
    if (bp && bp.value > 130) {
      tips.push({
        title: '血压管理：低盐饮食',
        detail: '每日盐摄入 < 5g，多吃蔬菜',
        icon: 'warning',
      });
    } else {
      tips.push({
        title: '慢病监测：定时测压',
        detail: '建议每日早晚各测一次血压并记录',
        icon: 'warning',
      });
    }
  }
  if (activity != null && activity < 80) {
    tips.push({
      title: '规律运动：每日 30 分钟',
      detail: '散步、太极、广场舞任选',
      icon: 'activity',
    });
  }
  if (sleep != null && sleep < 80) {
    tips.push({
      title: '睡眠改善：固定作息',
      detail: '22:30 前入睡，7 小时为目标',
      icon: 'sleep',
    });
  }
  if (nutrition != null && nutrition < 80) {
    tips.push({
      title: '营养均衡：少油多蔬果',
      detail: '三餐定时，少食多餐，控糖控盐',
      icon: 'nutrition',
    });
  }
  if (tips.length === 0) {
    tips.push({
      title: '保持良好习惯',
      detail: '当前各项指标稳定，继续保持健康生活',
      icon: 'ok',
    });
  }
  return tips.slice(0, 3);
}

/**
 * 主入口：聚合 + 建议
 */
export function evaluateHealth(metrics, ctx = {}) {
  const { total, subscores, scoring_details } = aggregateMetrics(metrics, ctx);

  const latestByType = {};
  for (const m of metrics) {
    if (!latestByType[m.type] || new Date(m.recorded_at) > new Date(latestByType[m.type].recorded_at)) {
      latestByType[m.type] = m;
    }
  }

  const suggestions = generateSuggestions(subscores, latestByType);
  const dimensionLabels = { sleep: '睡眠', nutrition: '营养', activity: '活动', chronic: '慢病控制' };
  const usedDimensions = Object.keys(subscores).map(key => dimensionLabels[key]).filter(Boolean);
  const coverage = scoring_details.coverage_percent;
  const summary = total == null
    ? '暂无足够健康数据，先到"健康监测"录入一次吧。'
    : `根据近 7 天有数据的${usedDimensions.join('、')}维度加权计算，您今天的健康评分 ${total} 分${
        coverage < 40 ? `；当前数据覆盖率 ${coverage}%，仅供有限参考`
          : total >= 80 ? '，整体状态良好' : total >= 60 ? '，需关注' : '，建议尽快复诊'
      }。`;

  return { total_score: total, subscores, scoring_details, suggestions, summary };
}
