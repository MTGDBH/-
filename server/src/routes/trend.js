// 单指标趋势详情路由
import express from 'express';
import db from '../db.js';
import { evaluateHealth } from '../lib/scoring.js';

const router = express.Router();

// 指标元数据（单一数据源：metric_defs 表）
const METRIC_META = new Map(
  db.prepare('SELECT type, name, unit, color, icon FROM metric_defs ORDER BY sort')
    .all()
    .map(r => [r.type, r])
);

router.get('/types', (_req, res) => {
  res.json([...METRIC_META.values()]);
});

// 单指标趋势 + AI 文字解释
router.get('/:type', (req, res) => {
  const { type } = req.params;
  if (!METRIC_META.has(type)) return res.status(400).json({ error: '未知指标类型' });

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

  // 快速规则解释：只给复测和安全边界，不代替智能体或医生判断。
  const comment = buildComment(type, latest, stats, trend);

  res.json({
    type,
    meta: METRIC_META.get(type),
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
      if (v >= 140 || d >= 90) return `本次血压 ${v}/${d} mmHg 偏高。请静坐 5 分钟后按相同条件复测；若连续多次仍高或伴胸痛、呼吸困难、明显头晕，请及时就医。${trend !== 'stable' ? `近期整体呈${dirMap[trend]}趋势。` : ''}`;
      if (v < 90 || d < 60) return `本次血压 ${v}/${d} mmHg 偏低。请先休息并复测，起身放慢；如伴晕厥、胸痛或明显不适，请及时就医。`;
      return `本次血压为 ${v}/${d} mmHg。单次读数不能代表长期状态，请继续在固定条件下记录。`;
    }
    case 'glucose':
      if (v >= 7) return `本次血糖 ${v} mmol/L 偏高，但还需结合空腹或餐后条件解释。请记录测量条件并按原条件复测，连续异常时联系医生。`;
      if (v < 4) return `本次血糖 ${v} mmol/L 偏低，请立即复测。若伴出汗、心慌、意识异常或无法正常进食，请立即呼救；已有医生制定的低血糖处置方案时按该方案执行。`;
      return `本次血糖为 ${v} mmol/L，请结合空腹或餐后测量条件和连续记录判断。`;
    case 'hr':
      if (v >= 100) return `心率 ${v} bpm 偏快，建议静坐 5 分钟后再测一次。`;
      if (v < 50) return `心率 ${v} bpm 偏慢，如感不适请联系医生。`;
      return `心率 ${v} bpm 正常。`;
    case 'sleep':
      if (v < 6) return `昨晚只睡了 ${v} 小时，建议今晚 22:30 前入睡。`;
      if (v >= 9) return `睡眠时长 ${v} 小时，睡眠过久也不一定好，注意规律作息。`;
      return `睡眠 ${v} 小时，达到推荐时长。`;
    case 'spo2':
      if (v < 92) return `本次血氧 ${v}% 偏低。请检查探头位置、静坐后复测；若仍低或伴呼吸困难、胸痛、意识异常，请立即就医。氧疗仅按医生既定方案使用。`;
      return `本次血氧为 ${v}%。请结合连续读数和是否有呼吸不适判断。`;
    case 'ecg':
      return v === 100 || v === 1 ? '心电结果：窦性心律。继续保持。' : '心电结果存在异常标记，请联系医生复诊。';
    case 'weight':
      return `最近体重 ${v} kg。`;
    case 'steps':
      if (v < 3000) return `今日步数 ${v}，活动量偏少。可根据体力和跌倒风险分段活动，不必追求单日精确步数。`;
      return `今日步数 ${v}，活动量充足。`;
    default:
      return `${v}`;
  }
}

export default router;
