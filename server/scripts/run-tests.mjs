import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const thisScript = fileURLToPath(import.meta.url);
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor !== 22 && process.env.TEST_NODE_REEXEC !== '1') {
  console.warn(`Node ${process.versions.node} is outside engines >=22 <23; re-running tests with Node 22.16.0.`);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npx, ['--yes', 'node@22.16.0', thisScript, ...process.argv.slice(2)], {
    cwd: process.cwd(), env: { ...process.env, TEST_NODE_REEXEC: '1' }, stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(serverRoot, '..');
const utf8Env = {
  ...process.env,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  PYTHONDONTWRITEBYTECODE: '1',
  LANG: process.env.LANG || 'C.UTF-8',
};

const unitTests = [
  'src/test_agent_chinese_output.js',
  'src/test_agent_dialogue_v3.js',
  'src/test_agent_orchestrator_v2.js',
  'src/test_agent_presentation_v2.js',
  'src/test_health_intake.js',
  'src/test_health_text_parser.js',
  'src/test_knowledge_expansion.js',
  'src/test_safe_curve_graph_link.js',
  'src/test_weather.js',
  'src/test_curve_reference.js',
  'src/test_python_runtime.js',
  'src/test_audit_sanitization.js',
  'src/test_permission_matrix.js',
  'src/test_intervention_foundation.js',
  'src/test_intervention_evaluation.js',
];
const integrationTests = [
  'data/test_auth_integration.mjs',
  'data/test_care_permissions.mjs',
  'data/test_device_sync.mjs',
  'data/test_interventions.mjs',
];

function gitStatus() {
  return spawnSync('git', ['status', '--porcelain=v1', '-z'], { cwd: repoRoot }).stdout;
}

function tempDatabase(tempRoot, name = 'app.db') {
  const destination = path.join(tempRoot, name);
  const source = path.join(serverRoot, 'data', 'app.db');
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, destination);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, destination + suffix);
    }
  }
  return destination;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || serverRoot,
    env: { ...utf8Env, ...(options.env || {}) },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function runNodeFile(file, tempRoot) {
  const dbPath = tempDatabase(tempRoot, `${path.basename(file).replace(/\W/g, '-')}.db`);
  run(process.execPath, [file], { env: { DB_PATH: dbPath } });
}

function runUnit(tempRoot) {
  for (const file of unitTests) runNodeFile(file, tempRoot);
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`test server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('timed out waiting for the isolated test server');
}

async function runIntegration(tempRoot) {
  const dbPath = tempDatabase(tempRoot, 'integration.db');
  const port = 32000 + Math.floor(Math.random() * 2000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...utf8Env, DB_PATH: dbPath, PORT: String(port), NODE_ENV: 'test',
      DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '', LLM_API_KEY: '',
      LOGIN_RATE_STORE: 'sqlite', LOGIN_RATE_MAX: '100', LOGIN_MAX_FAILURES: '3', COOKIE_SECURE: '1',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  try {
    await waitForServer(baseUrl, child);
    for (const file of integrationTests) {
      run(process.execPath, [file], { env: { DB_PATH: dbPath, TEST_BASE_URL: baseUrl } });
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
}

function pythonExecutable() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const local = process.platform === 'win32'
    ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(repoRoot, '.venv', 'bin', 'python');
  return fs.existsSync(local) ? local : (process.platform === 'win32' ? 'python' : 'python3');
}

function runPython(group) {
  run(pythonExecutable(), [path.join(repoRoot, 'scripts', 'run_python_tests.py'), group], { cwd: repoRoot });
}

function runSyntax() {
  const listed = spawnSync('git', ['ls-files', '*.js', '*.mjs'], { cwd: repoRoot, encoding: 'utf8' });
  if (listed.status !== 0) throw new Error('git ls-files failed');
  for (const file of listed.stdout.split(/\r?\n/).filter(Boolean)) {
    run(process.execPath, ['--check', path.join(repoRoot, file)]);
  }
  runPython('syntax');
  console.log('Node syntax check: PASS');
}

async function main() {
  const group = process.argv[2] || 'core';
  const before = gitStatus();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elderly-health-tests-'));
  try {
    if (group === 'unit') runUnit(tempRoot);
    else if (group === 'integration') await runIntegration(tempRoot);
    else if (group === 'graphrag' || group === 'curve' || group === 'security') runPython(group);
    else if (group === 'syntax') runSyntax();
    else if (group === 'core') {
      runUnit(tempRoot);
      await runIntegration(tempRoot);
      runPython('unit');
      runPython('graphrag');
      runPython('curve');
      runPython('security');
      runSyntax();
    } else throw new Error(`unknown test group: ${group}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  if (!before.equals(gitStatus())) throw new Error('tests changed the Git working tree');
  console.log('Git status unchanged after Node tests.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
