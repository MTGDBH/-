# -*- coding: utf-8 -*-
"""Curve V2 时间外推干跑的结构化回归测试。"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
proc = subprocess.run([sys.executable, str(ROOT / "temporal_validation.py")], capture_output=True, text=True, encoding="utf-8")
assert proc.returncode == 0, proc.stderr
report = json.loads((ROOT.parent.parent / "ml" / "reports" / "curve-temporal-validation-20260821.json").read_text(encoding="utf-8"))
assert report["data_class"] == "test_synthetic_dry_run"
assert report["evaluation"]["attempts"] > 0
assert report["evaluation"]["forecasted_windows"] > 0
assert report["evaluation"]["refusal_rate"] >= 0
assert report["evaluation"]["curve_v2"]["coverage_80"] is not None
assert report["external_validation_status"] == "dry_run_only"
print("curve temporal validation dry-run: PASS", {"attempts": report["evaluation"]["attempts"], "forecasted": report["evaluation"]["forecasted_windows"], "refused": report["evaluation"]["refused_windows"]})
