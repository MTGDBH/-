// 张奶奶长期模拟数据集：仅用于本地产品测试，所有新增健康数据均标记 synthetic-long-term。
import db from '../src/db.js';
import { evaluateHealth } from '../src/lib/scoring.js';
import { scoreIntake, INTAKE_SCHEMA_VERSION } from '../src/lib/intake.js';

const DATASET = 'zhang-long-term-v1';
const user = db.prepare("SELECT * FROM users WHERE name = '张奶奶' ORDER BY id LIMIT 1").get();
if (!user) throw new Error('未找到张奶奶，请先运行基础 seed');
const userId = Number(user.id);
const now = new Date();
const dayMs = 86400000;
const round = (value, digits = 0) => Number(value.toFixed(digits));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const atDay = (daysAgo, hour = 8, minute = 0) => {
  const date = new Date(now.getTime() - daysAgo * dayMs);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};
const dateOnly = daysAgo => atDay(daysAgo).slice(0, 10);

const metricRows = [];
const addMetric = (daysAgo, type, value, value2, unit, hour, note = '长期模拟数据') => {
  metricRows.push({ userId, type, value, value2, unit, recordedAt: atDay(daysAgo, hour), note: `${note} · ${DATASET}` });
};

// 365 天日常数据：早期控制欠佳，随后改善，最近 30 天有轻度反弹。
for (let daysAgo = 364; daysAgo >= 0; daysAgo -= 1) {
  const elapsed = 364 - daysAgo;
  const progress = elapsed / 364;
  const recent = elapsed > 334 ? (elapsed - 334) / 30 : 0;
  const weekly = Math.sin(elapsed * Math.PI * 2 / 7);
  const monthly = Math.sin(elapsed * Math.PI * 2 / 31);
  const bpEpisode = daysAgo >= 116 && daysAgo <= 119 ? 22 : 0;
  const glucoseEpisode = daysAgo === 117 ? 2.6 : 0;
  const sys = clamp(148 - 14 * progress + 7 * recent + 3.5 * weekly + bpEpisode, 112, 178);
  const dia = clamp(90 - 8 * progress + 3.5 * recent + 2.2 * monthly + bpEpisode * .45, 68, 108);
  const glucose = clamp(7.6 - 1.2 * progress + .35 * recent + .28 * weekly + glucoseEpisode, 4.8, 10.5);
  const hr = clamp(75 - 2 * progress + 2.8 * weekly + 1.2 * monthly, 60, 88);
  const sleep = clamp(6.1 + .8 * progress - .45 * recent + .3 * monthly, 5.1, 7.5);
  const steps = clamp(2800 + 2200 * progress - 650 * recent + 520 * weekly, 1500, 6500);

  addMetric(daysAgo, 'bp', round(sys), round(dia), 'mmHg', 7, bpEpisode ? '漏服药后短期偏高（模拟事件）' : '晨起静息测量');
  addMetric(daysAgo, 'glucose', round(glucose, 1), null, 'mmol/L', 6, glucoseEpisode ? '聚餐后次日空腹偏高（模拟事件）' : '空腹血糖');
  addMetric(daysAgo, 'hr', round(hr), null, 'bpm', 7, '晨起静息心率');
  addMetric(daysAgo, 'sleep', round(sleep, 1), null, 'h', 6, '昨夜睡眠时长');
  addMetric(daysAgo, 'steps', round(steps), null, '步', 20, '全天步数');

  if (daysAgo % 2 === 0) addMetric(daysAgo, 'spo2', round(clamp(96.5 + 1.1 * weekly, 94, 99)), null, '%', 9, '家庭指夹血氧');
  if (daysAgo % 3 === 0) {
    addMetric(daysAgo, 'temp', round(36.45 + .12 * monthly, 1), null, '°C', 9, '家庭体温');
    addMetric(daysAgo, 'resp', round(17 + 1.2 * weekly), null, '次/分', 9, '静息呼吸频率');
  }
  if (daysAgo % 7 === 0) {
    const weight = 66 - 2 * progress + .6 * recent + .18 * monthly;
    addMetric(daysAgo, 'weight', round(weight, 1), null, 'kg', 7, '晨起空腹体重');
    addMetric(daysAgo, 'waist', round(95 - 3.5 * progress + .8 * recent + .3 * monthly, 1), null, 'cm', 7, '腰围');
    addMetric(daysAgo, 'bodyfat', round(35.5 - 2 * progress + .5 * recent + .25 * monthly, 1), null, '%', 7, '体脂率');
  }
  if (daysAgo % 30 === 0) {
    addMetric(daysAgo, 'grip', round(20.2 + 1.5 * progress - .3 * recent, 1), null, 'kg', 10, '右手握力');
    addMetric(daysAgo, 'cholesterol', round(6.3 - .8 * progress + .18 * recent, 1), null, 'mmol/L', 10, '门诊复查总胆固醇');
    addMetric(daysAgo, 'uricacid', round(392 - 22 * progress + 9 * monthly), null, 'μmol/L', 10, '门诊复查尿酸');
  }
  if (daysAgo % 60 === 0) {
    addMetric(daysAgo, 'creatinine', round(82 - 3 * progress + 2 * monthly), null, 'μmol/L', 10, '肾功能复查');
    addMetric(daysAgo, 'egfr', round(72 + 4 * progress - 1.5 * monthly), null, 'mL/min/1.73m²', 10, '估算肾小球滤过率');
    addMetric(daysAgo, 'urine_albumin', round(22 - 4 * progress + 2 * monthly, 1), null, 'mg/g', 10, '尿白蛋白肌酐比');
  }
  if (daysAgo % 90 === 0) addMetric(daysAgo, 'hba1c', round(7.5 - .8 * progress + .15 * recent, 1), null, '%', 10, '季度糖化血红蛋白');
}

