# -*- coding: utf-8 -*-
"""Bounded long-lived Python tool runtime with a fixed tool registry."""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
RAG_ROOT = PROJECT / "elderly-health-rag"
for candidate in (str(PROJECT), str(ROOT), str(ROOT / "curve"), str(ROOT / "population"),
                  str(ROOT / "disease_risk"), str(RAG_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

MAX_BODY_BYTES = max(1024, int(os.environ.get("PYTHON_SERVICE_MAX_BODY_BYTES", "1048576")))
MAX_WORKERS = max(1, min(32, int(os.environ.get("PYTHON_SERVICE_WORKERS", "4"))))
MAX_QUEUE = max(0, min(1024, int(os.environ.get("PYTHON_SERVICE_QUEUE", "16"))))
DEFAULT_TIMEOUT_MS = max(100, int(os.environ.get("PYTHON_SERVICE_TIMEOUT_MS", "15000")))
MAX_TIMEOUT_MS = max(DEFAULT_TIMEOUT_MS, int(os.environ.get("PYTHON_SERVICE_MAX_TIMEOUT_MS", "120000")))


def _module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot_load_{name}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


@dataclass
class Tool:
    name: str
    handler: Callable[[dict[str, Any]], dict[str, Any]]
    timeout_ms: int = DEFAULT_TIMEOUT_MS
    max_input_bytes: int = 512 * 1024
    max_output_bytes: int = 4 * 1024 * 1024
    lock: threading.Lock | None = None
    loaded_at: float = field(default_factory=time.time)
    calls: int = 0
    errors: int = 0
    timeouts: int = 0
    latency_ms: list[float] = field(default_factory=list)


def _curve_handler(module):
    def invoke(request):
        if isinstance(request.get("batch"), list):
            rows = [module.analyze(
                str(item.get("metric") or ""), str(item.get("unit") or ""), item.get("points") or [],
                request.get("forecast_days", 7), item.get("condition_group"), item.get("population_prior"),
                request.get("selection_options"), request.get("interval_method", "horizon_specific_split_conformal"),
            ) for item in request["batch"]]
            return {"success": True, "metric": "all", "schema_version": "curve.v2", "metrics": rows}
        return module.analyze(
            str(request.get("metric") or ""), str(request.get("unit") or ""), request.get("points") or [],
            request.get("forecast_days", 7), request.get("condition_group"), request.get("population_prior"),
            request.get("selection_options"), request.get("interval_method", "horizon_specific_split_conformal"),
        )
    return invoke


def _graphrag_handler(module):
    # graphrag_index uses module state for personalization context. This tool is
    # serialized and the state is cleared so account data cannot cross requests.
    def invoke(request):
        module._QUERY_CONTEXT = request.get("context") or {}
        try:
            options = request.get("options") or {}
            top_k = max(1, min(10, int(options.get("top_k", request.get("top_k", 4)) or 4)))
            return module.query(str(request.get("question") or ""), request.get("disease"), top_k, options)
        finally:
            module._QUERY_CONTEXT = {}
    return invoke


def _load_registry() -> dict[str, Tool]:
    htn = _module("runtime_predict_htn", ROOT / "predict_htn.py")
    curve = _module("runtime_health_curve", ROOT / "curve" / "health_curve.py")
    intervention_evaluation = _module("runtime_intervention_evaluation", ROOT / "intervention_evaluation" / "engine.py")
    population = _module("runtime_population_service", ROOT / "population" / "population_service.py")
    disease = _module("runtime_predict_disease", ROOT / "disease_risk" / "predict_disease.py")
    graphrag = _module("runtime_graphrag_index", RAG_ROOT / "graphrag_index.py")
    registry = {
        "htn.predict": Tool("htn.predict", htn.run_prediction, max_input_bytes=64 * 1024),
        "curve.analyze": Tool("curve.analyze", _curve_handler(curve)),
        "intervention.evaluate": Tool("intervention.evaluate", intervention_evaluation.evaluate_intervention,
                                      max_input_bytes=1024 * 1024),
        "population.predict": Tool("population.predict", population.predict),
        "disease.predict": Tool("disease.predict", disease.predict, max_input_bytes=256 * 1024),
        "graphrag.query": Tool("graphrag.query", _graphrag_handler(graphrag), lock=threading.Lock()),
    }
    if htn.MODEL_FILE.exists():
        htn._load_artifacts()
    population.preload_models()
    disease.preload_models()
    graph_output = Path(os.environ.get("GRAPHRAG_OUTPUT_PATH") or graphrag.OUTPUT)
    graphrag.preload_runtime_index(graph_output)
    return registry


REGISTRY = _load_registry()
EXECUTOR = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="evicare-tool")
ADMISSION = threading.BoundedSemaphore(MAX_WORKERS + MAX_QUEUE)
STARTED_AT = time.time()


def _percentile(values: list[float], quantile: float):
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int((len(ordered) - 1) * quantile))], 2)


