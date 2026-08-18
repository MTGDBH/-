// 种子数据：写入与设计稿一致的 mock 数据
// 运行：npm run seed
import db from '../src/db.js';

console.log('🌱 开始填充种子数据...');

const now = new Date();
const todayDate = now.toISOString().slice(0, 10);
const nowISO = now.toISOString();
const timeAt = (h, m = 0) => {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const daysAgo = (n) => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d;
};
const daysAgoISO = (n, h = 8, m = 0) => {
  const d = daysAgo(n);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

// 清空表
const tables = ['sessions', 'chat_messages', 'knowledge_articles', 'alerts', 'todos', 'devices', 'assessments', 'metrics', 'users'];
for (const t of tables) db.exec(`DELETE FROM ${t};`);
const seqExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get();
if (seqExists) db.exec('DELETE FROM sqlite_sequence');

// ============= 用户 =============
// 默认账号：密码统一 123456（demo 明文；生产环境务必改用 bcrypt）
const insertUser = db.prepare(`
  INSERT INTO users (id, name, age, gender, avatar_color, height, emergency_name, emergency_phone, password)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, '123456')
`);
insertUser.run(1, '张奶奶', 72, 'female', '#7FB069', 1.60, '晓东（儿子）', '13800138001');
insertUser.run(2, '李爷爷', 75, 'male', '#9C7BC9', 1.72, '晓敏（女儿）', '13800138002');
console.log('✓ 用户：张奶奶 / 李爷爷（密码 123456）');

// ============= 健康指标（张奶奶，user_id=1） =============
// 注意：本脚本生成的全部指标均为 synthetic（项目演示数据），
// 严禁用于 XGBoost 训练 / ML 验证 / 真实健康风险结论。
const insertMetric = db.prepare(`
  INSERT INTO metrics (user_id, type, value, value2, unit, recorded_at, source)
  VALUES (1, ?, ?, ?, ?, ?, ?)
`);

insertMetric.run('bp', 128, 85, 'mmHg', timeAt(12, 30), 'synthetic');
for (let i = 1; i <= 6; i++) {
  insertMetric.run('bp', 122 + Math.round(Math.sin(i) * 8), 78 + Math.round(Math.cos(i) * 5), 'mmHg', daysAgoISO(i, 8, 0), 'synthetic');
}
insertMetric.run('glucose', 5.8, null, 'mmol/L', timeAt(7, 30), 'synthetic');
for (let i = 1; i <= 6; i++) {
  insertMetric.run('glucose', +(5.4 + Math.sin(i) * 0.6).toFixed(1), null, 'mmol/L', daysAgoISO(i, 7, 30), 'synthetic');
}
insertMetric.run('hr', 72, null, 'bpm', timeAt(11, 0), 'synthetic');
for (let i = 1; i <= 6; i++) {
  insertMetric.run('hr', 70 + Math.round(Math.sin(i) * 4), null, 'bpm', daysAgoISO(i, 11, 0), 'synthetic');
}
insertMetric.run('sleep', 7.3, null, 'h', timeAt(6, 0), 'synthetic');
for (let i = 1; i <= 6; i++) {
  insertMetric.run('sleep', +(6.8 + Math.cos(i) * 0.8).toFixed(1), null, 'h', daysAgoISO(i, 6, 0), 'synthetic');
}
insertMetric.run('spo2', 97, null, '%', timeAt(11, 30), 'synthetic');
for (let i = 1; i <= 6; i++) {
  insertMetric.run('spo2', 96 + Math.round(Math.sin(i)), null, '%', daysAgoISO(i, 11, 30), 'synthetic');
}
insertMetric.run('ecg', 100, null, 'normal', timeAt(8, 0), 'synthetic');
for (let i = 1; i <= 6; i++) {
  insertMetric.run('ecg', 100, null, 'normal', daysAgoISO(i, 8, 0), 'synthetic');
}
insertMetric.run('weight', 56.2, null, 'kg', timeAt(7, 30), 'synthetic');
for (let i = 1; i <= 6; i++) {
  insertMetric.run('weight', +(56.0 + Math.sin(i) * 0.4).toFixed(1), null, 'kg', daysAgoISO(i, 7, 30), 'synthetic');
}
insertMetric.run('steps', 4820, null, '步', timeAt(20, 0), 'synthetic');
for (let i = 1; i <= 6; i++) {
  insertMetric.run('steps', 4500 + Math.round(Math.sin(i) * 600), null, '步', daysAgoISO(i, 20, 0), 'synthetic');
}
console.log('✓ 健康指标：张奶奶，8 类 × 7 天');

// ============= 健康指标（李爷爷，user_id=2，数据较少） =============
const insM2 = db.prepare(`
  INSERT INTO metrics (user_id, type, value, value2, unit, recorded_at, source) VALUES (2, ?, ?, ?, ?, ?, 'synthetic')
`);
for (let i = 0; i < 5; i++) {
  insM2.run('bp', 138 + Math.round(Math.random()*8 - 4), 88 + Math.round(Math.random()*6 - 3), 'mmHg', daysAgoISO(i, 8, 0));
  insM2.run('hr', 75 + Math.round(Math.random()*10 - 5), null, 'bpm', daysAgoISO(i, 9, 0));
  insM2.run('spo2', 94 + Math.round(Math.random()*3), null, '%', daysAgoISO(i, 9, 0));
}

// ============= 评估（张奶奶） =============
// adl/iadl 置 NULL：当前无真实 ADL/IADL 评估数据，严禁造假值
db.prepare(`
  INSERT INTO assessments (user_id, total_score, subscores, adl, iadl, suggestions, summary, created_at)
  VALUES (1, 86, ?, NULL, NULL, ?, ?, ?)
`).run(
  JSON.stringify({ sleep: 82, nutrition: 78, activity: 85, chronic: 76 }),
  JSON.stringify([
    { icon: 'warning', title: '血压管理：低盐饮食', detail: '每日盐摄入 < 5g，多吃蔬菜' },
    { icon: 'activity', title: '规律运动：每日 30 分钟', detail: '散步、太极、广场舞任选' },
    { icon: 'sleep', title: '睡眠改善：固定作息', detail: '22:30 前入睡，7 小时为目标' },
  ]),
  '综合睡眠、营养、活动、慢病控制维度评估，整体良好，血压需持续关注。',
  new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
);
console.log('✓ 健康评估：张奶奶 1 条');

// ============= 今日待办（张奶奶） =============
const insertTodo = db.prepare(`
  INSERT INTO todos (user_id, title, time, kind, completed, completed_at, date) VALUES (1, ?, ?, ?, ?, ?, ?)
`);
insertTodo.run('服用降压药', '08:00', 'medication', 1, timeAt(8, 5), todayDate);
insertTodo.run('测量血压', '12:00', 'todo', 0, null, todayDate);
insertTodo.run('户外散步 30 分钟', '16:00', 'exercise', 0, null, todayDate);
insertTodo.run('服用降压药（晚）', '18:00', 'medication', 0, null, todayDate);
insertTodo.run('服用钙片', '21:00', 'medication', 0, null, todayDate);
console.log('✓ 今日待办：5 条');

// ============= 设备 =============
const insertDev = db.prepare(`
  INSERT INTO devices (user_id, name, kind, status, last_sync) VALUES (1, ?, ?, ?, ?)
`);
insertDev.run('智能手环', 'watch', 'connected', timeAt(12, 20));
insertDev.run('电子血压计', 'bp_monitor', 'connected', timeAt(12, 30));
insertDev.run('智能体重秤', 'scale', 'disconnected', null);
console.log('✓ 设备：3 个');

// ============= 预警 =============
db.prepare(`INSERT INTO alerts (user_id, metric_type, severity, title, message) VALUES
  (1, 'hr', 'warning', '心率偏高提醒', '昨晚 22:30 心率 92 bpm'),
  (1, 'bp', 'info', '血压趋势需关注', '近 3 日收缩压均值 132 mmHg'),
  (1, 'spo2', 'info', '已连续记录 7 天血氧', '数据完整，谢谢配合'),
  (1, 'sleep', 'warning', '昨晚睡眠偏短', '仅 5h30m，建议今天午休 30 分钟')
`).run();
console.log('✓ 预警：4 条');

// ============= 对话历史 =============
const insertChat = db.prepare(`
  INSERT INTO chat_messages (user_id, role, content, created_at) VALUES (1, ?, ?, ?)
`);
insertChat.run('assistant',
  '张奶奶，早上好！我已经看过你今早的血压和昨晚的心率数据，整体稳定。不过收缩压有点偏高，要不要我帮你出一份今天的调理方案？',
  new Date(Date.now() - 2 * 3600 * 1000).toISOString());
insertChat.run('user', '好的，帮我看看今天该怎么调',
  new Date(Date.now() - 110 * 60 * 1000).toISOString());
insertChat.run('assistant',
  '好的，我给你定制了 5 步方案：\n1. 饮食：早餐少盐，多吃蔬菜\n2. 运动：午后散步 30 分钟\n3. 作息：22:30 前准备入睡\n4. 用药：18:00 服用降压药\n5. 复查：下周三 9:00 心内科',
  new Date(Date.now() - 105 * 60 * 1000).toISOString());
console.log('✓ 对话历史：3 条');

// ============= 健康知识文章 =============
const insertArt = db.prepare(`
  INSERT INTO knowledge_articles (category, title, summary, body, tags, audience, view_count)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const articles = [
  {
    category: 'topic',
    title: '老年人如何在家监测血压',
    summary: '掌握四个关键，让家庭血压测量更准确',
    body: `## 为什么要在家里测血压？

很多人只在医院测血压，这样容易出现"白大衣高血压"——一见到医生就紧张，反而测出偏高的数。在家测量更接近真实状态。

## 测量的四个关键

1. **选对时间**：早晨起床后 1 小时内、服药前、吃早餐前；晚上睡前各一次
2. **姿势正确**：坐位，背靠椅背，双脚平放地上 5 分钟再测
3. **袖带位置**：袖带下缘在肘弯上 2-3 厘米，松紧以能插入一指为宜
4. **连续测 3 次**：每次间隔 1 分钟，取后 2 次的平均值

## 什么样的数值算正常？

- 收缩压（高压）：90-130 mmHg
- 舒张压（低压）：60-85 mmHg

如果连续一周超过 135/85，建议带上记录去看医生。
`,
    tags: ['高血压', '血压计', '测量'],
    audience: 'senior',
    views: 120,
  },
  {
    category: 'topic',
    title: '老年人控盐三步法，每天少吃 3 克',
    summary: '少盐不是没味道，三个方法让饭菜有滋有味',
    body: `## 为什么要控盐？

盐里的钠会让血压升高。世界卫生组织建议：成年人每天盐摄入 < 5 克（约一啤酒盖）。但大多数老人每天吃 10 克以上。

## 三步控盐法

### 第一步：减少"看得见"的盐

- 做饭时少放 1/3 盐
- 用限盐勺（药店有售）
- 少吃咸菜、腊肉、酱料

### 第二步：警惕"看不见"的盐

- 挂面、面包、饼干里都有盐
- 一包方便面的盐接近一天总量
- 看包装上的"钠"含量：超过 30% NRV 就要警惕

### 第三步：用"提味"代替"加盐"

- 葱、姜、蒜、醋、柠檬
- 香菇、海带、香菜
- 花椒、八角、桂皮（少量）

## 一周见效

坚持一周，你会发现：原来饭菜也可以这么好吃。
`,
    tags: ['饮食', '高血压', '减盐'],
    audience: 'senior',
    views: 89,
  },
  {
    category: 'topic',
    title: '摔倒别慌张，三个动作保平安',
    summary: '学会"自我保护 + 起身"两步，关键时刻少受伤',
    body: `## 摔倒时的自我保护

1. **顺势侧滚**：摔倒瞬间顺着惯性侧滚，不要用手撑（易骨折）
2. **保护头部**：双手抱头蜷曲身体
3. **静待 30 秒**：评估哪里痛，再决定如何起来

## 如何自己起身

1. 翻身俯卧
2. 双膝跪地
3. 双手撑地
4. 慢慢爬到椅子或沙发旁
5. 双手撑椅子扶手，慢慢站起

## 起不来怎么办？

1. 找到电话或呼叫器
2. 大声呼救或敲击地板
3. 盖上保暖衣物，等待救援
4. 保持镇静，节省体力

## 预防胜于救治

- 家里保持灯光明亮
- 卫生间装扶手
- 不穿松垮的拖鞋
- 雨雪天减少外出
`,
    tags: ['摔倒', '急救', '安全'],
    audience: 'senior',
    views: 230,
  },
  {
    category: 'qa',
    title: 'Q：血压是越低越好吗？',
    summary: '血压低也会出毛病，了解"低血压"的危害',
    body: `**A：** 不是。血压过低会让脑供血不足，引起头晕、乏力、甚至晕倒。

## 哪些情况算低血压？

- 收缩压 < 90 mmHg
- 舒张压 < 60 mmHg
- 站着时头晕，眼前发黑

## 常见原因

1. 降压药过量
2. 喝水太少（脱水）
3. 长期卧床突然起身
4. 心功能不全

## 怎么处理？

- 起身慢一点，先坐 30 秒再站
- 每天喝水 1500-2000 ml
- 早餐加一点盐（咨询医生）
- 严重时联系医生调药

如有晕倒史，建议佩戴紧急呼叫设备。
`,
    tags: ['血压', '低血压', '头晕'],
    audience: 'senior',
    views: 67,
  },
  {
    category: 'qa',
    title: 'Q：智能手环测的心率准吗？',
    summary: '手腕式 vs 胸带 vs 医疗级，差别在哪？',
    body: `**A：** 静息状态下，手腕式智能手环精度可达 ±3 bpm，日常监测够用；但运动中、医疗诊断仍需医用设备。

## 三种心率监测对比

| 类型 | 精度 | 场景 |
|---|---|---|
| 智能手环 | ±3 bpm | 日常、散步 |
| 胸带式 | ±1 bpm | 运动训练 |
| 心电监护仪 | ±0.5 bpm | 医疗诊断 |

## 什么时候不能信手环？

- 剧烈运动（手腕抖动干扰）
- 皮肤干燥寒冷（接触不良）
- 黑色纹身（光吸收异常）

## 出现"心率不齐"提示怎么办？

- 先休息 10 分钟再测一次
- 还是异常，记录时间和症状，联系医生
`,
    tags: ['心率', '智能手环', '设备'],
    audience: 'senior',
    views: 56,
  },
  {
    category: 'topic',
    title: '糖尿病一日三餐怎么吃',
    summary: '主食减半、菜多加、肉适量，三步稳住血糖',
    body: `## 主食减半

白米饭、面条、馒头——这些精制碳水升糖最快。可以换成：
- 杂粮饭（糙米、燕麦、藜麦）
- 玉米、红薯、山药
- 全麦面包

每餐主食总量不超过自己拳头大小。

## 菜多加

每餐至少 2 种蔬菜，先吃菜再吃饭，能减缓血糖上升速度。

## 肉适量

鸡、鱼、瘦肉每天 100-150g（约手掌大小），少选肥肉和加工肉。

## 三餐时间

早餐 7:00-8:00  
午餐 12:00-13:00  
晚餐 18:00-19:00（睡前 3 小时吃完）

## 加餐原则

两餐之间（10:00、15:00）可以加一份：
- 一小把坚果
- 一杯无糖酸奶
- 一份水果（200g 以下）

## 控糖"红灯"

- 糖：白砂糖、含糖饮料、糕点
- 油：油炸食品
- 烟酒：直接升高血糖、损伤血管
`,
    tags: ['糖尿病', '饮食', '血糖'],
    audience: 'senior',
    views: 145,
  },
  {
    category: 'tip',
    title: '5 个动作，每天 5 分钟',
    summary: '不需出门，在家就能做的晨间拉伸',
    body: `## 动作 1：颈部旋转（1 分钟）

头缓慢左转 5 次，右转 5 次。动作要慢，肩膀放松。

## 动作 2：肩部环绕（1 分钟）

双手搭肩，肘部画圆向前 10 次，向后 10 次。

## 动作 3：原地踏步（1 分钟）

手臂配合摆动，膝盖抬高但不猛烈。

## 动作 4：坐姿抬腿（1 分钟）

坐椅子上，双腿交替抬起，膝盖尽量伸直。

## 动作 5：深呼吸（1 分钟）

吸气 4 秒，屏住 4 秒，呼气 6 秒。重复 5-10 次。

## 注意事项

- 饭后 1 小时再做
- 每个动作感觉到"舒服的拉伸"即可，不强求标准
- 关节痛、刚做完手术、心脏不好的先咨询医生
`,
    tags: ['运动', '拉伸', '居家'],
    audience: 'senior',
    views: 178,
  },
  {
    category: 'qa',
    title: 'Q：什么时候该去医院？',
    summary: '四个"红旗信号"，出现任何一个立即就医',
    body: `**A：** 健康监测是辅助，**出现以下情况请立即去医院**：

## 🚩 四个红旗信号

1. **胸痛**：持续 5 分钟以上，含服救心丸不缓解
2. **半身无力**：一边胳膊/腿突然没力气，嘴角歪斜
3. **说话不清**：说不清话、口齿含糊
4. **剧烈头痛**：突然出现、像爆炸一样的

## 其他要看医生的情况

- 持续高烧 3 天不退
- 一周体重突然下降 2 公斤以上
- 夜间呼吸困难，要坐起来才能喘气
- 反复咳嗽超过 2 周
- 大便颜色变黑或带血

## 别等"扛一扛就过去了"

很多严重疾病（心梗、脑梗）的早期信号很轻，错过去就晚了。
`,
    tags: ['就医', '急救', '红旗信号'],
    audience: 'senior',
    views: 312,
  },
];

for (const a of articles) {
  insertArt.run(a.category, a.title, a.summary, a.body, JSON.stringify(a.tags), a.audience, a.views);
}
console.log(`✓ 健康知识文章：${articles.length} 篇`);

console.log('\n🎉 种子数据完成！');
console.log('   启动 API:    npm start');
console.log('   重置数据:    npm run reset');
console.log('   演示账号:    张奶奶 / 123456');
console.log('                李爷爷 / 123456\n');
