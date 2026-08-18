// 单指标趋势详情路由
import express from 'express';
import db from '../db.js';
import { evaluateHealth } from '../lib/scoring.js';

const router = express.Router();

const METRIC_META = {
  bp:     { name: '血压',     unit: 'mmHg', color: '#F4A261', icon: '压' },
  glucose:{ name: '血糖',     unit: 'mmol/L', color: '#E0784E', icon: '糖' },
  hr:     { name: '心率',     unit: 'bpm',   color: '#9C7BC9', icon: '心' },
  sleep:  { name: '睡眠',     unit: 'h',     color: '#9C7BC9', icon: '眠' },
  spo2:   { name: '血氧',     unit: '%',     color: '#3E8E8E', icon: '氧' },
  ecg:    { name: '心电',     unit: '',      color: '#E0784E', icon: '电' },
  weight: { name: '体重',     unit: 'kg',    color: '#F4A261', icon: '重' },
  steps:  { name: '步数',     unit: '步',    color: '#5A8045', icon: '步' },
};

router.get('/types', (_req, res) => {
  res.json(Object.entries(METRIC_META).map(([key, v]) => ({ key, ...v })));
});

// 单指标趋势 + AI 文字解释
router.get('/:type', (req, res) => {
  const { type } = req.params;
  if (!METRIC_META[type]) return res.status(400).json({ error: '未知指标类型' });

  const days = Math.min(parseInt(req.query.days || '30', 10), 365);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const points = db.prepare(`
    SELECT value, value2, recorded_at, source FROM metrics
    WHERE user_id = ? AND type = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(req.user.id, type, since);

  // 简单统计
  const values = points.map(p => p.value);
  const latest = points.at(-1) || null;
  const stats = values.length ? {
    avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
    min: Math.min(...values),
    max: Math.max(...values),
    count: values.length,
  } : null;

  // 与最近 7 天比，更早的为基线
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const recent7 = points.filter(p => p.recorded_at >= sevenDaysAgo);
  const baseline = points.filter(p => p.recorded_at < sevenDaysAgo);
  let trend = 'stable';
  let trendPct = 0;
  if (recent7.length && baseline.length) {
    const avgR = recent7.reduce((a, b) => a + b.value, 0) / recent7.length;
    const avgB = baseline.reduce((a, b) => a + b.value, 0) / baseline.length;
    trendPct = +(((avgR - avgB) / avgB) * 100).toFixed(1);
    trend = Math.abs(trendPct) < 3 ? 'stable' : (trendPct > 0 ? 'up' : 'down');
  }

  // AI 解释（用 mock，不调 LLM，避免慢）
  const comment = buildComment(type, latest, stats, trend);

  res.json({
    type,
    meta: METRIC_META[type],
    latest: latest || null,
    points,
    stats,
    trend,
    trendPct,
    comment,
    days,
  });
});

function buildComment(type, latest, stats, trend) {
  if (!latest) return '暂无数据，先到"健康监测"录入一次吧。';
  const v = latest.value;
  const dirMap = { up: '上升', down: '下降', stable: '稳定' };
  switch (type) {
    case 'bp': {
      const d = latest.value2;
      if (v >= 140 || d >= 90) return `收缩压 ${v}、舒张压 ${d} mmHg 偏高，建议低盐饮食并联系医生。${trend !== 'stable' ? `近期趋势：${dirMap[trend]}（${stats ? Math.round(stats.avg) : v}→${Math.round(v)}）` : ''}`;
      if (v < 90 || d < 60) return `血压偏低，记得起身慢一点。`;
      return `血压 ${v}/${d} mmHg 处于健康范围。保持现在的作息和饮食就好。`;
    }
    case 'glucose':
      if (v >= 7) return `空腹血糖 ${v} mmol/L 偏高，注意主食减半，餐后散步 20 分钟。`;
      if (v < 4) return `血糖偏低，可以吃块糖或喝点果汁缓解。`;
      return `血糖 ${v} mmol/L 在健康范围内，继续保持。`;
    case 'hr':
      if (v >= 100) return `心率 ${v} bpm 偏快，建议静坐 5 分钟后再测一次。`;
      if (v < 50) return `心率 ${v} bpm 偏慢，如感不适请联系医生。`;
      return `心率 ${v} bpm 正常。`;
    case 'sleep':
      if (v < 6) return `昨晚只睡了 ${v} 小时，建议今晚 22:30 前入睡。`;
      if (v >= 9) return `睡眠时长 ${v} 小时，睡眠过久也不一定好，注意规律作息。`;
      return `睡眠 ${v} 小时，达到推荐时长。`;
    case 'spo2':
      if (v < 92) return `血氧 ${v}% 偏低，建议吸氧并联系医生。`;
      return `血氧 ${v}% 正常，呼吸功能良好。`;
    case 'ecg':
      return v === 100 || v === 1 ? '心电结果：窦性心律。继续保持。' : '心电结果存在异常标记，请联系医生复诊。';
    case 'weight':
      return `最近体重 ${v} kg。`;
    case 'steps':
      if (v < 3000) return `今日步数 ${v}，建议午后出门活动 30 分钟。`;
      return `今日步数 ${v}，活动量充足。`;
    default:
      return `${v}`;
  }
}

export default router;
