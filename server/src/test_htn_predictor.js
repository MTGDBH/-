// ============================================================
// htnPredictor.js 内部测试（Phase 2.2）
// 运行: node server/src/test_htn_predictor.js
// 无测试框架，纯 node 直接执行；退出码 0=全过 / 1=有失败
// ============================================================
import 'dotenv/config'; // 加载 server/.env（HTN_PYTHON 指向装有 xgboost 的解释器）
import { predictHtn, buildHtnPredictionInput, HTN_FEATURES } from './lib/htnPredictor.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
};

const FULL = {
  systo: 130, diasto: 85, pulse: 72, bmi: 24, mwaist: 85,
  lgrip: 25, rgrip: 27, bl_glu: 100, bl_hbalc: 5.6, bl_cho: 200, bl_ua: 6, sleep: 7,
};

console.log('=== A. 完整 12 指标 ===');
const ra = await predictHtn(FULL);
ok('success=true', ra.success === true, JSON.stringify(ra));
ok('risk_probability ∈[0,1]', typeof ra.risk_probability === 'number' && ra.risk_probability >= 0 && ra.risk_probability <= 1);
ok('risk_level 合法', ['lower_than_threshold', 'higher_than_threshold'].includes(ra.risk_level));
console.log('  ', JSON.stringify(ra));

console.log('=== B. 血检缺失 ===');
const rb = await predictHtn({ ...FULL, bl_glu: null, bl_hbalc: null, bl_cho: null, bl_ua: null });
ok('success=true', rb.success === true);
ok('missing_features 含血检', ['bl_glu', 'bl_hbalc', 'bl_cho', 'bl_ua'].every(f => rb.missing_features?.includes(f)), JSON.stringify(rb.missing_features));

console.log('=== C. sleep 缺失 ===');
const rc = await predictHtn({ ...FULL, sleep: null });
ok('success=true', rc.success === true);
ok('missing 含 sleep', rc.missing_features?.includes('sleep'));

console.log('=== D. 单位转换 (buildHtnPredictionInput) ===');
// APP metrics 结构（与 GET /api/health/metrics 一致）
const appMetrics = {
  bp: { value: 130, value2: 85 }, hr: { value: 72 }, weight: { value: 60 },
  waist: { value: 85 }, grip: { value: 25 },
  glucose: { value: 6.0 },        // mmol/L → 108 mg/dl
  hba1c: { value: 5.6 },          // % 不变
  cholesterol: { value: 5.2 },    // mmol/L → 5.2×38.67 = 201.084
  uricacid: { value: 360 },       // μmol/L → 360/59.48 = 6.0525
  sleep: { value: 7 },
};
const mapped = buildHtnPredictionInput(appMetrics, { height: 1.6 });
ok('bl_glu 换算 ×18', Math.abs(mapped.bl_glu - 108) < 1e-3, `got ${mapped.bl_glu}`);
ok('bl_cho 换算 ×38.67', Math.abs(mapped.bl_cho - 201.084) < 1e-3, `got ${mapped.bl_cho}`);
ok('bl_ua 换算 ÷59.48', Math.abs(mapped.bl_ua - 360 / 59.48) < 1e-3, `got ${mapped.bl_ua}`);
ok('bmi 由 weight/height² 推导', Math.abs(mapped.bmi - 60 / (1.6 * 1.6)) < 1e-3, `got ${mapped.bmi}`);
ok('bp value/value2 → systo/diasto', mapped.systo === 130 && mapped.diasto === 85);
ok('grip → lgrip/rgrip 双侧', mapped.lgrip === 25 && mapped.rgrip === 25);
ok('缺失字段为 null', mapped.bl_hbalc === 5.6 && buildHtnPredictionInput({}).bmi === null);

console.log('=== E. Python 返回错误（非法值）===');
const re = await predictHtn({ ...FULL, systo: 'bad' });
ok('success=false', re.success === false);
ok('error 为字符串（Python 校验消息）', typeof re.error === 'string' && re.error.includes('systo'), JSON.stringify(re.error));
const re2 = await predictHtn({ ...FULL, systo: 400 });
ok('生理越界被拒', re2.success === false && String(re2.error).includes('超出合理范围'));

console.log('=== F. spawn 错误 / 超时 ===');
const savedPy = process.env.HTN_PYTHON;
process.env.HTN_PYTHON = '/nonexistent/python_xyz';
const rf = await predictHtn(FULL);
ok('Python 不存在 → PYTHON_NOT_FOUND', rf.success === false && rf.error?.code === 'PYTHON_NOT_FOUND', JSON.stringify(rf.error));
process.env.HTN_PYTHON = savedPy;

const savedT = process.env.HTN_TIMEOUT_MS;
process.env.HTN_TIMEOUT_MS = '100'; // Python 冷启动通常 >100ms，用于触发超时
const rt = await predictHtn(FULL);
ok('超时 → PYTHON_TIMEOUT', rt.success === false && rt.error?.code === 'PYTHON_TIMEOUT', JSON.stringify(rt.error));
process.env.HTN_TIMEOUT_MS = savedT;

console.log('=== G. 连续 3 次调用结果一致 ===');
const probs = [];
for (let i = 0; i < 3; i++) {
  const r = await predictHtn(FULL);
  probs.push(r.risk_probability);
}
ok('3 次 risk_probability 一致', new Set(probs).size === 1, JSON.stringify(probs));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
