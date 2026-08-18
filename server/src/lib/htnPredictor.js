// ============================================================
// 高血压风险预测服务：Node.js → Python predict_htn.py → XGBoost
//
// 职责：
//   - 通过 child_process.spawn 异步调用 ml/predict_htn.py（stdin/stdout JSON）
//   - 单位换算（APP 存储单位 → 模型期望单位，仅调用层转换，不改数据库）
//   - 完整错误处理：spawn 失败 / 非0退出 / 超时 / stdout 空 / JSON 解析失败 /
//     Python 返回 success=false → 一律转为结构化对象，绝不外泄 traceback
//
// 配置：
//   HTN_PYTHON       Python 解释器路径（推荐显式设置）；缺省用 python/python3
//   HTN_TIMEOUT_MS   单次预测超时毫秒数，默认 5000
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 项目根目录（server/src/lib → 上溯 3 级），禁止写死盘符路径
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PREDICT_SCRIPT = path.join(PROJECT_ROOT, 'ml', 'predict_htn.py');
const DEFAULT_TIMEOUT_MS = 5000;

// 模型期望的 12 个特征字段（顺序与训练一致）
export const HTN_FEATURES = [
  'systo', 'diasto', 'pulse', 'bmi', 'mwaist', 'lgrip', 'rgrip',
  'bl_glu', 'bl_hbalc', 'bl_cho', 'bl_ua', 'sleep',
];

// ---------- 单位换算常量（APP 存储单位 → CHARLS/模型单位）----------
// 模型在 CHARLS 数据上训练，血检字段单位: bl_glu/bl_cho = mg/dl, bl_ua = mg/dl
const GLUCOSE_MMOL_TO_MGDL = 18;          // mmol/L × 18 → mg/dl
const CHOL_MMOL_TO_MGDL = 38.67;          // mmol/L × 38.67 → mg/dl
const URIC_UMOL_TO_MGDL = 59.48;          // μmol/L ÷ 59.48 → mg/dl

/** 解析 Python 解释器：优先环境变量 HTN_PYTHON，未设置用 python/python3 */
function resolvePython() {
  const envPy = process.env.HTN_PYTHON;
  if (envPy && envPy.trim()) return envPy.trim();
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * APP metrics → 模型 12 特征
 * @param {object} metrics  GET /api/health/metrics 返回结构的对象
 *                         每项: { type: { value, value2, ... } | null }
 * @param {object} [opts]   { height: 身高(m)，BMI 计算用 }
 * @returns {object}        模型 12 特征对象（缺失字段为 null）
 *
 * 映射规则（source/device 等元数据不参与）：
 *   systo  ← bp.value      收缩压
 *   diasto ← bp.value2     舒张压
 *   pulse  ← hr.value      心率
 *   bmi    ← weight.value/(height²)  由身高体重推导，不入库
 *   mwaist ← waist.value   腰围
 *   lgrip/rgrip ← grip.value  APP 仅采集单手握力，暂填双侧（后续可扩展左右手分项）
 *   bl_glu ← glucose.value × 18        (mmol/L → mg/dl)
 *   bl_hbalc ← hba1c.value             (% 已是模型单位)
 *   bl_cho ← cholesterol.value × 38.67 (mmol/L → mg/dl)
 *   bl_ua  ← uricacid.value ÷ 59.48    (μmol/L → mg/dl)
 *   sleep  ← sleep.value    睡眠小时
 */
export function buildHtnPredictionInput(metrics, opts = {}) {
  const m = metrics || {};
  const bp = m.bp || null;
  const height = opts.height || null;
  const weight = m.weight?.value ?? null;
  const glucose = m.glucose?.value ?? null;
  const cholesterol = m.cholesterol?.value ?? null;
  const uricacid = m.uricacid?.value ?? null;
  const grip = m.grip?.value ?? null;

  return {
    systo: bp?.value ?? null,
    diasto: bp?.value2 ?? null,
    pulse: m.hr?.value ?? null,
    // BMI: 仅当身高体重都可用时计算，否则 null（走模型原生缺失）
    bmi: (weight != null && height) ? +(weight / (height * height)).toFixed(4) : null,
    mwaist: m.waist?.value ?? null,
    lgrip: grip,
    rgrip: grip,
    bl_glu: glucose != null ? +(glucose * GLUCOSE_MMOL_TO_MGDL).toFixed(4) : null,
    bl_hbalc: m.hba1c?.value ?? null,
    bl_cho: cholesterol != null ? +(cholesterol * CHOL_MMOL_TO_MGDL).toFixed(4) : null,
    bl_ua: uricacid != null ? +(uricacid / URIC_UMOL_TO_MGDL).toFixed(4) : null,
    sleep: m.sleep?.value ?? null,
  };
}

/**
 * 调用 Python 预测工具（异步，永不 reject；错误以结构化对象返回）
 * @param {object} input 12 特征对象
 * @returns {Promise<object>} 成功: Python 原始输出（success/risk_probability/...）
 *                            传输失败: { success:false, error:{ code, message } }
 */
export function predictHtn(input) {
  return new Promise((resolve) => {
    let payload;
    try {
      payload = JSON.stringify(input);
    } catch (e) {
      return resolve({ success: false, error: { code: 'PYTHON_INTERNAL', message: '输入无法序列化为 JSON' } });
    }

    const python = resolvePython();
    const timeoutMs = parseInt(process.env.HTN_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10);

    let child;
    try {
      child = spawn(python, [PREDICT_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return resolve({ success: false, error: { code: 'PYTHON_NOT_FOUND', message: `无法启动 Python: ${e.message}` } });
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };

    // 超时：杀掉子进程并返回明确错误
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* 已退出则忽略 */ }
      done({ success: false, error: { code: 'PYTHON_TIMEOUT', message: `Python 预测超时（${timeoutMs}ms）` } });
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (err) => {
      clearTimeout(timer);
      done({ success: false, error: { code: 'PYTHON_NOT_FOUND', message: `Python 启动失败: ${err.message}` } });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        return done({ success: false, error: { code: 'PYTHON_EXIT', message: `Python 退出码 ${code}: ${stderr.slice(0, 300)}` } });
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        return done({ success: false, error: { code: 'PYTHON_EMPTY_OUTPUT', message: 'Python 无输出' } });
      }
      try {
        const parsed = JSON.parse(trimmed);
        // Python 内部校验失败（success:false + 字符串 error）原样透传
        return done(parsed);
      } catch {
        return done({ success: false, error: { code: 'PYTHON_BAD_OUTPUT', message: 'Python 输出无法解析为 JSON' } });
      }
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}
