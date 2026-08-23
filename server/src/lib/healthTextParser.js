const CN_DIGITS = { 零: 0, '〇': 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS = { 十: 10, 百: 100, 千: 1000 };
const N = '([0-9]+(?:\\.[0-9]+)?(?:个?半)?|[零〇一二两三四五六七八九十百千点]+(?:个?半)?)';

export function parseChineseNumber(rawValue) {
  const raw = String(rawValue ?? '').trim().replace(/个/g, '');
  if (!raw) return null;
  const arabic = Number(raw);
  if (Number.isFinite(arabic)) return arabic;

  const hasHalf = raw.endsWith('半');
  const withoutHalf = hasHalf ? raw.slice(0, -1) : raw;
  const [integerPart, decimalPart] = withoutHalf.split('点');
  let integer = 0;

  if (integerPart) {
    if (/^[一二两三四五六七八九]百[一二两三四五六七八九]$/.test(integerPart)) {
      integer = CN_DIGITS[integerPart[0]] * 100 + CN_DIGITS[integerPart[2]] * 10;
    } else if (Number.isFinite(Number(integerPart))) {
      integer = Number(integerPart);
    } else {
      const hasUnit = [...integerPart].some(char => CN_UNITS[char]);
      if (!hasUnit && [...integerPart].every(char => char in CN_DIGITS)) {
      integer = Number([...integerPart].map(char => CN_DIGITS[char]).join(''));
      } else {
        let pending = 0;
        for (const char of integerPart) {
          if (char in CN_DIGITS) pending = CN_DIGITS[char];
          if (char in CN_UNITS) {
            integer += (pending || 1) * CN_UNITS[char];
            pending = 0;
          }
        }
        integer += pending;
      }
    }
  }

  let decimal = 0;
  if (decimalPart) {
    const digits = [...decimalPart].map(char => CN_DIGITS[char]).filter(value => value !== undefined);
    if (digits.length) decimal = Number(`0.${digits.join('')}`);
  }
  const result = integer + decimal + (hasHalf ? 0.5 : 0);
  return Number.isFinite(result) ? result : null;
}

function splitFusedBloodPressure(rawValue) {
  const raw = String(rawValue ?? '').replace(/\s+/g, '');
  const candidates = [];
  for (let index = 1; index < raw.length; index += 1) {
    const left = parseChineseNumber(raw.slice(0, index));
    const right = parseChineseNumber(raw.slice(index));
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    if (left < 70 || left > 250 || right < 30 || right > 180 || left <= right) continue;
    const pulsePressure = left - right;
    if (pulsePressure < 15 || pulsePressure > 120) continue;
    const score = Math.abs(left - 125) + Math.abs(right - 80) + Math.abs(pulsePressure - 45) * 0.25;
    candidates.push({ value: left, value2: right, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] || null;
}

function findBloodPressure(text) {
  let match = new RegExp(`血压(?:是|为|测得|测了)?\\s*${N}(?:\\s*(?:/|／|比|和)\\s*|\\s+)${N}`, 'i').exec(text);
  if (match) return { value: numberFrom(match, 1), value2: numberFrom(match, 2), matched_text: match[0], mode: 'explicit_pair' };

  match = new RegExp(`${N}\\s*(?:/|／|比|和)\\s*${N}[^。；]{0,8}血压`, 'i').exec(text);
  if (match) return { value: numberFrom(match, 1), value2: numberFrom(match, 2), matched_text: match[0], mode: 'explicit_pair_reversed' };

  match = new RegExp(`(?:高压|收缩压)(?:是|为)?\\s*${N}[^0-9零〇一二两三四五六七八九十百千]{0,12}(?:低压|舒张压)(?:是|为)?\\s*${N}`, 'i').exec(text);
  if (match) return { value: numberFrom(match, 1), value2: numberFrom(match, 2), matched_text: match[0], mode: 'named_pair' };

  const mentionPattern = new RegExp(`血压(?:是|为|测得|测了)?\\s*${N}`, 'ig');
  const mentions = [...text.matchAll(mentionPattern)];
  for (let index = mentions.length - 1; index >= 0; index -= 1) {
    const fused = splitFusedBloodPressure(mentions[index][1]);
    if (fused) return { ...fused, matched_text: mentions[index][0], mode: 'spoken_fused' };
  }
  for (let index = 0; index < mentions.length - 1; index += 1) {
    const value = numberFrom(mentions[index]);
    const value2 = numberFrom(mentions[index + 1]);
    if (value >= 70 && value <= 250 && value2 >= 30 && value2 <= 180 && value > value2) {
      return { value, value2, matched_text: `${mentions[index][0]}，${mentions[index + 1][0]}`, mode: 'repeated_spoken_pair' };
    }
  }
  return null;
}

function numberFrom(match, index = 1) {
  return match ? parseChineseNumber(match[index]) : null;
}

function conditionFor(type, text) {
  if (type === 'glucose') {
    if (/餐后\s*(?:2|二|两)\s*(?:个)?小时|餐后两小时/.test(text)) return 'postprandial_2h';
    if (/空腹/.test(text)) return 'fasting';
    if (/随机/.test(text)) return 'random';
  }
  if (type === 'hr') return /静息|休息/.test(text) ? 'resting' : 'unknown';
  if (type === 'bp') {
    if (/早上|早晨|晨起/.test(text) && /静坐|静息|休息/.test(text)) return 'morning_rest';
    if (/晚上|晚间|傍晚/.test(text) && /静坐|静息|休息/.test(text)) return 'evening_rest';
  }
  if (type === 'weight') return /晨起空腹|早上空腹/.test(text) ? 'morning_fasting' : 'unknown';
  return 'unknown';
}

const SINGLE_RULES = [
  ['glucose', '血糖', 'mmol/L', new RegExp(`(?:空腹|随机|餐后\\s*(?:2|二|两)\\s*(?:个)?小时)?\\s*血糖(?:是|为|测得|测了)?\\s*${N}`, 'i'), 1, 33],
  ['hr', '心率', 'bpm', new RegExp(`(?:静息|休息时)?\\s*(?:心率|脉搏)(?:是|为|测得|测了)?\\s*${N}`, 'i'), 20, 220],
  ['spo2', '血氧', '%', new RegExp(`(?:血氧(?:饱和度)?|氧饱和度)(?:是|为|测得|测了)?\\s*${N}`, 'i'), 50, 100],
  ['weight', '体重', 'kg', new RegExp(`体重(?:是|为|测得|称了)?\\s*${N}`, 'i'), 20, 200],
  ['temp', '体温', '°C', new RegExp(`体温(?:是|为|测得|量了)?\\s*${N}`, 'i'), 30, 45],
  ['sleep', '睡眠', 'h', new RegExp(`(?:昨晚)?\\s*(?:睡眠(?:时长)?|睡了|睡觉睡了)(?:是|为)?\\s*${N}\\s*(?:小时|h)`, 'i'), 0, 24],
  ['steps', '步数', '步', new RegExp(`(?:步数(?:是|为)?|(?:今天)?(?:走了|走路))\\s*${N}\\s*步`, 'i'), 0, 100000],
  ['resp', '呼吸频率', '次/分', new RegExp(`(?:静息)?\\s*(?:呼吸频率|每分钟呼吸)(?:是|为)?\\s*${N}`, 'i'), 5, 60],
  ['grip', '握力', 'kg', new RegExp(`握力(?:是|为|测得)?\\s*${N}`, 'i'), 0, 100],
  ['bodyfat', '体脂率', '%', new RegExp(`体脂(?:率)?(?:是|为|测得)?\\s*${N}`, 'i'), 5, 70],
  ['waist', '腰围', 'cm', new RegExp(`腰围(?:是|为|测得)?\\s*${N}`, 'i'), 30, 200],
  ['uricacid', '尿酸', 'μmol/L', new RegExp(`尿酸(?:是|为|测得)?\\s*${N}`, 'i'), 50, 1200],
  ['cholesterol', '胆固醇', 'mmol/L', new RegExp(`(?:总)?胆固醇(?:是|为|测得)?\\s*${N}`, 'i'), 1, 20],
  ['hba1c', '糖化血红蛋白', '%', new RegExp(`糖化(?:血红蛋白)?(?:是|为|测得)?\\s*${N}`, 'i'), 3, 20],
  ['egfr', 'eGFR', 'mL/min/1.73m²', new RegExp(`(?:eGFR|肾小球滤过率)(?:是|为|测得)?\\s*${N}`, 'i'), 0, 200],
  ['creatinine', '肌酐', 'μmol/L', new RegExp(`肌酐(?:是|为|测得)?\\s*${N}`, 'i'), 10, 2000],
  ['urine_albumin', '尿白蛋白', 'mg/g', new RegExp(`尿白蛋白(?:肌酐比)?(?:是|为|测得)?\\s*${N}`, 'i'), 0, 10000],
];

export function parseHealthDescription(input) {
  const text = String(input ?? '').replace(/[，,；;。！!？?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { records: [], warnings: ['请先说出或输入健康数据。'], parser_version: 'health_text_v1' };
  if (text.length > 2000) throw new Error('TEXT_TOO_LONG');

  const records = [];
  const warnings = [];
  const seen = new Set();
  const add = record => {
    if (!seen.has(record.type)) {
      seen.add(record.type);
      records.push(record);
    }
  };

  const bloodPressure = findBloodPressure(text);
  if (bloodPressure) {
    const { value, value2 } = bloodPressure;
    if (value >= 50 && value <= 250 && value2 >= 30 && value2 <= 180) {
      add({ type: 'bp', label: '血压', value, value2, unit: 'mmHg', measurement_condition: conditionFor('bp', text), matched_text: bloodPressure.matched_text, confidence: bloodPressure.mode.includes('spoken') ? 'medium' : 'high', parse_mode: bloodPressure.mode });
    } else warnings.push('识别到了血压，但数值超出可录入范围，请核对。');
  } else if (/血压|高压|低压|收缩压|舒张压/.test(text)) {
    warnings.push('血压需要同时包含高压和低压，例如“血压128/85”。');
  }

  for (const [type, label, unit, pattern, min, max] of SINGLE_RULES) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = numberFrom(match);
    if (value === null || value < min || value > max) {
      warnings.push(`${label}数值超出可录入范围，请核对。`);
      continue;
    }
    add({ type, label, value, value2: null, unit, measurement_condition: conditionFor(type, match[0]), matched_text: match[0], confidence: 'high' });
  }

  if (/昨天|前天|上周|早上|上午|中午|下午|晚上|昨晚/.test(text)) {
    warnings.push('描述中的日期或时段不会自动改写记录时间；确认后按当前时间保存。');
  }
  if (!records.length && !warnings.length) warnings.push('没有识别出可保存的指标，请参考示例补充指标名称和数值。');
  return { records, warnings, parser_version: 'health_text_v1', original_text: text };
}
