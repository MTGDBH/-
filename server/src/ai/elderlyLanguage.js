const METRIC_NAMES = Object.freeze({
  systo: '高压（收缩压）',
  diasto: '低压（舒张压）',
  bp: '血压',
  pulse: '心率',
  hr: '心率',
  glucose: '血糖',
  weight: '体重',
  sleep: '睡眠',
  steps: '步数',
  spo2: '血氧',
  temp: '体温',
  resp: '呼吸频率',
  bmi: '体重指数',
  hba1c: '糖化血红蛋白',
  cholesterol: '胆固醇',
  uricacid: '尿酸',
});

const UNIT_NAMES = Object.freeze({
  mmHg: '毫米汞柱',
  bpm: '次/分',
  kg: '千克',
  'mmol/L': '毫摩尔/升',
  h: '小时',
  celsius: '摄氏度',
  '°C': '℃',
});

export function metricName(value) {
  const key = String(value || '').trim().toLowerCase();
  return METRIC_NAMES[key] || String(value || '健康指标');
}

export function unitName(value) {
  const raw = String(value || '').trim();
  return UNIT_NAMES[raw] || UNIT_NAMES[raw.toLowerCase()] || raw;
}

// 只处理已经准备展示给用户的文本，不修改数据库字段或工具参数。
export function localizeVisibleText(value) {
  let text = String(value || '');
  const replacements = [
    [/\bsysto\b/gi, METRIC_NAMES.systo], [/\bdiasto\b/gi, METRIC_NAMES.diasto],
    [/\bpulse\b/gi, METRIC_NAMES.pulse], [/\bglucose\b/gi, METRIC_NAMES.glucose],
    [/\bweight\b/gi, METRIC_NAMES.weight], [/\bsleep\b/gi, METRIC_NAMES.sleep],
    [/\bsteps\b/gi, METRIC_NAMES.steps], [/\bspo2\b/gi, METRIC_NAMES.spo2],
    [/\bresp\b/gi, METRIC_NAMES.resp], [/\btemp\b/gi, METRIC_NAMES.temp],
    [/\bBMI\b/g, METRIC_NAMES.bmi], [/\bHbA1c\b/gi, METRIC_NAMES.hba1c],
    [/mmHg/gi, UNIT_NAMES.mmHg], [/mmol\s*\/\s*L/gi, UNIT_NAMES['mmol/L']],
    [/\bbpm\b/gi, UNIT_NAMES.bpm], [/\bkg\b/gi, UNIT_NAMES.kg],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text;
}
