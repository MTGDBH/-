// 40 个账号 + 健康指标压测/演示数据。
// 只写入名称以“系统测试老人”开头的账号，以及 note 以 loadtest-40- 开头的指标，
// 不会清理张奶奶、李爷爷或其他已有演示数据。
// 运行：Node 22 server/data/load_test_dataset.js
import db from '../src/db.js';
import bcrypt from 'bcryptjs';

const PASSWORD = bcrypt.hashSync(process.env.DEMO_PASSWORD || '123456', 12);
const PREFIX = '系统测试老人';
const NOTE_PREFIX = 'loadtest-40-20260820';
const DAY_MS = 24 * 3600 * 1000;
const now = new Date();
const end = new Date(now.getTime() - 60 * 60 * 1000); // 避免生成“未来测量值”

const colors = ['#F4A261', '#E76F51', '#7FB069', '#6C8EBF', '#B084CC', '#E9A368'];
const profiles = [
  ...Array.from({ length: 10 }, () => 'stable'),
  ...Array.from({ length: 8 }, () => 'hypertension'),
  ...Array.from({ length: 8 }, () => 'diabetes'),
  ...Array.from({ length: 6 }, () => 'mixed'),
  ...Array.from({ length: 4 }, () => 'sparse'),
  ...Array.from({ length: 4 }, () => 'recovery'),
];

const round = (value, digits = 1) => +Number(value).toFixed(digits);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const noise = (id, day, scale) => Math.sin(id * 1.731 + day * 1.217) * scale + Math.cos(id * 0.613 - day * 0.487) * scale * 0.35;
const measuredAt = (day, offsetHours = 0) => new Date(end.getTime() - day * DAY_MS - offsetHours * 3600 * 1000).toISOString();

function profileValues(profile, id, elapsed, day) {
  const n = (scale) => noise(id, day, scale);
  let bp = 124 + n(1.3);
  let diasto = 78 + n(1.0);
  let glucose = 5.7 + n(0.12);
  let sleep = 7.1 + n(0.25);
  let spo2 = 97 + n(0.4);
  let weight = 62 + n(0.25);
  let hr = 70 + n(2.0);
  let steps = 5200 + n(500);

  if (profile === 'hypertension') {
    bp = 136 + elapsed * 0.43 + n(2.1);
    diasto = 84 + elapsed * 0.16 + n(1.5);
    hr = 74 + n(2.5);
    sleep = 6.7 + n(0.35);
  } else if (profile === 'diabetes') {
    bp = 128 + elapsed * 0.10 + n(1.7);
    diasto = 80 + n(1.2);
    glucose = 6.8 + elapsed * 0.055 + n(0.25);
    sleep = 6.6 + n(0.35);
    weight = 70 + elapsed * 0.06 + n(0.35);
  } else if (profile === 'mixed') {
    bp = 139 + elapsed * 0.30 + n(2.2);
    diasto = 86 + elapsed * 0.15 + n(1.7);
    glucose = 7.0 + elapsed * 0.06 + n(0.3);
    sleep = 6.1 + n(0.45);
    spo2 = 94.5 + n(0.55);
    weight = 78 + elapsed * 0.08 + n(0.4);
    steps = 3300 + n(600);
  } else if (profile === 'recovery') {
    bp = 151 - elapsed * 0.50 + n(1.8);
    diasto = 92 - elapsed * 0.24 + n(1.3);
    glucose = 6.8 - elapsed * 0.025 + n(0.16);
    sleep = 6.4 + elapsed * 0.025 + n(0.3);
  }

  // 给少量完整账号加入可解释的真实波动，测试异常点标记和预警逻辑。
  if (profile === 'hypertension' && day === 7) { bp += 16; diasto += 8; }
  if (profile === 'diabetes' && day === 12) glucose += 1.8;
  if (profile === 'mixed' && day === 5) spo2 -= 2.2;

  return {
    bp: round(clamp(bp, 90, 220), 1),
    diasto: round(clamp(diasto, 55, 130), 1),
    glucose: round(clamp(glucose, 3.5, 18), 2),
    sleep: round(clamp(sleep, 3.5, 10), 2),
    spo2: round(clamp(spo2, 88, 100), 1),
    weight: round(clamp(weight, 40, 130), 2),
    hr: round(clamp(hr, 45, 130), 1),
    steps: Math.round(clamp(steps, 500, 15000)),
  };
}

const insertUser = db.prepare(`
  INSERT INTO users (name, age, gender, avatar_color, height, emergency_name, emergency_phone, password, password_algo)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'bcrypt')
`);
const updateUser = db.prepare(`
  UPDATE users SET age = ?, gender = ?, avatar_color = ?, height = ?, emergency_name = ?, emergency_phone = ?, password = ?, password_algo='bcrypt'
  WHERE id = ?
`);
const insertMetric = db.prepare(`
  INSERT INTO metrics (user_id, type, value, value2, unit, recorded_at, source, note)
  VALUES (?, ?, ?, ?, ?, ?, 'synthetic', ?)
`);
const insertDevice = db.prepare(`
  INSERT INTO devices (user_id, name, kind, status, last_sync)
  VALUES (?, ?, ?, ?, ?)
`);

