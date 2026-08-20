import db from '../../db.js';
import { buildHealthContext } from '../contextBuilder.js';

const NAMES = { bp: '血压', glucose: '血糖', hr: '心率', sleep: '睡眠', weight: '体重', steps: '步数', spo2: '血氧', cholesterol: '胆固醇', hba1c: '糖化血红蛋白', egfr: 'eGFR', creatinine: '肌酐', urine_albumin: '尿白蛋白' };

export function getHealthSummary(user) {
  const context = buildHealthContext(user, 90);
  const latest = Object.entries(context.latest || {}).map(([type, row]) => ({
    type, metric: NAMES[type] || type, value: type === 'bp' && row.value2 != null ? `${row.value}/${row.value2}` : row.value,
    unit: row.unit || '', recorded_at: row.recorded_at, source: row.source || '未标注',
    trend: context.trend_by_type?.[type]?.direction || 'unknown',
  })).filter(x => x.value != null).slice(0, 8);
  return {
    success: true,
    window_days: context.window_days,
    data_points: context.data_points,
    latest,
    behavior: context.behavior,
    missing_common_metrics: context.missing_common_metrics,
    alerts: context.alerts,
    todos: context.todos,
    completeness: context.data_completeness || {
      ratio: context.data_points ? Math.min(1, +(context.data_points / 30).toFixed(3)) : 0,
      missing: context.missing_common_metrics || [],
    },
    profile: context.profile,
  };
}
