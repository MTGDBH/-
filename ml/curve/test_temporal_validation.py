# -*- coding: utf-8 -*-
"""Curve V2 时间外推干跑的结构化回归测试。"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix="curve-validation-") as temp_dir:
    report_path = Path(temp_dir) / "curve-temporal-validation.json"
    markdown_path = Path(temp_dir) / "curve-temporal-validation.md"
    proc = subprocess.run([sys.executable, str(ROOT / "temporal_validation.py"), "--out", str(report_path), "--report-path", str(markdown_path)], capture_output=True, text=True, encoding="utf-8")
    assert proc.returncode == 0, proc.stderr
    report = json.loads(report_path.read_text(encoding="utf-8"))
assert report["data_class"] == "test_synthetic_dry_run"
assert report["evaluation"]["attempts"] > 0
assert report["evaluation"]["forecasted_windows"] > 0
assert report["evaluation"]["refusal_rate"] >= 0
assert report["evaluation"]["curve_v2"]["coverage_80"] is not None
assert report["external_validation_status"] == "dry_run_only"
assert set(report["synthetic_scenarios"]) == {
    "stable_level", "slow_trend", "level_shift", "weekly_cycle", "missingness",
    "device_offset", "heteroscedastic", "single_point_error", "post_medication_state_change",
}
assert len(report["coverage_width_refusal_table"]) == 4
assert all({"coverage", "mean_interval_width", "refusal_rate"} <= set(row) for row in report["coverage_width_refusal_table"])
assert report["evaluation"]["unconditional_metrics"]["last_value"]["n"] > 0
assert all(row["reason_code"] and row["reason_category"] for row in report["evaluation"]["windows"] if row["status"] == "refused")
assert sum(row["count"] for row in report["evaluation"]["refusal_reason_summary"]) == report["evaluation"]["refused_windows"]
assert 0.75 <= report["evaluation"]["curve_v2"]["coverage_80"] <= 0.85
stable_windows = [row for row in report["evaluation"]["windows"] if row["scenario"] == "stable_level"]
assert stable_windows and sum(row["status"] == "forecasted" for row in stable_windows) > sum(row["status"] == "refused" for row in stable_windows)
assert report["baseline_reference"]["primary_refusal_reasons"] == [
    {"reason_code": "NO_STABLE_MODEL", "count": 24, "share_of_refusals": 24 / 31},
    {"reason_code": "HORIZON_BUCKET_NOT_READY", "count": 7, "share_of_refusals": 7 / 31},
]
for window in report["evaluation"]["windows"]:
    if window["status"] == "forecasted":
        assert len(window["aligned_dates"]) == window["curve_v2"]["n"]
        assert len(window["aligned_dates"]) <= 7

# Missing calendar days must not shift an observation onto the wrong forecast day.
sys.path.insert(0, str(ROOT))
from temporal_validation import aggregate_scopes, metrics, run

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

# Micro is prediction-point weighted; macro windows and participants are not.
metric_windows = [
    {"participant_id": "p1", "curve_v2": metrics([0], [0])},
    {"participant_id": "p1", "curve_v2": metrics([0], [2])},
    {"participant_id": "p2", "curve_v2": metrics([0] * 8, [4] * 8)},
]
scopes = aggregate_scopes(metric_windows, "curve_v2")
assert abs(scopes["micro"]["mae"] - 3.4) < 1e-12, scopes
assert abs(scopes["macro_by_window"]["mae"] - 2.0) < 1e-12, scopes
assert abs(scopes["macro_by_participant"]["mae"] - 2.5) < 1e-12, scopes
assert abs(scopes["micro"]["rmse"] - (132 / 10) ** 0.5) < 1e-12, scopes

# Every refusal is machine-readable.
for window in report["evaluation"]["windows"]:
    if window["status"] == "refused":
        assert window.get("reason_code") and window.get("message"), window

# Validation partitions measurement conditions instead of combining them.
condition_dates = pd.date_range("2026-01-01", periods=80, tz="UTC")
condition_frame = pd.DataFrame([
    {"participant_id": "glu", "timestamp": ts.isoformat(), "metric": "glucose", "value": 5.2 + i * 0.002, "condition": "fasting" if i % 2 == 0 else "random"}
    for i, ts in enumerate(condition_dates)
])
condition_result = run(condition_frame, min_history=28, horizon=7)
assert all(window["measurement_group"] in {"glucose:fasting", "glucose:random"} for window in condition_result["windows"])
assert not any("MIXED_MEASUREMENT_CONDITIONS" == window.get("reason_code") for window in condition_result["windows"])
print("curve temporal validation dry-run: PASS", {"attempts": report["evaluation"]["attempts"], "forecasted": report["evaluation"]["forecasted_windows"], "refused": report["evaluation"]["refused_windows"]})
