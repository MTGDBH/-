# -*- coding: utf-8 -*-
"""Curve V2 时间外推干跑的结构化回归测试。"""
import json
import subprocess
import sys
from pathlib import Path

import pandas as pd

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
for window in report["evaluation"]["windows"]:
    if window["status"] == "forecasted":
        assert len(window["aligned_dates"]) == window["curve_v2"]["n"]
        assert len(window["aligned_dates"]) <= 7

# Missing calendar days must not shift an observation onto the wrong forecast day.
sys.path.insert(0, str(ROOT))
from temporal_validation import run

dates = pd.date_range("2026-01-01", periods=50, tz="UTC")
gap_frame = pd.DataFrame([
    {"participant_id": "gap", "timestamp": ts.isoformat(), "metric": "systo", "value": 120 + i * 0.1, "condition": "morning_rest"}
    for i, ts in enumerate(dates) if i not in {29, 31, 34, 38}
])
gap_result = run(gap_frame, min_history=28, horizon=7)
for window in gap_result["windows"]:
    if window["status"] == "forecasted":
        origin = pd.Timestamp(window["origin"])
        assert all(origin < pd.Timestamp(day, tz="UTC") <= origin + pd.Timedelta(days=7) for day in window["aligned_dates"])
print("curve temporal validation dry-run: PASS", {"attempts": report["evaluation"]["attempts"], "forecasted": report["evaluation"]["forecasted_windows"], "refused": report["evaluation"]["refused_windows"]})
