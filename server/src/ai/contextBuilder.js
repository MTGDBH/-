import db from '../db.js';

function latestRows(userId, days = 90) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare('SELECT type, value, value2, unit, recorded_at, source FROM metrics WHERE user_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC').all(userId, since);
}

export function buildHealthContext(user, days = 90) {
  const rows = latestRows(user.id, days);
  const byType = {};
  for (const row of rows) (byType[row.type] ||= []).push(row);
  const latest = Object.fromEntries(Object.entries(byType).map(([type, values]) => [type, values[values.length - 1]]));
  const behavior = {};
  for (const type of ['steps', 'sleep']) {
    const values = byType[type] || [];
    if (!values.length) continue;
    const avg = values.reduce((s, x) => s + Number(x.value), 0) / values.length;
    const recent = values.slice(-7);
    const recentAvg = recent.reduce((s, x) => s + Number(x.value), 0) / recent.length;
    behavior[type] = { data_points: values.length, average: +avg.toFixed(2), rolling_7d_average: +recentAvg.toFixed(2), latest: recent[recent.length - 1].value, latest_date: recent[recent.length - 1].recorded_at, interpretation: '行为模式参考，不是疾病未来预测' };
  }
  const todos = db.prepare('SELECT id, title, date, completed FROM todos WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(user.id);
  const alerts = db.prepare('SELECT id, metric_type, severity, title, message, created_at, status FROM alerts WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(user.id);
  return { window_days: days, data_points: rows.length, latest, behavior, todos, alerts, missing_common_metrics: ['bp', 'glucose', 'hr', 'sleep'].filter(t => !latest[t]) };
}
