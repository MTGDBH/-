// 为演示序列补齐起始锚点（2026-05-23），使覆盖跨度达到 Curve V2 的 90 天条件。
// 仅追加 synthetic 演示数据，不覆盖既有记录。
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const db = new Database(path.resolve(__dirname, 'app.db'));
const userId = 1;
const marker = 'demo_curve_v2_anchor_20260821';
const date = '2026-05-23';
const exists = db.prepare('SELECT COUNT(*) AS n FROM metrics WHERE user_id = ? AND note LIKE ?').get(userId, `%${marker}%`).n;
if (exists) {
  console.log(JSON.stringify({ skipped: true, rows: exists, marker }));
  db.close();
  process.exit(0);
}

const insert = db.prepare(`
  INSERT INTO metrics
    (user_id, type, value, value2, unit, recorded_at, source, note, measurement_condition, data_quality)
  VALUES (?, ?, ?, ?, ?, ?, 'synthetic', ?, ?, ?)
`);
const rows = [
  ['bp', 124.0, 75.8, 'mmHg', `${date}T07:30:00.000Z`, 'morning_rest'],
  ['bp', 125.2, 76.4, 'mmHg', `${date}T19:30:00.000Z`, 'evening_rest'],
  ['glucose', 5.34, null, 'mmol/L', `${date}T07:00:00.000Z`, 'fasting'],
  ['glucose', 7.02, null, 'mmol/L', `${date}T13:00:00.000Z`, 'postprandial_2h'],
  ['weight', 64.02, null, 'kg', `${date}T06:30:00.000Z`, 'morning_fasting'],
  ['hr', 70.6, null, 'bpm', `${date}T06:45:00.000Z`, 'resting'],
  ['sleep', 6.68, null, 'h', `${date}T08:00:00.000Z`, 'unknown'],
  ['steps', 4250, null, '步', `${date}T23:00:00.000Z`, 'unknown'],
  ['spo2', 96.1, null, '%', `${date}T08:10:00.000Z`, 'resting'],
];
const tx = db.transaction(() => {
  for (const [type, value, value2, unit, recordedAt, condition] of rows) {
    insert.run(
      userId, type, value, value2, unit, recordedAt,
      `${marker};demo_curve_v2_20260821`, condition,
      JSON.stringify({ valid: true, demo: true, synthetic: true, generator: marker, condition }),
    );
  }
});
tx();
db.close();
console.log(JSON.stringify({ skipped: false, marker, rows: rows.length, date }));
