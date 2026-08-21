# -*- coding: utf-8 -*-
"""Curve V2 时间外推验证框架。

默认运行的是 90 天合成干跑，数据分类为 test，结果绝不能当作真实老人外部验证。
当传入真实 CSV 时，要求至少包含 participant_id、timestamp、metric、value，按老人
隔离并按时间滚动评估，避免同一老人的未来记录泄漏到训练窗口。
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from health_curve import analyze

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent.parent
OUT_JSON = PROJECT / "ml" / "reports" / "curve-temporal-validation-20260821.json"
OUT_MD = PROJECT / "reports" / "curve-temporal-validation-20260821.md"


def synthetic(seed=42):
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 1, 8, tzinfo=timezone.utc)
    rows = []
    profiles = {
        "demo_a": (128.0, 0.05, 5.0),
        "demo_b": (136.0, -0.03, 6.0),
        "demo_c": (122.0, 0.00, 3.0),
        "demo_d": (142.0, 0.08, 7.0),
    }
    for pid, (level, slope, noise) in profiles.items():
        for day in range(90):
            ts = start + timedelta(days=day)
            value = level + slope * day + rng.normal(0, noise)
            if day == 47 and pid == "demo_d":
                value += 55  # single outlier must not become a permanent trend
            if rng.random() < 0.06:
                continue
            rows.append({"participant_id": pid, "timestamp": ts.isoformat(), "metric": "systo", "value": round(float(value), 2), "condition": "morning_rest"})
    return pd.DataFrame(rows)


def metrics(actual, predicted, lower=None, upper=None, scale=None):
    actual = np.asarray(actual, dtype=float); predicted = np.asarray(predicted, dtype=float)
    err = actual - predicted
    mae = float(np.mean(np.abs(err))) if len(err) else None
    rmse = float(np.sqrt(np.mean(err ** 2))) if len(err) else None
    if scale is None or scale <= 1e-9:
        scale = float(np.mean(np.abs(np.diff(actual)))) if len(actual) > 1 else 1.0
    scale = max(scale, 1e-9)
    coverage = None
    width = None
    if lower is not None and upper is not None and len(actual):
        lo = np.asarray(lower, dtype=float); hi = np.asarray(upper, dtype=float)
        coverage = float(np.mean((actual >= lo) & (actual <= hi)))
        width = float(np.mean(hi - lo))
    return {"n": int(len(actual)), "mae": mae, "rmse": rmse, "mase": mae / scale if mae is not None else None, "coverage_80": coverage, "interval_width": width}


def run(df, min_history=28, horizon=7):
    df = df.copy(); df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True); df = df.sort_values(["participant_id", "metric", "timestamp"])
    rows = []; refusals = 0; attempts = 0
    for (pid, metric_name), group in df.groupby(["participant_id", "metric"]):
        group = group.reset_index(drop=True)
        points = [{"t": row.timestamp.isoformat(), "v": float(row.value), "condition": row.get("condition", "unknown"), "id": int(i)} for i, row in group.iterrows()]
        if len(points) < min_history + horizon:
            continue
        for end in range(min_history, len(points) - horizon + 1, horizon):
            attempts += 1
            hist = points[:end]; future = points[end:end + horizon]
            result = analyze(metric_name, "mmHg", hist, forecast_days=horizon, condition_group=None)
            if not result.get("forecast", {}).get("available"):
                refusals += 1
                rows.append({"participant_id": pid, "metric": metric_name, "origin": hist[-1]["t"], "status": "refused", "reason": result.get("forecast", {}).get("reason")})
                continue
            pred = result["forecast"]["curve"]["predicted"][:len(future)]
            lower = result["forecast"]["curve"]["lower"][:len(future)]
            upper = result["forecast"]["curve"]["upper"][:len(future)]
            actual = [float(p["v"]) for p in future]
            baseline = [float(hist[-1]["v"])] * len(actual)
            scale = float(np.mean(np.abs(np.diff([float(p["v"]) for p in hist])))) if len(hist) > 1 else 1.0
            rows.append({"participant_id": pid, "metric": metric_name, "origin": hist[-1]["t"], "status": "forecasted", "curve_v2": metrics(actual, pred, lower, upper, scale), "last_value_baseline": metrics(actual, baseline, scale=scale), "model": result.get("forecast", {}).get("model")})
    forecasted = [r for r in rows if r["status"] == "forecasted"]
    def aggregate(key):
        vals = [r[key][field] for r in forecasted for field in ()]
        return vals
    def avg(path):
        vals = []
        for row in forecasted:
            value = row
            for part in path:
                value = value.get(part) if isinstance(value, dict) else None
            if value is not None and math.isfinite(float(value)):
                vals.append(float(value))
        return float(np.mean(vals)) if vals else None
    return {
        "attempts": attempts, "forecasted_windows": len(forecasted), "refused_windows": refusals,
        "refusal_rate": refusals / attempts if attempts else None,
        "curve_v2": {field: avg(["curve_v2", field]) for field in ("mae", "rmse", "mase", "coverage_80", "interval_width")},
        "last_value_baseline": {field: avg(["last_value_baseline", field]) for field in ("mae", "rmse", "mase")},
        "windows": rows,
    }


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--csv", default=None); ap.add_argument("--out", default=str(OUT_JSON)); args = ap.parse_args()
    if args.csv:
        df = pd.read_csv(args.csv)
        required = {"participant_id", "timestamp", "metric", "value"}
        missing = sorted(required - set(df.columns))
        if missing:
            raise SystemExit(f"missing required columns: {missing}")
        data_class = "research_external_candidate"
        source = str(Path(args.csv).resolve())
    else:
        df = synthetic(); data_class = "test_synthetic_dry_run"; source = "generated:curve-temporal-validation.synthetic.v1"
    result = {"schema_version": "curve-temporal-validation.v1", "run_id": "curve-temporal-dry-run-20260821", "data_class": data_class, "source": source, "n_rows": int(len(df)), "participants": int(df["participant_id"].nunique()), "days": int((pd.to_datetime(df["timestamp"], utc=True).max() - pd.to_datetime(df["timestamp"], utc=True).min()).days + 1), "evaluation": run(df), "external_validation_status": "dry_run_only" if data_class.startswith("test") else "candidate_requires_review", "limitations": ["合成干跑不代表真实老人外部验证", "真实 CSV 必须按 participant_id 隔离并在独立测试老人上复核", "MAE/coverage 只适用于实际可预测窗口，拒绝窗口单独报告"]}
    out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    md = ["# Curve V2 时间外推验证（工程干跑）", "", f"运行 ID：`{result['run_id']}`", f"数据分类：`{data_class}`", "", "| 项目 | 结果 |", "|---|---:|", f"| 记录数 | {result['n_rows']} |", f"| 老人数 | {result['participants']} |", f"| 覆盖天数 | {result['days']} |", f"| 预测窗口 | {result['evaluation']['forecasted_windows']} |", f"| 拒绝窗口 | {result['evaluation']['refused_windows']} |", f"| 拒绝率 | {result['evaluation']['refusal_rate']} |", f"| Curve V2 MAE | {result['evaluation']['curve_v2']['mae']} |", f"| Last-value 基线 MAE | {result['evaluation']['last_value_baseline']['mae']} |", f"| Curve V2 80% 覆盖率 | {result['evaluation']['curve_v2']['coverage_80']} |", "", "本文件证明验证代码可运行，不证明临床效果；真实纵向数据进入后必须重新生成并由项目组审核。"]
    OUT_MD.write_text("\n".join(md) + "\n", encoding="utf-8")
    print(json.dumps({"run_id": result["run_id"], "data_class": data_class, "output": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