const generated = db.transaction(() => {
  const users = [];
  for (let i = 0; i < profiles.length; i += 1) {
    const id = i + 1;
    const name = `${PREFIX}${String(id).padStart(2, '0')}`;
    const profile = profiles[i];
    const age = 60 + ((id * 3) % 21);
    const gender = id % 2 ? 'female' : 'male';
    const height = round(1.52 + ((id * 7) % 25) / 100, 2);
    const phone = `1390004${String(id).padStart(4, '0')}`;
    const emergencyPhone = `1380004${String(id).padStart(4, '0')}`;
    const existing = db.prepare('SELECT id FROM users WHERE name = ?').get(name);
    const userId = existing?.id || insertUser.run(
      name, age, gender, colors[i % colors.length], height, `${name}家属`, emergencyPhone, PASSWORD,
    ).lastInsertRowid;
    if (existing) updateUser.run(age, gender, colors[i % colors.length], height, `${name}家属`, emergencyPhone, PASSWORD, userId);

    // 仅清理本脚本自己的可重复数据，避免重跑时产生重复曲线。
    db.prepare("DELETE FROM metrics WHERE user_id = ? AND note LIKE 'loadtest-40-%'").run(userId);
    db.prepare("DELETE FROM devices WHERE user_id = ? AND name LIKE '测试设备-%'").run(userId);

    const pointDays = profile === 'sparse' ? 5 : 31;
    for (let day = 0; day < pointDays; day += 1) {
      const elapsed = pointDays - 1 - day;
      const v = profileValues(profile, id, elapsed, day);
      const note = `${NOTE_PREFIX}-${profile}`;
      insertMetric.run(userId, 'bp', v.bp, v.diasto, 'mmHg', measuredAt(day, 0), note);
      insertMetric.run(userId, 'glucose', v.glucose, null, 'mmol/L', measuredAt(day, 0.2), note);
      insertMetric.run(userId, 'hr', v.hr, null, 'bpm', measuredAt(day, 0.4), note);
      insertMetric.run(userId, 'sleep', v.sleep, null, 'h', measuredAt(day, 0.6), note);
      insertMetric.run(userId, 'spo2', v.spo2, null, '%', measuredAt(day, 0.8), note);
      insertMetric.run(userId, 'weight', v.weight, null, 'kg', measuredAt(day, 1.0), note);
      insertMetric.run(userId, 'steps', v.steps, null, '步', measuredAt(day, 1.2), note);
      if (day % 7 === 0) {
        const hba1c = profile === 'diabetes' || profile === 'mixed' ? 7.1 + (elapsed * 0.01) : 5.7 + nudge(id, day, 0.12);
        const cholesterol = profile === 'mixed' ? 6.3 + nudge(id, day, 0.15) : 5.0 + nudge(id, day, 0.12);
        const uricacid = profile === 'mixed' ? 460 + nudge(id, day, 18) : 330 + nudge(id, day, 14);
        insertMetric.run(userId, 'hba1c', round(clamp(hba1c, 4, 12), 2), null, '%', measuredAt(day, 1.4), note);
        insertMetric.run(userId, 'cholesterol', round(clamp(cholesterol, 3, 10), 2), null, 'mmol/L', measuredAt(day, 1.5), note);
        insertMetric.run(userId, 'uricacid', round(clamp(uricacid, 150, 800), 1), null, 'μmol/L', measuredAt(day, 1.6), note);
      }
    }
    insertDevice.run(userId, `测试设备-${String(id).padStart(2, '0')}`, 'watch', id % 9 === 0 ? 'disconnected' : 'connected', measuredAt(0, 0.1));
    users.push({ id: userId, name, profile, pointDays, phone });
  }
  return users;
});

// 小幅确定性扰动，避免实验室指标完全重合。
function nudge(id, day, scale) {
  return Math.sin(id * 1.91 + day * 0.73) * scale;
}

const users = generated();
const metricRows = db.prepare("SELECT COUNT(*) AS count FROM metrics WHERE note LIKE 'loadtest-40-%'").get().count;
const deviceRows = db.prepare("SELECT COUNT(*) AS count FROM devices WHERE name LIKE '测试设备-%'").get().count;
console.log(JSON.stringify({ ok: true, users: users.length, metrics: metricRows, devices: deviceRows, password: PASSWORD, profiles: users.reduce((acc, u) => { acc[u.profile] = (acc[u.profile] || 0) + 1; return acc; }, {}) }, null, 2));
