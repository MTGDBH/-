// 健康评分算法
// 输入：近 7 天的 metrics 数组
// 输出：{ total_score, subscores: {sleep, nutrition, mood, activity, chronic}, suggestions, summary }
//
// 评分原则：
// - 各项指标按\"健康区间\"分段打分（参考中国老年健康指南与常见临床阈值）
// - 5 大子项取平均
// - 任何一项 < 60 自动生成针对性建议
//
// 注意：本算法为演示用工程实现，未做医学级别校验。
// 真实部署应接专业医学规则库或经临床医生审核。

const RANGE_SCORES = [
  // [min, max, score]
];

/**
 * 单项数值评分
 * @param {number} value 主值
 * @param {number} [value2] 副值（血压场景用）
 * @param {string} type 指标类型
 * @param {object} [ctx] 上下文（身高用于 BMI）
 */
function scoreMetric(value, value2, type, ctx = {}) {
  switch (type) {
    case 'bp': { // 血压
      const s = clampScore(scoreBp(value));
      const d = clampScore(scoreBp(value2, 'diastolic'));
      return Math.round(s * 0.6 + d * 0.4);
    }
    case 'glucose': // 空腹血糖 mmol/L
      return clampScore(scoreRange(value, [[4, 7, 100], [7, 8, 80], [8, 10, 60], [10, Infinity, 40]]));
    case 'hr': // 心率 bpm
      return clampScore(scoreRange(value, [[60, 90, 100], [50, 60, 85], [90, 100, 80], [40, 50, 70], [100, Infinity, 50], [0, 40, 50]]));
    case 'sleep': // 睡眠小时
      return clampScore(scoreRange(value, [[7, 8, 100], [6, 7, 80], [8, 9, 85], [5, 6, 60], [4, 5, 50], [0, 4, 40]]));
    case 'spo2': // 血氧 %
      return clampScore(scoreRange(value, [[95, 101, 100], [92, 95, 80], [88, 92, 60], [0, 88, 40]]));
    case 'ecg': // 心电结果定性：窦性=100，其他标记=50
      return value === 100 || value === 1 ? 100 : 50;
    case 'weight': { // 体重 kg（用 BMI 算，前端要传身高或后端默认 160cm）
      const height = ctx.height || 1.6; // m
      const bmi = value / (height * height);
      return clampScore(scoreRange(bmi, [[18.5, 24, 100], [24, 28, 80], [28, 32, 60], [16, 18.5, 60], [0, 16, 40], [32, Infinity, 40]]));
    }
    case 'steps': // 步数
      return clampScore(scoreRange(value, [[5000, Infinity, 100], [3000, 5000, 80], [1000, 3000, 60], [0, 1000, 40]]));
    default:
      return 80;
  }
}

function scoreBp(v, kind = 'systolic') {
  if (kind === 'diastolic') {
    return scoreRange(v, [[60, 85, 100], [85, 90, 80], [90, 100, 60], [100, Infinity, 40], [0, 60, 70]]);
  }
  return scoreRange(v, [[90, 130, 100], [130, 140, 80], [140, 160, 60], [160, Infinity, 40], [0, 90, 60]]);
}

function scoreRange(v, ranges) {
  for (const [min, max, score] of ranges) {
    if (v >= min && v < max) return score;
  }
  return 50;
}

function clampScore(s) {
  return Math.max(0, Math.min(100, Math.round(s)));
}

/**
 * 聚合近 7 天 metrics 为 5 大子项分数
 */
export function aggregateMetrics(metrics, ctx = {}) {
  const groups = {
    sleep: ['sleep'],
    nutrition: ['weight'],
    activity: ['hr', 'steps'],
    chronic: ['bp', 'glucose', 'spo2', 'ecg'],
  };

  // 取每种类型最近一条（也可取平均，简化取最近）
  const latestByType = {};
  for (const m of metrics) {
    const cur = latestByType[m.type];
    if (!cur || new Date(m.recorded_at) > new Date(cur.recorded_at)) {
      latestByType[m.type] = m;
    }
  }

  const subscores = {};
  for (const [subKey, types] of Object.entries(groups)) {
    const scores = types
      .map(t => latestByType[t])
      .filter(Boolean)
      .map(m => scoreMetric(m.value, m.value2, m.type, ctx));
    subscores[subKey] = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 80; // 无数据默认良好
  }

  // 情绪：todo 完成度 + 固定兜底
  subscores.mood = 85 + Math.min(10, Math.floor((ctx.todoCompletionRate || 0) * 10));

  const total = Math.round(
    (subscores.sleep + subscores.nutrition + subscores.mood + subscores.activity + subscores.chronic) / 5
  );

  return { total, subscores };
}

/**
 * 根据子项分数生成改善建议
 */
export function generateSuggestions(subscores, latestByType) {
  const tips = [];
  if (subscores.chronic < 80) {
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
  if (subscores.activity < 80) {
    tips.push({
      title: '规律运动：每日 30 分钟',
      detail: '散步、太极、广场舞任选',
      icon: 'activity',
    });
  }
  if (subscores.sleep < 80) {
    tips.push({
      title: '睡眠改善：固定作息',
      detail: '22:30 前入睡，7 小时为目标',
      icon: 'sleep',
    });
  }
  if (subscores.nutrition < 80) {
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
  const { total, subscores } = aggregateMetrics(metrics, ctx);

  const latestByType = {};
  for (const m of metrics) {
    if (!latestByType[m.type] || new Date(m.recorded_at) > new Date(latestByType[m.type].recorded_at)) {
      latestByType[m.type] = m;
    }
  }

  const suggestions = generateSuggestions(subscores, latestByType);
  const summary = `综合睡眠、营养、情绪、活动、慢病控制 5 个维度，您今天的健康评分 ${total} 分${
    total >= 80 ? '，整体状态良好' : total >= 60 ? '，需关注' : '，建议尽快复诊'
  }。`;

  return { total_score: total, subscores, suggestions, summary };
}
