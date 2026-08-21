// 为张奶奶追加一套可复现的 Curve V2 演示序列。
// 这些记录明确标记为 synthetic/demo，不覆盖既有数据，也不代表真实采集。
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const db = new Database(path.resolve(__dirname, 'app.db'));
const USER_ID = 1;
const MARKER = 'demo_curve_v2_20260821';
const START = new Date('2026-05-24T00:00:00.000Z');
const DAYS = 90;

function at(day, hour, minute = 0) {
  const d = new Date(START.getTime() + day * 86400000);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

// 确定性微扰：让曲线有真实测量的轻微波动，但每次运行结果一致。
function wobble(day, phase, scale) {
  return scale * (0.65 * Math.sin(day * 1.73 + phase) + 0.35 * Math.cos(day * 0.47 + phase * 0.7));
}

const count = db.prepare('SELECT COUNT(*) AS n FROM metrics WHERE user_id = ? AND note LIKE ?').get(USER_ID, `%${MARKER}%`).n;
if (count > 0) {
  console.log(JSON.stringify({ skipped: true, reason: 'demo series already exists', marker: MARKER, rows: count }));
  db.close();
  process.exit(0);
}

const insert = db.prepare(`
  INSERT INTO metrics
    (user_id, type, value, value2, unit, recorded_at, source, note, measurement_condition, data_quality)
  VALUES (?, ?, ?, ?, ?, ?, 'synthetic', ?, ?, ?)
`);

const rows = [];
function add(type, value, value2, unit, recordedAt, condition, note) {
  rows.push([
    USER_ID, type, Number(value.toFixed(3)), value2 == null ? null : Number(value2.toFixed(3)),
    unit, recordedAt, `${MARKER};${note}`, condition,
    JSON.stringify({ valid: true, demo: true, synthetic: true, generator: MARKER, condition }),
  ]);
}

for (let day = 0; day < DAYS; day += 1) {
  const progress = day / (DAYS - 1);
  const weekly = Math.sin((2 * Math.PI * day) / 7);
  const monthly = Math.sin((2 * Math.PI * day) / 28);

  // 血压：轻微、连续上升，保留早晚测量差异；两条曲线分别建模。
  const systolicBase = 124.2 + 6.2 * progress + 0.9 * monthly;
  const diastolicBase = 76.0 + 3.1 * progress + 0.55 * monthly;
  add('bp', systolicBase - 0.8 + wobble(day, 0.2, 0.35), diastolicBase - 0.35 + wobble(day, 0.7, 0.18), 'mmHg', at(day, 7, 30), 'morning_rest');
  add('bp', systolicBase + 0.8 + wobble(day, 1.1, 0.35), diastolicBase + 0.35 + wobble(day, 1.5, 0.18), 'mmHg', at(day, 19, 30), 'evening_rest');

  // 血糖：空腹和餐后 2 小时严格分组，不能混合拟合。
  add('glucose', 5.35 + 0.22 * progress + 0.10 * monthly + wobble(day, 2.0, 0.035), null, 'mmol/L', at(day, 7, 0), 'fasting');
  add('glucose', 7.05 + 0.28 * progress + 0.16 * monthly + wobble(day, 2.8, 0.05), null, 'mmol/L', at(day, 13, 0), 'postprandial_2h');

  // 体重与静息心率：缓慢下降，带个人日常波动。
  add('weight', 64.0 - 1.7 * progress + 0.18 * monthly + wobble(day, 3.1, 0.04), null, 'kg', at(day, 6, 30), 'morning_fasting');
  add('hr', 70.5 - 1.8 * progress + 0.7 * weekly + wobble(day, 3.7, 0.25), null, 'bpm', at(day, 6, 45), 'resting');

  // 行为指标仅用于行为模式展示，不用于精确疾病未来外推。
  add('sleep', 6.7 + 0.35 * progress + 0.22 * weekly + wobble(day, 4.2, 0.06), null, 'h', at(day, 8, 0), 'unknown');
  add('steps', 4300 + 450 * progress + 700 * weekly + wobble(day, 4.8, 50), null, '步', at(day, 23, 0), 'unknown');
  add('spo2', 96.2 + 0.15 * progress + wobble(day, 5.4, 0.18), null, '%', at(day, 8, 10), 'resting');
}

const insertMany = db.transaction(() => {
  for (const row of rows) insert.run(...row);
});
insertMany();
db.close();
console.log(JSON.stringify({ skipped: false, marker: MARKER, user_id: USER_ID, days: DAYS, rows: rows.length, source: 'synthetic', date_start: START.toISOString().slice(0, 10), date_end: '2026-08-21' }));
