import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executePython } from './services/pythonRuntime.js';
import { metricsSnapshot } from './services/opsMetrics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const curve = path.resolve(here, '..', '..', 'ml', 'curve', 'health_curve.py');
const failedService = http.createServer((_req, res) => { res.statusCode = 503; res.end('{}'); });
await new Promise(resolve => failedService.listen(0, '127.0.0.1', resolve));
process.env.PYTHON_SERVICE_URL = `http://127.0.0.1:${failedService.address().port}`;
process.env.PYTHON_CLI_FALLBACK = '1';
try {
  const denied = await executePython(path.resolve(here, 'not-registered.py'), {}, 1000);
  assert.equal(denied.error.code, 'TOOL_NOT_ALLOWED');
  const result = await executePython(curve, { metric: 'weight', unit: 'kg', points: [] }, 15_000);
  assert.equal(result.runtime_fallback, 'local_cli');
  const metrics = metricsSnapshot();
  assert.equal(metrics.python.fallback_calls, 1);
  assert.equal(metrics.python.cli_calls, 1);
  console.log('Python runtime registry and CLI fallback: PASS');
} finally {
  await new Promise(resolve => failedService.close(resolve));
}
