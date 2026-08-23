// Versioned, server-scored elderly health intake. Question wording mirrors the
// CHARLS feature semantics while keeping model field names away from the UI.
import db from '../db.js';

export const INTAKE_SCHEMA_VERSION = 'elderly-intake.v1';

const yesNo = [{ value: 0, label: '没有' }, { value: 1, label: '有' }];
const difficulty = [
  { value: 0, label: '可以独立完成' },
  { value: 1, label: '有些困难或需要帮助' },
];
const frequency = [
  { value: 0, label: '很少或没有' }, { value: 1, label: '偶尔' },
  { value: 2, label: '经常' }, { value: 3, label: '几乎每天' },
];

const sections = [
  { id: 'basic', title: '基本情况', description: '先了解你的日常感受' },
  { id: 'history', title: '既往疾病', description: '已经确诊的疾病不再计算“新发风险”' },
  { id: 'lifestyle', title: '生活方式', description: '不确定的题目可以跳过' },
  { id: 'function', title: '日常能力与跌倒', description: '用于发现需要家属协助的情况' },
  { id: 'mood', title: '情绪、记忆与支持', description: '最近一周的真实感受即可' },
  { id: 'urgent', title: '现在是否不舒服', description: '突发症状优先处理，不等待模型预测' },
];

const q = (id, section, prompt, type, options = null, extra = {}) => ({ id, section, prompt, type, options, optional: true, ...extra });
export const intakeQuestions = [
  q('self_rated_health', 'basic', '总的来说，你觉得自己现在的健康怎么样？', 'choice', [
    { value: 1, label: '很差' }, { value: 2, label: '较差' }, { value: 3, label: '一般' },
    { value: 4, label: '较好' }, { value: 5, label: '很好' },
  ]),
  q('what_matters', 'basic', '你现在最希望改善哪件事？', 'choice', [
    { value: 'mobility', label: '走路和活动' }, { value: 'sleep', label: '睡眠' },
    { value: 'mood', label: '心情' }, { value: 'chronic', label: '慢病管理' },
    { value: 'independence', label: '保持生活独立' },
  ]),
  ...[['known_hypertension','高血压'],['known_diabetes','糖尿病'],['known_heart_disease','心脏病'],['known_stroke','脑卒中']]
    .map(([id, name]) => q(id, 'history', `医生是否已经告诉你患有${name}？`, 'choice', yesNo)),
  q('smoking_status', 'lifestyle', '你现在吸烟吗？', 'choice', yesNo),
  q('drinking_status', 'lifestyle', '你现在经常饮酒吗？', 'choice', yesNo),
  q('exercise_minutes', 'lifestyle', '你一周大约活动多少分钟？', 'number', null, { min: 0, max: 1260, step: 10, unit: '分钟' }),
  ...[['adl_dressing','穿衣'],['adl_bathing','洗澡'],['adl_eating','吃饭'],['adl_bed','上下床'],['adl_toilet','上厕所'],['adl_continence','控制大小便']]
    .map(([id, label]) => q(id, 'function', `${label}时是否有困难？`, 'choice', difficulty)),
  ...[['iadl_shopping','外出购物'],['iadl_cooking','准备饭菜'],['iadl_medication','按时服药'],['iadl_money','管理钱款'],['iadl_housework','做家务']]
    .map(([id, label]) => q(id, 'function', `${label}是否有困难？`, 'choice', difficulty)),
  q('fall_recent', 'function', '最近一年是否跌倒过？', 'choice', yesNo),
  ...[
    ['cesd_bothered','被小事困扰'],['cesd_concentrate','难以集中注意'],['cesd_depressed','感到情绪低落'],
    ['cesd_effort','做事费力'],['cesd_hopeful','对未来有希望'],['cesd_fearful','感到害怕'],
    ['cesd_sleep','睡眠不好'],['cesd_happy','感到愉快'],['cesd_lonely','感到孤独'],['cesd_cannot_go','觉得无法继续'],
  ].map(([id, label]) => q(id, 'mood', `最近一周，你是否${label}？`, 'choice', frequency)),
  q('memory_concern', 'mood', '你或家人是否发现记忆、思考能力有明显变化？', 'choice', yesNo),
  q('support_available', 'mood', '需要时，是否有人能帮助你？', 'choice', yesNo),
  q('stroke_face', 'urgent', '现在是否突然出现一侧脸歪或麻木？', 'choice', yesNo),
  q('stroke_arm', 'urgent', '现在是否突然出现一侧手臂无力或麻木？', 'choice', yesNo),
  q('stroke_speech', 'urgent', '现在是否突然说话含糊、听不懂别人说话？', 'choice', yesNo),
  q('chest_pain', 'urgent', '现在是否有持续胸痛、胸闷并伴大汗或明显气短？', 'choice', yesNo),
];

const numeric = value => value === '' || value == null ? null : Number(value);
const scoreDomain = (answers, ids) => ids.every(id => answers[id] != null)
  ? ids.reduce((sum, id) => sum + Number(Number(answers[id]) === 1), 0)
  : null;

export function scoreIntake(rawAnswers = {}) {
  const answers = {};
  const definitions = new Map(intakeQuestions.map(item => [item.id, item]));
  for (const [id, raw] of Object.entries(rawAnswers)) {
    const def = definitions.get(id);
    if (!def) continue;
    if (def.type === 'number') {
      const value = numeric(raw);
      if (Number.isFinite(value) && value >= def.min && value <= def.max) answers[id] = value;
    } else if (def.options?.some(option => String(option.value) === String(raw))) {
      const option = def.options.find(item => String(item.value) === String(raw));
      answers[id] = option.value;
    }
  }
  const negativeMood = ['cesd_bothered','cesd_concentrate','cesd_depressed','cesd_effort','cesd_fearful','cesd_sleep','cesd_lonely','cesd_cannot_go'];
  const positiveMood = ['cesd_hopeful','cesd_happy'];
  const adlItems = ['adl_dressing','adl_bathing','adl_eating','adl_bed','adl_toilet','adl_continence'];
  const iadlItems = ['iadl_shopping','iadl_cooking','iadl_medication','iadl_money','iadl_housework'];
  const moodValues = [...negativeMood, ...positiveMood].map(id => numeric(answers[id]));
  const cesdComplete = moodValues.every(Number.isFinite);
  const cesd10 = cesdComplete
    ? negativeMood.reduce((sum, id) => sum + Number(answers[id]), 0) + positiveMood.reduce((sum, id) => sum + (3 - Number(answers[id])), 0)
    : null;
  return {
    answers,
    scores: {
      adlab_c: scoreDomain(answers, adlItems),
      iadl: scoreDomain(answers, iadlItems),
      cesd10,
      fall_down: numeric(answers.fall_recent),
      // App coding is good=5; CHARLS model coding is poor=5.
      self_rated_health: numeric(answers.self_rated_health),
      srh_charls: answers.self_rated_health == null ? null : 6 - Number(answers.self_rated_health),
    },
  };
}

export function canActFor(subjectUserId, actorUserId) {
  if (Number(subjectUserId) === Number(actorUserId)) return { allowed: true, role: 'self' };
  const relationship = db.prepare(`SELECT id, member_role FROM care_relationships
    WHERE senior_id = ? AND member_id = ? AND status = 'active'`).get(subjectUserId, actorUserId);
  return relationship ? { allowed: true, role: 'caregiver', relationship_id: relationship.id } : { allowed: false };
}

export function intakeSchema() {
  return { schema_version: INTAKE_SCHEMA_VERSION, sections, questions: intakeQuestions };
}
