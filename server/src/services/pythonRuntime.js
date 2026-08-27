import { spawn } from 'node:child_process';
import path from 'node:path';
import { observePythonResult, recordCircuitOpen } from './opsMetrics.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const circuit = { failures: 0, openUntil: 0, lastError: null };
const FAILURE_THRESHOLD = Math.max(2, Number(process.env.PYTHON_CIRCUIT_FAILURES || 3));
const COOLDOWN_MS = Math.max(5_000, Number(process.env.PYTHON_CIRCUIT_COOLDOWN_MS || 30_000));

function safeError(code, message) { return { success: false, error: { code, message } }; }
function timeoutValue(override) { return Math.max(100, Number(override || process.env.HTN_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)); }

async function callService(scriptPath, input, timeoutMs) {
  const base = String(process.env.PYTHON_SERVICE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  if (Date.now() < circuit.openUntil) { recordCircuitOpen(); return safeError('PYTHON_CIRCUIT_OPEN', 'Python 服务暂时降级'); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/run`, {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: path.basename(scriptPath), input, timeout_ms: timeoutMs }),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const result = await response.json();
    circuit.failures = 0; circuit.openUntil = 0; circuit.lastError = null;
    return result;
  } catch (error) {
    circuit.failures += 1; circuit.lastError = error.name === 'AbortError' ? 'timeout' : 'unavailable';
    if (circuit.failures >= FAILURE_THRESHOLD) circuit.openUntil = Date.now() + COOLDOWN_MS;
    return safeError(error.name === 'AbortError' ? 'PYTHON_SERVICE_TIMEOUT' : 'PYTHON_SERVICE_UNAVAILABLE', 'Python 常驻服务暂时不可用');
  } finally { clearTimeout(timer); }
}

function callCli(scriptPath, input, timeoutMs) {
  return new Promise(resolve => {
    let payload;
    try { payload = JSON.stringify(input); } catch { return resolve(safeError('PYTHON_INTERNAL', '输入无法序列化为 JSON')); }
    const python = String(process.env.HTN_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')).trim();
    let child;
    try {
      child = spawn(python, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
    } catch { return resolve(safeError('PYTHON_NOT_FOUND', '无法启动 Python')); }
    let stdout = '', stderr = '', settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(safeError('PYTHON_TIMEOUT', `Python 超时（${timeoutMs}ms）`)); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', () => { clearTimeout(timer); done(safeError('PYTHON_NOT_FOUND', 'Python 启动失败')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        const summary = stderr.trim().split(/\r?\n/).filter(line => line && !/Traceback|File "/.test(line)).at(-1);
        return done(safeError('PYTHON_EXIT', String(summary || 'Python 工具执行失败').slice(0, 160)));
      }
      try { done(JSON.parse(stdout.trim())); } catch { done(safeError(stdout.trim() ? 'PYTHON_BAD_OUTPUT' : 'PYTHON_EMPTY_OUTPUT', 'Python 输出不可用')); }
    });
    child.stdin.end(payload);
  });
}

export async function executePython(scriptPath, input, timeoutOverride) {
  const timeoutMs = timeoutValue(timeoutOverride);
  const started = Date.now();
  let runtime = 'cli';
  let result = null;
  if (process.env.PYTHON_SERVICE_URL) {
    runtime = 'service';
    result = await callService(scriptPath, input, timeoutMs);
    if (result?.success === false && ['PYTHON_SERVICE_TIMEOUT', 'PYTHON_SERVICE_UNAVAILABLE', 'PYTHON_CIRCUIT_OPEN'].includes(result.error?.code) && process.env.PYTHON_CLI_FALLBACK !== '0') {
      runtime = 'cli';
      result = await callCli(scriptPath, input, timeoutMs);
      result.runtime_fallback = 'local_cli';
    }
  } else result = await callCli(scriptPath, input, timeoutMs);
  observePythonResult(scriptPath, result, Date.now() - started, runtime);
  return result;
}

export async function pythonRuntimeHealth() {
  const base = String(process.env.PYTHON_SERVICE_URL || '').replace(/\/$/, '');
  if (!base) return { mode: 'cli', status: 'available_if_interpreter_present', circuit: { failures: circuit.failures, open: Date.now() < circuit.openUntil } };
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${base}/health`, { signal: controller.signal });
    return { mode: 'service_with_cli_fallback', status: response.ok ? 'ready' : 'degraded', circuit: { failures: circuit.failures, open: Date.now() < circuit.openUntil } };
  } catch { return { mode: 'service_with_cli_fallback', status: 'degraded', fallback: process.env.PYTHON_CLI_FALLBACK !== '0' ? 'local_cli' : 'disabled', circuit: { failures: circuit.failures, open: Date.now() < circuit.openUntil } }; }
  finally { clearTimeout(timer); }
}

