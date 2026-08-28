const MAX_SAMPLES = 2000;
const state = {
  graphrag: { latency_ms: [], calls: 0, empty: 0, degraded: 0, review_gates: 0 },
  curve: { latency_ms: [], calls: 0, errors: 0, degraded: 0, forecast: 0, rejected: 0, interval_width: [], boundary_hit: 0, models: {} },
  llm: { latency_ms: [], calls: 0, errors: 0, degraded: 0, circuit_open: 0 },
  safety: { rule_hits: 0 },
  python: { latency_ms: [], service_attempts: 0, service_calls: 0, cli_calls: 0, fallback_calls: 0, circuit_open: 0, failures: 0 },
};

function addSample(list, value) {
  if (!Number.isFinite(Number(value))) return;
  list.push(Number(value));
  if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
}
function percentile(list, p) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))].toFixed(2));
}
const rate = (n, d) => d ? Number((n / d).toFixed(4)) : 0;

export function observePythonResult(scriptPath, result, latencyMs, runtime = 'cli') {
  if (runtime === 'service') { state.python.service_attempts += 1; state.python.service_calls += 1; }
  else state.python.cli_calls += 1;
  if (result?.runtime_fallback) { state.python.service_attempts += 1; state.python.fallback_calls += 1; }
  addSample(state.python.latency_ms, latencyMs);
  if (result?.success === false) state.python.failures += 1;
  const name = String(scriptPath || '').replaceAll('\\', '/');
  if (name.endsWith('graphrag_index.py')) {
    const metric = state.graphrag; metric.calls += 1; addSample(metric.latency_ms, latencyMs);
    if (!result?.results?.length) metric.empty += 1;
    if (result?.success === false) metric.errors = (metric.errors || 0) + 1;
    if (result?.retrieval_trace?.degradations?.length || result?.capabilities?.degradations?.length) metric.degraded += 1;
    metric.review_gates += Number(result?.retrieval_trace?.blocked_edge_count || 0);
  }
  if (name.endsWith('health_curve.py')) {
    addSample(state.curve.latency_ms, latencyMs);
    if (result?.success === false) { state.curve.errors += 1; state.curve.calls += 1; }
    if (result?.runtime_fallback || result?.degraded) state.curve.degraded += 1;
    const rows = Array.isArray(result?.metrics) ? result.metrics : [result];
    for (const row of rows) {
      if (!row || row.success === false) continue;
      state.curve.calls += 1;
      if (row.forecast?.available) state.curve.forecast += 1; else state.curve.rejected += 1;
      addSample(state.curve.interval_width, row.forecast?.mean_interval_width);
      if (row.forecast?.boundary_hit) state.curve.boundary_hit += 1;
      const model = row.forecast?.model || row.model || 'none';
      state.curve.models[model] = (state.curve.models[model] || 0) + 1;
    }
  }
}

export function recordCircuitOpen() { state.python.circuit_open += 1; }
export function recordLLM(status, latencyMs = null) {
  state.llm.calls += 1; addSample(state.llm.latency_ms, latencyMs);
  if (['error', 'failed', 'timeout'].includes(String(status))) state.llm.errors += 1;
  if (status !== 'success') state.llm.degraded += 1;
  if (String(status).includes('circuit')) state.llm.circuit_open += 1;
}
export function recordSafetyRule() { state.safety.rule_hits += 1; }

export function metricsSnapshot() {
  return {
    schema_version: 'ops-metrics.v1', generated_at: new Date().toISOString(),
    graphrag: {
      calls: state.graphrag.calls, p50_latency_ms: percentile(state.graphrag.latency_ms, 0.5), p95_latency_ms: percentile(state.graphrag.latency_ms, 0.95),
      error_rate: rate(state.graphrag.errors || 0, state.graphrag.calls), empty_retrieval_rate: rate(state.graphrag.empty, state.graphrag.calls), degradation_rate: rate(state.graphrag.degraded, state.graphrag.calls), circuit_open_count: state.python.circuit_open, review_gate_count: state.graphrag.review_gates,
    },
    curve: {
      calls: state.curve.calls, p50_latency_ms: percentile(state.curve.latency_ms, 0.5), p95_latency_ms: percentile(state.curve.latency_ms, 0.95), error_rate: rate(state.curve.errors, state.curve.calls), degradation_rate: rate(state.curve.degraded, state.curve.calls), circuit_open_count: state.python.circuit_open, forecast_rate: rate(state.curve.forecast, state.curve.calls), prediction_rejection_rate: rate(state.curve.rejected, state.curve.calls), rejection_rate: rate(state.curve.rejected, state.curve.calls),
      interval_width_p50: percentile(state.curve.interval_width, 0.5), interval_width_p95: percentile(state.curve.interval_width, 0.95),
      boundary_hit_count: state.curve.boundary_hit, model_distribution: { ...state.curve.models },
    },
    llm: { calls: state.llm.calls, p50_latency_ms: percentile(state.llm.latency_ms, 0.5), p95_latency_ms: percentile(state.llm.latency_ms, 0.95), error_rate: rate(state.llm.errors, state.llm.calls), degradation_rate: rate(state.llm.degraded, state.llm.calls), circuit_open_count: state.llm.circuit_open },
    safety: { rule_hit_count: state.safety.rule_hits }, python: { ...state.python,
      p50_latency_ms: percentile(state.python.latency_ms, 0.5), p95_latency_ms: percentile(state.python.latency_ms, 0.95),
      error_rate: rate(state.python.failures, state.python.service_calls + state.python.cli_calls),
      fallback_rate: rate(state.python.fallback_calls, state.python.service_attempts),
      latency_ms: undefined },
  };
}
