import json
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer

from ml import runtime_service as runtime


def test_registry_rejects_script_paths_and_exposes_loaded_tools():
    server = ThreadingHTTPServer(("127.0.0.1", 0), runtime.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        health = json.load(urllib.request.urlopen(base + "/health", timeout=2))
        assert health["mode"] == "resident_worker_pool"
        assert set(health["loaded_tools"]) == set(runtime.REGISTRY)
        body = json.dumps({"script": "../../evil.py", "input": {}}).encode()
        request = urllib.request.Request(base + "/run", data=body, headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(request, timeout=2)
            raise AssertionError("script path unexpectedly accepted")
        except urllib.error.HTTPError as exc:
            assert exc.code == 400
            assert json.load(exc)["error"]["code"] == "TOOL_NOT_ALLOWED"
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)


def test_serialized_context_is_cleared_between_concurrent_users():
    class FakeGraph:
        _QUERY_CONTEXT = {}

        @classmethod
        def query(cls, _question, _disease, _top_k, _options):
            first = cls._QUERY_CONTEXT["user"]
            time.sleep(.02)
            return {"success": True, "first": first, "last": cls._QUERY_CONTEXT["user"]}

    handler = runtime._graphrag_handler(FakeGraph)
    tool = runtime.Tool("test.graph", handler, lock=threading.Lock())
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda user: runtime._invoke(tool, {"question": "q", "context": {"user": user}}), range(12)))
    assert all(row["first"] == row["last"] for row in results)
    assert FakeGraph._QUERY_CONTEXT == {}