def _metrics():
    return {"workers": MAX_WORKERS, "queue_capacity": MAX_QUEUE, "tools": {name: {
        "calls": tool.calls, "errors": tool.errors, "timeouts": tool.timeouts,
        "p50_latency_ms": _percentile(tool.latency_ms, .50),
        "p95_latency_ms": _percentile(tool.latency_ms, .95), "loaded_at": tool.loaded_at,
        "resource_limits": {"timeout_ms": tool.timeout_ms, "max_input_bytes": tool.max_input_bytes,
                            "max_output_bytes": tool.max_output_bytes},
    } for name, tool in REGISTRY.items()}}


def _invoke(tool: Tool, payload: dict[str, Any]):
    if tool.lock:
        with tool.lock:
            return tool.handler(payload)
    return tool.handler(payload)


class Handler(BaseHTTPRequestHandler):
    server_version = "EviCarePythonRuntime/2"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def send_json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/health":
            return self.send_json(200, {"ok": True, "mode": "resident_worker_pool", "python": sys.version.split()[0],
                "uptime_seconds": round(time.time() - STARTED_AT, 1), "loaded_tools": sorted(REGISTRY),
                "workers": MAX_WORKERS, "queue_capacity": MAX_QUEUE})
        if path == "/metrics":
            return self.send_json(200, _metrics())
        return self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/run":
            return self.send_json(404, {"error": "not_found"})
        raw_length = self.headers.get("Content-Length")
        if raw_length is None or not raw_length.isdigit():
            return self.send_json(411, {"success": False, "error": {"code": "LENGTH_REQUIRED", "message": "需要 Content-Length"}})
        length = int(raw_length)
        if length <= 0 or length > MAX_BODY_BYTES:
            return self.send_json(413, {"success": False, "error": {"code": "BODY_TOO_LARGE", "message": "请求体超过限制"}})
        try:
            request = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self.send_json(400, {"success": False, "error": {"code": "INVALID_JSON", "message": "请求体必须是 JSON"}})
        if not isinstance(request, dict):
            return self.send_json(400, {"success": False, "error": {"code": "INVALID_REQUEST", "message": "请求体必须是对象"}})
        tool = REGISTRY.get(str(request.get("tool") or ""))
        if tool is None:
            return self.send_json(400, {"success": False, "error": {"code": "TOOL_NOT_ALLOWED", "message": "工具名不在注册表"}})
        payload = request.get("input") or {}
        if not isinstance(payload, dict):
            return self.send_json(400, {"success": False, "error": {"code": "INVALID_INPUT", "message": "工具输入必须是对象"}})
        payload_bytes = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        if payload_bytes > tool.max_input_bytes:
            return self.send_json(413, {"success": False, "error": {"code": "TASK_RESOURCE_LIMIT", "message": "工具输入超过独立资源配额"}})
        timeout_ms = max(100, min(MAX_TIMEOUT_MS, int(request.get("timeout_ms") or tool.timeout_ms)))
        if not ADMISSION.acquire(blocking=False):
            return self.send_json(503, {"success": False, "error": {"code": "RUNTIME_QUEUE_FULL", "message": "运行队列已满"}})
        started = time.monotonic()
        future = EXECUTOR.submit(_invoke, tool, payload)
        future.add_done_callback(lambda _future: ADMISSION.release())
        tool.calls += 1
        try:
            result = future.result(timeout=timeout_ms / 1000)
            if not isinstance(result, dict):
                raise TypeError("tool_result_not_object")
            if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > tool.max_output_bytes:
                tool.errors += 1
                return self.send_json(502, {"success": False, "error": {"code": "TASK_OUTPUT_LIMIT", "message": "工具输出超过独立资源配额"}})
            if result.get("success") is False:
                tool.errors += 1
            return self.send_json(200, result)
        except TimeoutError:
            tool.timeouts += 1
            return self.send_json(504, {"success": False, "error": {"code": "PYTHON_TIMEOUT", "message": "工具执行超时"}})
        except Exception as exc:
            tool.errors += 1
            self.log_message("tool=%s error=%s", tool.name, type(exc).__name__)
            return self.send_json(500, {"success": False, "error": {"code": "RUNTIME_ERROR", "message": "Python 运行服务暂不可用"}})
        finally:
            latency = (time.monotonic() - started) * 1000
            tool.latency_ms.append(latency)
            if len(tool.latency_ms) > 2000:
                del tool.latency_ms[:-2000]


if __name__ == "__main__":
    host = os.environ.get("PYTHON_SERVICE_HOST", "127.0.0.1")
    port = int(os.environ.get("PYTHON_SERVICE_PORT", "8765"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()
