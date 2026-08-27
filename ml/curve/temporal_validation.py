# -*- coding: utf-8 -*-
"""Curve V2 时间外推验证框架。

默认运行的是 90 天合成干跑，数据分类为 test，结果绝不能当作真实老人外部验证。
当传入真实 CSV 时，要求至少包含 participant_id、timestamp、metric、value，按老人
隔离并按时间滚动评估，避免同一老人的未来记录泄漏到训练窗口。
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from health_curve import analyze
from curve_utils import canonical_measurement_group, local_day

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
    return {
        "n": int(len(actual)), "mae": mae, "rmse": rmse,
        "mase": mae / scale if mae is not None else None,
        "coverage_80": coverage, "interval_width": width,
        "sum_abs_error": float(np.sum(np.abs(err))),
        "sum_sq_error": float(np.sum(err ** 2)),
        "scale_denominator": float(scale * len(actual)),
        "covered_points": int(np.sum((actual >= np.asarray(lower)) & (actual <= np.asarray(upper)))) if lower is not None and upper is not None else None,
        "interval_width_sum": float(np.sum(np.asarray(upper) - np.asarray(lower))) if lower is not None and upper is not None else None,
    }


def _micro(metric_rows):
    n = sum(int(row.get("n") or 0) for row in metric_rows)
    if not n:
        return {"n": 0, "mae": None, "rmse": None, "mase": None, "coverage_80": None, "interval_width": None}
    abs_sum = sum(float(row.get("sum_abs_error") or 0) for row in metric_rows)
    sq_sum = sum(float(row.get("sum_sq_error") or 0) for row in metric_rows)
    scale_sum = sum(float(row.get("scale_denominator") or 0) for row in metric_rows)
    coverage_rows = [row for row in metric_rows if row.get("covered_points") is not None]
    covered = sum(int(row["covered_points"]) for row in coverage_rows)
    covered_n = sum(int(row["n"]) for row in coverage_rows)
    width_sum = sum(float(row.get("interval_width_sum") or 0) for row in coverage_rows)
    return {
        "n": n, "mae": abs_sum / n, "rmse": float(np.sqrt(sq_sum / n)),
        "mase": abs_sum / scale_sum if scale_sum > 0 else None,
        "coverage_80": covered / covered_n if covered_n else None,
        "interval_width": width_sum / covered_n if covered_n else None,
    }


def _macro(metric_rows):
    fields = ("mae", "rmse", "mase", "coverage_80", "interval_width")
    out = {"windows": len(metric_rows)}
    for field in fields:
        values = [float(row[field]) for row in metric_rows if row.get(field) is not None]
        out[field] = float(np.mean(values)) if values else None
    return out


def aggregate_scopes(forecasted, key):
    rows = [row[key] for row in forecasted]
    by_participant = []
    for participant_id in sorted({row["participant_id"] for row in forecasted}):
        by_participant.append(_micro([row[key] for row in forecasted if row["participant_id"] == participant_id]))
    macro_participant = _macro(by_participant)
    macro_participant["participants"] = len(by_participant)
    return {"micro": _micro(rows), "macro_by_window": _macro(rows), "macro_by_participant": macro_participant}


def run(df, min_history=28, horizon=7, selection_options=None,
        interval_method="horizon_specific_split_conformal"):
    df = df.copy()
    df["timestamp_original"] = df["timestamp"].astype(str)
    df["timestamp_utc"] = pd.to_datetime(df["timestamp"], utc=True)
    def group_for_row(row):
        payload = row.to_dict()
        payload['condition'] = payload.get('condition', 'unknown')
        return canonical_measurement_group(str(row['metric']), payload)
    df["measurement_group"] = df.apply(group_for_row, axis=1)
    df = df.sort_values(["participant_id", "metric", "measurement_group", "timestamp_utc"])
    rows = []; refusals = 0; attempts = 0
    for (pid, metric_name, measurement_group), group in df.groupby(["participant_id", "metric", "measurement_group"]):
        group = group.reset_index(drop=True)
        passthrough = ("condition", "timezone", "posture", "measurement_period", "device_source", "repeat_status", "resting", "clothing_condition")
        points = []
        for i, row in group.iterrows():
            point = {"t": row["timestamp_original"], "v": float(row.value), "id": int(i)}
            for field in passthrough:
                if field in group.columns and pd.notna(row.get(field)):
                    point[field] = row.get(field)
            points.append(point)
        if len(points) < min_history + horizon:
            continue
        for end in range(min_history, len(points), horizon):
            hist = points[:end]
            origin = pd.Timestamp(hist[-1]["t"])
            window_end = origin + pd.Timedelta(days=horizon)
            future = [p for p in points[end:] if origin < pd.Timestamp(p["t"]) <= window_end]
            if not future:
                continue
            attempts += 1
            result = analyze(metric_name, "mmHg", hist, forecast_days=horizon,
                             condition_group=measurement_group,
                             selection_options=selection_options,
                             interval_method=interval_method)
            if not result.get("forecast", {}).get("available"):
                refusals += 1
                rows.append({"participant_id": pid, "metric": metric_name, "measurement_group": measurement_group, "origin": hist[-1]["t"], "status": "refused", "reason": result.get("forecast", {}).get("reason"), "reason_code": result.get("forecast", {}).get("reason_code"), "message": result.get("forecast", {}).get("message")})
                continue
            forecast_curve = result["forecast"]["curve"]
            predicted_by_day = {
                pd.to_datetime(float(ts), unit="s", utc=True).strftime("%Y-%m-%d"): (pred, lo, hi)
                for ts, pred, lo, hi in zip(
                    forecast_curve["timestamps"], forecast_curve["predicted"],
                    forecast_curve["lower"], forecast_curve["upper"], strict=True,
                )
            }
            aligned = []
            for point in future:
                day = local_day(point["t"], point.get("timezone"))
                if day in predicted_by_day:
                    aligned.append((day, float(point["v"]), *predicted_by_day[day]))
            if not aligned:
                refusals += 1
                rows.append({"participant_id": pid, "metric": metric_name, "measurement_group": measurement_group, "origin": hist[-1]["t"], "status": "refused", "reason": "预测日期与真实记录没有交集", "reason_code": "NO_DATE_OVERLAP", "message": "预测日期与真实记录没有交集"})
                continue
            actual = [row[1] for row in aligned]
            pred = [row[2] for row in aligned]
            lower = [row[3] for row in aligned]
            upper = [row[4] for row in aligned]
            baseline = [float(hist[-1]["v"])] * len(actual)
            median_value = float(np.median([float(point["v"]) for point in hist[-14:]]))
            median_baseline = [median_value] * len(actual)
            scale = float(np.mean(np.abs(np.diff([float(p["v"]) for p in hist])))) if len(hist) > 1 else 1.0
            rows.append({"participant_id": pid, "metric": metric_name, "measurement_group": measurement_group, "origin": hist[-1]["t"], "status": "forecasted", "aligned_dates": [row[0] for row in aligned], "curve_v2": metrics(actual, pred, lower, upper, scale), "last_value_baseline": metrics(actual, baseline, scale=scale), "rolling_median_baseline": metrics(actual, median_baseline, scale=scale), "model": result.get("forecast", {}).get("model")})
    forecasted = [r for r in rows if r["status"] == "forecasted"]
    curve_scopes = aggregate_scopes(forecasted, "curve_v2") if forecasted else {"micro": _micro([]), "macro_by_window": _macro([]), "macro_by_participant": {**_macro([]), "participants": 0}}
    baseline_scopes = aggregate_scopes(forecasted, "last_value_baseline") if forecasted else {"micro": _micro([]), "macro_by_window": _macro([]), "macro_by_participant": {**_macro([]), "participants": 0}}
    median_scopes = aggregate_scopes(forecasted, "rolling_median_baseline") if forecasted else {"micro": _micro([]), "macro_by_window": _macro([]), "macro_by_participant": {**_macro([]), "participants": 0}}
    return {
        "attempts": attempts, "forecasted_windows": len(forecasted), "refused_windows": refusals,
        "refusal_rate": refusals / attempts if attempts else None,
        "curve_v2": curve_scopes["micro"],
        "last_value_baseline": baseline_scopes["micro"],
        "rolling_median_baseline": median_scopes["micro"],
        "metrics": {"curve_v2": curve_scopes, "last_value_baseline": baseline_scopes, "rolling_median_baseline": median_scopes},
        "aggregation_policy": "micro is prediction-point weighted; macro_by_window and macro_by_participant are unweighted means of their units",
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