const transaction = db.transaction(() => {
  // 只替换本数据集或基础种子中的模拟数据，不删除用户手工/设备记录。
  db.prepare("DELETE FROM metrics WHERE user_id=? AND source IN ('synthetic','synthetic-long-term')").run(userId);
  db.prepare("DELETE FROM prediction_inputs WHERE user_id=? AND source IN ('synthetic','synthetic-long-term')").run(userId);
  db.prepare("DELETE FROM assessments WHERE user_id=? AND summary LIKE '【模拟长期数据】%'").run(userId);
  db.prepare("DELETE FROM todos WHERE user_id=? AND kind='synthetic'").run(userId);
  db.prepare("DELETE FROM alerts WHERE user_id=? AND title LIKE '【模拟】%'").run(userId);
  db.prepare("DELETE FROM discovery_events WHERE user_id=? AND event_key LIKE 'synthetic.%'").run(userId);
  db.prepare("DELETE FROM devices WHERE user_id=? AND name LIKE '模拟设备-%'").run(userId);
  db.prepare("DELETE FROM agent_memories WHERE subject_user_id=? AND memory_key LIKE 'synthetic.%'").run(userId);

  const oldConversations = db.prepare("SELECT id FROM agent_conversations WHERE actor_user_id=? AND legacy_key LIKE 'synthetic-zhang-%'").all(userId);
  for (const conversation of oldConversations) db.prepare('DELETE FROM chat_messages WHERE conversation_id=?').run(conversation.id);
  db.prepare("DELETE FROM agent_conversations WHERE actor_user_id=? AND legacy_key LIKE 'synthetic-zhang-%'").run(userId);

  const oldIntakes = db.prepare("SELECT id FROM health_intakes WHERE subject_user_id=? AND scores LIKE '%\"_synthetic_dataset\":\"zhang-long-term-v1\"%'").all(userId);
  for (const intake of oldIntakes) db.prepare('DELETE FROM health_intake_answers WHERE intake_id=?').run(intake.id);
  db.prepare("DELETE FROM health_intakes WHERE subject_user_id=? AND scores LIKE '%\"_synthetic_dataset\":\"zhang-long-term-v1\"%'").run(userId);

  db.prepare(`UPDATE users SET age=72,gender='female',height=1.60,education_level=2,
    smoking_status=0,cigarettes_per_day=0,drinking_status=0,drinking_frequency=0,
    exercise_level=2,self_rated_health=3,chronic_diabetes=1,chronic_hypertension=1,
    chronic_heart=0,chronic_stroke=0,dyslipidemia=1,lung_disease=0,chronic_kidney=0,
    frailty_score=.22,fall_risk=1,cognitive_status='normal',sleep_quality=2,
    family_history=? WHERE id=?`).run(JSON.stringify({ hypertension: true, diabetes: true, stroke: false }), userId);

  const insertMetric = db.prepare(`INSERT INTO metrics
    (user_id,type,value,value2,unit,recorded_at,source,note,measurement_condition,data_quality,measurement_context)
    VALUES (?,?,?,?,?,?,'synthetic-long-term',?,?,'synthetic_test',?)`);
  const conditions = { bp: 'morning_rest', glucose: 'fasting', hr: 'resting', weight: 'morning_fasting' };
  for (const row of metricRows) insertMetric.run(row.userId, row.type, row.value, row.value2, row.unit, row.recordedAt,
    row.note, conditions[row.type] || 'unknown', JSON.stringify({ dataset: DATASET, purpose: 'local_product_testing' }));

  const baseAnswers = {
    self_rated_health: 4, what_matters: 'chronic', known_hypertension: 1, known_diabetes: 1,
    known_heart_disease: 0, known_stroke: 0, smoking_status: 0, drinking_status: 0,
    exercise_minutes: 150, adl_dressing: 0, adl_bathing: 0, adl_eating: 0,
    adl_bed: 0, adl_toilet: 0, adl_continence: 0, iadl_shopping: 1,
    iadl_cooking: 0, iadl_medication: 0, iadl_money: 0, iadl_housework: 0,
    fall_recent: 0, cesd_bothered: 1, cesd_concentrate: 1, cesd_depressed: 0,
    cesd_effort: 1, cesd_hopeful: 2, cesd_fearful: 0, cesd_sleep: 1,
    cesd_happy: 2, cesd_lonely: 0, cesd_cannot_go: 0, memory_concern: 0,
    support_available: 1, stroke_face: 0, stroke_arm: 0, stroke_speech: 0, chest_pain: 0,
  };
  const intakeSnapshots = [
    { daysAgo: 270, changes: { self_rated_health: 3, exercise_minutes: 70, adl_bathing: 1, iadl_housework: 1, fall_recent: 1, cesd_depressed: 1, cesd_lonely: 1 } },
    { daysAgo: 180, changes: { self_rated_health: 3, exercise_minutes: 100, iadl_housework: 1, fall_recent: 0 } },
    { daysAgo: 90, changes: { exercise_minutes: 160 } },
    { daysAgo: 0, changes: { exercise_minutes: 125, cesd_sleep: 2 } },
  ];
  const insertIntake = db.prepare(`INSERT INTO health_intakes
    (subject_user_id,actor_user_id,respondent_role,schema_version,status,scores,recorded_at)
    VALUES (?,?,'self',?,'completed',?,?)`);
  const insertAnswer = db.prepare('INSERT INTO health_intake_answers (intake_id,question_id,value) VALUES (?,?,?)');
  for (const snapshot of intakeSnapshots) {
    const answers = { ...baseAnswers, ...snapshot.changes };
    const scored = scoreIntake(answers);
    const scores = { ...scored.scores, _synthetic_dataset: DATASET };
    const recordedAt = snapshot.daysAgo === 0 ? new Date(now.getTime() - 1000).toISOString() : atDay(snapshot.daysAgo, 15);
    const result = insertIntake.run(userId, userId, INTAKE_SCHEMA_VERSION, JSON.stringify(scores), recordedAt);
    for (const [questionId, value] of Object.entries(scored.answers)) insertAnswer.run(result.lastInsertRowid, questionId, JSON.stringify(value));
  }

  const latestScored = scoreIntake({ ...baseAnswers, ...intakeSnapshots.at(-1).changes }).scores;
  const insertPrediction = db.prepare(`INSERT INTO prediction_inputs (user_id,field,value,recorded_at,source)
    VALUES (?,?,?,?,'synthetic-long-term')`);
  for (const [field, value] of Object.entries({
    cesd10: latestScored.cesd10, total_cognition: 17, adlab_c: latestScored.adlab_c,
    iadl: latestScored.iadl, fall_down: latestScored.fall_down, srh: latestScored.srh_charls,
  })) if (value != null) insertPrediction.run(userId, field, value, atDay(0, 15));

  // 过去一年每月形成一次评分快照。
  const insertAssessment = db.prepare(`INSERT INTO assessments
    (user_id,total_score,subscores,adl,iadl,suggestions,summary,created_at) VALUES (?,?,?,?,?,?,?,?)`);
  for (let daysAgo = 330; daysAgo >= 0; daysAgo -= 30) {
    const end = new Date(atDay(daysAgo, 23));
    const start = new Date(end.getTime() - 7 * dayMs);
    const windowMetrics = metricRows.filter(row => {
      const time = new Date(row.recordedAt);
      return time >= start && time <= end;
    });
    const evaluation = evaluateHealth(windowMetrics, { height: 1.6 });
    if (evaluation.total_score == null) continue;
    insertAssessment.run(userId, evaluation.total_score, JSON.stringify(evaluation.subscores), 0, 1,
      JSON.stringify(evaluation.suggestions), `【模拟长期数据】${evaluation.summary}`, end.toISOString());
  }

  const today = dateOnly(0);
  const insertTodo = db.prepare(`INSERT INTO todos (user_id,title,time,kind,completed,completed_at,date)
    VALUES (?,?,?,?,?,?,?)`);
  insertTodo.run(userId, '服用降压药', '08:00', 'synthetic', 1, atDay(0, 8, 5), today);
  insertTodo.run(userId, '测量晨起血压', '08:30', 'synthetic', 1, atDay(0, 8, 35), today);
  insertTodo.run(userId, '午后散步 30 分钟', '16:00', 'synthetic', 0, null, today);
  insertTodo.run(userId, '服用降糖药', '18:00', 'synthetic', 0, null, today);
  insertTodo.run(userId, '记录睡前状态', '21:30', 'synthetic', 0, null, today);

  db.prepare(`INSERT INTO devices (user_id,name,kind,status,last_sync) VALUES
    (?,'模拟设备-家用血压计','bp_monitor','connected',?),
    (?,'模拟设备-智能手环','wearable','connected',?),
    (?,'模拟设备-血糖仪','glucose_meter','connected',?)`)
    .run(userId, atDay(0, 7, 5), userId, atDay(0, 20), userId, atDay(0, 6, 35));

  const insertAlert = db.prepare(`INSERT INTO alerts (user_id,metric_type,severity,title,message,status,created_at)
    VALUES (?,?,?,?,?,?,?)`);
  insertAlert.run(userId, 'bp', 'warning', '【模拟】近期血压有回升趋势', '最近 30 天收缩压较前期略有回升，建议固定时间继续监测并核对服药情况。', 'pending', atDay(0, 9));
  insertAlert.run(userId, 'sleep', 'info', '【模拟】近期睡眠时间减少', '近一个月平均睡眠较前期下降，请关注夜间醒来和白天精神状态。', 'pending', atDay(1, 9));
  insertAlert.run(userId, 'glucose', 'warning', '【模拟】空腹血糖仍需关注', '长期趋势虽有改善，但近期空腹血糖仍高于理想管理目标。', 'resolved', atDay(30, 9));

  const insertDiscovery = db.prepare(`INSERT INTO discovery_events
    (user_id,event_key,kind,severity,title,message,action,source_type,rule_version,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  insertDiscovery.run(userId, 'synthetic.bp.rebound', 'trend', 'warning', '血压近期出现回升',
    '过去一年总体改善，但最近 30 天收缩压和舒张压均有轻度回升。', '继续固定条件复测并核对用药', 'synthetic_dataset', DATASET, 'open', atDay(0, 9));
  insertDiscovery.run(userId, 'synthetic.activity.sleep', 'trend', 'info', '活动和睡眠同步下降',
    '最近一个月步数和睡眠时长同时下降，可先排查天气、疼痛或作息变化。', '逐步恢复规律活动和作息', 'synthetic_dataset', DATASET, 'open', atDay(1, 9));

  const conversations = [
    ['最近血压有点高', '我最近几天血压又高了一点，是不是药没效果？', '从长期记录看，过去一年总体在改善，但最近一个月确实有回升。先确认是否按时服药、测量条件是否一致，并连续记录；若持续偏高，请联系医生调整方案，不要自行改药。'],
    ['夜里总是醒', '最近夜里会醒两三次，白天也不太精神。', '近期睡眠记录较前期减少。可以先固定起床时间、减少晚间饮水和长时间午睡；如果伴打鼾憋醒、胸闷或白天嗜睡明显，建议进一步咨询医生。'],
    ['复查血糖怎么看', '这次糖化血红蛋白比以前低了一些，算控制住了吗？', '糖化血红蛋白趋势有改善，但仍需要结合空腹血糖、饮食和医生给您的个体目标判断。继续规律记录，不要因为一次改善自行停药。'],
    ['帮我安排散步', '我膝盖偶尔不舒服，怎么安排散步比较合适？', '可以从平地慢走 15 分钟开始，分早晚两次；以不明显加重疼痛为限。若出现关节肿胀、明显疼痛或步态不稳，应暂停并咨询专业人员。'],
  ];
  const insertConversation = db.prepare(`INSERT INTO agent_conversations
    (actor_user_id,subject_user_id,title,summary,status,legacy_key,created_at,updated_at)
    VALUES (?,?,?,?,'active',?,?,?)`);
  const insertMessage = db.prepare(`INSERT INTO chat_messages
    (user_id,role,content,conversation_id,actor_user_id,subject_user_id,provider,model,call_status,presentation,created_at)
    VALUES (?,?,?,?,?,?,'mock','synthetic-history','success','{\"mode\":\"plain\"}',?)`);
  conversations.forEach(([title, question, answer], index) => {
    const daysAgo = 12 - index * 3;
    const createdAt = atDay(daysAgo, 10);
    const result = insertConversation.run(userId, userId, `【模拟】${title}`, `{"dataset":"${DATASET}"}`,
      `synthetic-zhang-${index + 1}`, createdAt, createdAt);
    insertMessage.run(userId, 'user', question, result.lastInsertRowid, userId, userId, createdAt);
    insertMessage.run(userId, 'assistant', answer, result.lastInsertRowid, userId, userId, atDay(daysAgo, 10, 1));
  });

  const insertMemory = db.prepare(`INSERT INTO agent_memories
    (subject_user_id,actor_user_id,category,memory_key,content,status,confirmed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'confirmed',?,?,?)`);
  const memoryTime = atDay(5, 10);
  insertMemory.run(userId, userId, 'health_condition', 'synthetic.conditions', '已确诊高血压、2型糖尿病和血脂异常，按医嘱长期管理。', memoryTime, memoryTime, memoryTime);
  insertMemory.run(userId, userId, 'preference', 'synthetic.walking', '更愿意在下午四点左右散步，膝关节偶尔不适。', memoryTime, memoryTime, memoryTime);
  insertMemory.run(userId, userId, 'support', 'synthetic.family_support', '儿子晓东会协助复诊和核对用药。', memoryTime, memoryTime, memoryTime);
});

transaction();
db.pragma('optimize');

const counts = Object.fromEntries(['metrics','assessments','health_intakes','prediction_inputs','todos','alerts','discovery_events','agent_conversations','agent_memories']
  .map(table => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'health_intakes' ? 'subject_user_id' : table === 'agent_conversations' ? 'subject_user_id' : table === 'agent_memories' ? 'subject_user_id' : 'user_id'}=?`).get(userId).count]));
console.log(JSON.stringify({
  ok: true,
  dataset: DATASET,
  user: { id: userId, name: '张奶奶', diagnoses: ['高血压', '2型糖尿病', '血脂异常'] },
  period: { from: dateOnly(364), to: dateOnly(0), days: 365 },
  generated_metrics: metricRows.length,
  totals_after_seed: counts,
}, null, 2));
