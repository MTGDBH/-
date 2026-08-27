# -*- coding: utf-8 -*-
"""Optional local Python gateway. It is an operational optimization, not a medical service."""
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
SCRIPTS = {
    'predict_htn.py': ROOT / 'predict_htn.py',
    'health_curve.py': ROOT / 'curve' / 'health_curve.py',
    'population_service.py': ROOT / 'population' / 'population_service.py',
    'predict_disease.py': ROOT / 'disease_risk' / 'predict_disease.py',
    'graphrag_index.py': PROJECT / 'elderly-health-rag' / 'graphrag_index.py',
}

class Handler(BaseHTTPRequestHandler):
    server_version = 'EviCarePythonRuntime/1'
    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))
    def send_json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
    def do_GET(self):
        if self.path == '/health': return self.send_json(200, {'ok': True, 'mode': 'threaded_gateway', 'python': sys.version.split()[0]})
        self.send_json(404, {'error': 'not_found'})
    def do_POST(self):
        if self.path != '/run': return self.send_json(404, {'error': 'not_found'})
        try:
            size = min(int(self.headers.get('Content-Length', '0')), 2_000_000)
            request = json.loads(self.rfile.read(size).decode('utf-8'))
            script = SCRIPTS.get(str(request.get('script', '')))
            if not script or not script.exists(): return self.send_json(400, {'success': False, 'error': {'code': 'SCRIPT_NOT_ALLOWED', 'message': '脚本不在允许列表'}})
            timeout = max(1.0, min(120.0, float(request.get('timeout_ms', 15000)) / 1000.0))
            env = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
            completed = subprocess.run([sys.executable, str(script)], input=json.dumps(request.get('input') or {}, ensure_ascii=False).encode('utf-8'), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, cwd=str(PROJECT), env=env)
            if completed.returncode != 0: return self.send_json(502, {'success': False, 'error': {'code': 'PYTHON_EXIT', 'message': 'Python 工具执行失败'}})
            self.send_json(200, json.loads(completed.stdout.decode('utf-8')))
        except subprocess.TimeoutExpired: self.send_json(504, {'success': False, 'error': {'code': 'PYTHON_TIMEOUT', 'message': 'Python 工具超时'}})
        except Exception: self.send_json(500, {'success': False, 'error': {'code': 'RUNTIME_ERROR', 'message': 'Python 运行服务暂不可用'}})

if __name__ == '__main__':
    host = os.environ.get('PYTHON_SERVICE_HOST', '127.0.0.1')
    port = int(os.environ.get('PYTHON_SERVICE_PORT', '8765'))
    ThreadingHTTPServer((host, port), Handler).serve_forever()
