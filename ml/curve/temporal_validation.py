# -*- coding: utf-8 -*-
"""Curve V2 时间外推验证框架。

默认运行的是 90 天合成干跑，数据分类为 test，结果绝不能当作真实老人外部验证。
当传入真实 CSV 时，要求至少包含 participant_id、timestamp、metric、value，按老人
隔离并按时间滚动评估，避免同一老人的未来记录泄漏到训练窗口。
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
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


REASON_CATEGORIES = {
    "INSUFFICIENT_EFFECTIVE_DAYS": "数据不足", "INSUFFICIENT_TIME_SPAN": "数据不足",
    "INSUFFICIENT_30_DAY_HISTORY": "数据不足", "FORECAST_GATE_NOT_MET": "数据不足",
    "NO_DATE_OVERLAP": "数据不足", "MAXIMUM_HORIZON_14_DAYS": "边界风险",
    "MEASUREMENT_CONDITION_NOT_READY": "条件不一致", "MIXED_MEASUREMENT_CONDITIONS": "条件不一致",
    "MODEL_NOT_BEAT_BASELINE": "模型不胜基线", "NO_STABLE_MODEL": "模型不胜基线",
    "BASELINE_NOT_BEATEN": "模型不胜基线", "HORIZON_BUCKET_NOT_READY": "模型不胜基线",
    "INSUFFICIENT_CALIBRATION_RESIDUALS": "校准不足",
    "HIGH_RECENT_VOLATILITY": "波动过高", "CALIBRATION_INTERVAL_TOO_WIDE": "区间过宽",
    "BOUNDARY_RISK": "边界风险", "METRIC_NOT_FORECASTABLE": "边界风险",
}
INTERVAL_METHODS = (
    "horizon_specific_split_conformal", "pooled_split_conformal",
    "lead_time_scaled_pooled", "block_conformal",
)
REFUSAL_CATEGORY_ORDER = (
    "数据不足", "条件不一致", "模型不胜基线", "校准不足", "波动过高", "区间过宽", "边界风险",
)


def reason_category(reason_code):
    if reason_code not in REASON_CATEGORIES:
        raise ValueError(f"unclassified refusal reason_code: {reason_code!r}")
    return REASON_CATEGORIES[reason_code]


def synthetic(seed=42):
    rng = np.random.default_rng(seed)
    start = datetime(2026, 1, 1, 8, tzinfo=timezone.utc)
    rows = []
    scenarios = (
        "stable_level", "slow_trend", "level_shift", "weekly_cycle", "missingness",
        "device_offset", "heteroscedastic", "single_point_error", "post_medication_state_change",
    )
    for scenario in scenarios:
        pid = f"synthetic_{scenario}"
        for day in range(90):
            ts = start + timedelta(days=day)
            noise = 1.2
            value = 128.0 + rng.normal(0, noise)
            if scenario == "slow_trend": value = 120 + 0.18 * day + rng.normal(0, 1.4)
            elif scenario == "level_shift": value = 124 + (10 if day >= 50 else 0) + rng.normal(0, 1.5)
            elif scenario == "weekly_cycle": value = 128 + 5 * np.sin(2 * np.pi * day / 7) + rng.normal(0, 1.0)
            elif scenario == "missingness" and rng.random() < 0.22: continue
            elif scenario == "device_offset": value = 125 + (7 if day >= 45 else 0) + rng.normal(0, 1.3)
            elif scenario == "heteroscedastic": value = 128 + rng.normal(0, 0.7 + day * 0.055)
            elif scenario == "single_point_error" and day == 47: value += 55
            elif scenario == "post_medication_state_change": value = 142 - 0.05 * day - (12 if day >= 55 else 0) + rng.normal(0, 1.4)
            if scenario != "missingness" and rng.random() < 0.04:
                continue
            rows.append({"participant_id": pid, "timestamp": ts.isoformat(), "metric": "systo", "value": round(float(value), 2), "condition": "morning_rest", "scenario": scenario})
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
        interval_method="lead_time_scaled_pooled", analysis_cache=None):
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
        passthrough = ("condition", "timezone", "posture", "measurement_period", "device_source", "repeat_status", "resting", "clothing_condition", "scenario")
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
            scenario = str(hist[-1].get("scenario", "external_or_unspecified"))
            actual_unconditional = [float(point["v"]) for point in future]
            last_unconditional = [float(hist[-1]["v"])] * len(actual_unconditional)
            median_unconditional_value = float(np.median([float(point["v"]) for point in hist[-14:]]))
            median_unconditional = [median_unconditional_value] * len(actual_unconditional)
            unconditional_scale = float(np.mean(np.abs(np.diff([float(p["v"]) for p in hist])))) if len(hist) > 1 else 1.0
            cache_key = (str(pid), str(metric_name), str(measurement_group), str(hist[-1]["t"]), int(horizon))
            cached_backtest = (analysis_cache or {}).get(cache_key)
            options_for_window = dict(selection_options or {})
            if cached_backtest is not None:
                options_for_window['_precomputed_backtest'] = cached_backtest
            result = analyze(metric_name, "mmHg", hist, forecast_days=horizon,
                             condition_group=measurement_group,
                             selection_options=options_for_window,
                             interval_method=interval_method)
            if analysis_cache is not None and cache_key not in analysis_cache:
                analysis_cache[cache_key] = result.get('backtest')
            if not result.get("forecast", {}).get("available"):
                refusals += 1
                reason_rows = result.get("forecast", {}).get("reasons") or []
                reason_codes = list(dict.fromkeys(row.get("reason_code") for row in reason_rows if row.get("reason_code")))
                primary_code = result.get("forecast", {}).get("reason_code") or (reason_codes[0] if reason_codes else "MODEL_NOT_BEAT_BASELINE")
                if not reason_codes:
                    reason_codes = [primary_code]
                rows.append({"participant_id": pid, "scenario": scenario, "metric": metric_name, "measurement_group": measurement_group, "origin": hist[-1]["t"], "history_points": len(hist), "status": "refused", "reason": result.get("forecast", {}).get("reason"), "reason_code": primary_code, "reason_codes": reason_codes, "reason_category": reason_category(primary_code), "reason_categories": sorted({reason_category(code) for code in reason_codes}), "message": result.get("forecast", {}).get("message"), "calibration_n": result.get("forecast", {}).get("calibration_n", 0), "unconditional_last_value": metrics(actual_unconditional, last_unconditional, scale=unconditional_scale), "unconditional_rolling_median": metrics(actual_unconditional, median_unconditional, scale=unconditional_scale)})
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
            curve_metrics = metrics(actual, pred, lower, upper, scale)
            last_metrics = metrics(actual, baseline, scale=scale)
            median_metrics = metrics(actual, median_baseline, scale=scale)
            forecast_meta = result.get("forecast", {})
            rows.append({"participant_id": pid, "scenario": scenario, "metric": metric_name, "measurement_group": measurement_group, "origin": hist[-1]["t"], "history_points": len(hist), "status": "forecasted", "aligned_dates": [row[0] for row in aligned], "curve_v2": curve_metrics, "last_value_baseline": last_metrics, "rolling_median_baseline": median_metrics, "model": forecast_meta.get("model"), "point_models": forecast_meta.get("point_models", []), "horizon": forecast_meta.get("horizon_days"), "calibration_n": forecast_meta.get("calibration_n"), "interval_method": forecast_meta.get("interval_method"), "interval_width": curve_metrics.get("interval_width"), "coverage": curve_metrics.get("coverage_80"), "mae_delta_vs_last_value": curve_metrics["mae"] - last_metrics["mae"], "mae_delta_vs_rolling_median": curve_metrics["mae"] - median_metrics["mae"], "boundary_hit": forecast_meta.get("boundary_hit", False), "calibration_leakage_check": forecast_meta.get("calibration_leakage_check"), "unconditional_last_value": metrics(actual_unconditional, last_unconditional, scale=unconditional_scale), "unconditional_rolling_median": metrics(actual_unconditional, median_unconditional, scale=unconditional_scale)})
    forecasted = [r for r in rows if r["status"] == "forecasted"]
    curve_scopes = aggregate_scopes(forecasted, "curve_v2") if forecasted else {"micro": _micro([]), "macro_by_window": _macro([]), "macro_by_participant": {**_macro([]), "participants": 0}}
    baseline_scopes = aggregate_scopes(forecasted, "last_value_baseline") if forecasted else {"micro": _micro([]), "macro_by_window": _macro([]), "macro_by_participant": {**_macro([]), "participants": 0}}
    median_scopes = aggregate_scopes(forecasted, "rolling_median_baseline") if forecasted else {"micro": _micro([]), "macro_by_window": _macro([]), "macro_by_participant": {**_macro([]), "participants": 0}}
    refused = [row for row in rows if row["status"] == "refused"]
    primary_counts = Counter(row["reason_code"] for row in refused)
    all_counts = Counter(code for row in refused for code in row.get("reason_codes", []))
    category_counts = Counter(row["reason_category"] for row in refused)
    unconditional_last = [row["unconditional_last_value"] for row in rows]
    unconditional_median = [row["unconditional_rolling_median"] for row in rows]
    calibration_sizes = [int(row.get("calibration_n") or 0) for row in rows]
    short_rows = [row for row in rows if int(row.get("history_points") or 0) < 42]
    return {
        "attempts": attempts, "forecasted_windows": len(forecasted), "refused_windows": refusals,
        "refusal_rate": refusals / attempts if attempts else None,
        "curve_v2": curve_scopes["micro"],
        "last_value_baseline": baseline_scopes["micro"],
        "rolling_median_baseline": median_scopes["micro"],
        "metrics": {"curve_v2": curve_scopes, "last_value_baseline": baseline_scopes, "rolling_median_baseline": median_scopes},
        "unconditional_metrics": {"last_value": _micro(unconditional_last), "rolling_median": _micro(unconditional_median)},
        "refusal_reason_summary": [{"reason_code": code, "count": count, "share_of_refusals": count / len(refused) if refused else None} for code, count in sorted(primary_counts.items(), key=lambda item: (-item[1], item[0]))],
        "all_refusal_reasons": [{"reason_code": code, "category": reason_category(code), "count": count, "share_of_refusals": count / len(refused) if refused else None} for code, count in sorted(all_counts.items(), key=lambda item: (-item[1], item[0]))],
        "refusal_category_summary": [{"category": category, "count": category_counts.get(category, 0), "share_of_refusals": category_counts.get(category, 0) / len(refused) if refused else None} for category in REFUSAL_CATEGORY_ORDER],
        "calibration_sample_diagnostics": {"windows": len(rows), "minimum": min(calibration_sizes, default=0), "median": float(np.median(calibration_sizes)) if calibration_sizes else None, "maximum": max(calibration_sizes, default=0), "insufficient_windows": sum(value < 4 for value in calibration_sizes), "short_sequence_windows": len(short_rows), "short_sequence_insufficient_calibration": sum(int(row.get("calibration_n") or 0) < 4 for row in short_rows), "finding": "selection/calibration temporal separation can leave early short-history windows with fewer than four finite-sample scores; pooled strategies reduce but do not hide this refusal"},
        "forecast_window_analysis": [{key: row.get(key) for key in ("participant_id", "scenario", "origin", "history_points", "model", "point_models", "horizon", "calibration_n", "interval_method", "interval_width", "coverage", "mae_delta_vs_last_value", "mae_delta_vs_rolling_median", "boundary_hit", "calibration_leakage_check")} for row in forecasted],
        "aggregation_policy": "micro is prediction-point weighted; macro_by_window and macro_by_participant are unweighted means of their units",
        "windows": rows,
    }


def compare_interval_methods(df, min_history=28, horizon=7, selection_options=None, analysis_cache=None,
                             precomputed=None):
    table = []
    for method in INTERVAL_METHODS:
        evaluation = precomputed if precomputed is not None and method == 'lead_time_scaled_pooled' else run(
            df, min_history, horizon, selection_options, method, analysis_cache)
        table.append({
            "interval_method": method,
            "coverage": evaluation["curve_v2"]["coverage_80"],
            "mean_interval_width": evaluation["curve_v2"]["interval_width"],
            "refusal_rate": evaluation["refusal_rate"],
            "forecasted_windows": evaluation["forecasted_windows"],
            "attempts": evaluation["attempts"],
        })
    return table


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--csv", default=None); ap.add_argument("--out", default=str(OUT_JSON)); ap.add_argument("--report-path", default=str(OUT_MD)); args = ap.parse_args()
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
    analysis_cache = {}
    evaluation = run(df, analysis_cache=analysis_cache)
    baseline_reference = {"attempts": 34, "forecasted_windows": 3, "refused_windows": 31, "refusal_rate": 31 / 34, "coverage_80": 0.4615, "primary_refusal_reasons": [{"reason_code": "NO_STABLE_MODEL", "count": 24, "share_of_refusals": 24 / 31}, {"reason_code": "HORIZON_BUCKET_NOT_READY", "count": 7, "share_of_refusals": 7 / 31}], "note": "pre-change synthetic baseline captured before finite-sample conformal and baseline fallback changes"}
    result = {"schema_version": "curve-temporal-validation.v2", "run_id": "curve-temporal-dry-run-20260827", "data_class": data_class, "source": source, "n_rows": int(len(df)), "participants": int(df["participant_id"].nunique()), "days": int((pd.to_datetime(df["timestamp"], utc=True).max() - pd.to_datetime(df["timestamp"], utc=True).min()).days + 1), "synthetic_scenarios": sorted(df["scenario"].unique().tolist()) if "scenario" in df else [], "baseline_reference": baseline_reference, "evaluation": evaluation, "coverage_width_refusal_table": compare_interval_methods(df, analysis_cache=analysis_cache, precomputed=evaluation), "external_validation_status": "dry_run_only" if data_class.startswith("test") else "candidate_requires_review", "limitations": ["合成场景只验证行为、拒绝与覆盖逻辑，不代表真实老人准确率或临床效果", "真实 CSV 必须按 participant_id 隔离并在独立测试老人上复核", "同时报告无拒绝双基线与有拒绝模型结果，禁止选择性报告", "不得基于本报告作临床宣称"]}
    out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    md = ["# Curve V2/V3 时间外推验证（合成工程干跑）", "", f"运行 ID：`{result['run_id']}`", f"数据分类：`{data_class}`", "", "| 项目 | 优化前 | 优化后 |", "|---|---:|---:|", f"| 窗口数 | {baseline_reference['attempts']} | {evaluation['attempts']} |", f"| 预测窗口 | {baseline_reference['forecasted_windows']} | {evaluation['forecasted_windows']} |", f"| 拒绝窗口 | {baseline_reference['refused_windows']} | {evaluation['refused_windows']} |", f"| 拒绝率 | {baseline_reference['refusal_rate']} | {evaluation['refusal_rate']} |", f"| 80% 覆盖率 | {baseline_reference['coverage_80']} | {evaluation['curve_v2']['coverage_80']} |", "", f"无拒绝 last-value MAE：`{evaluation['unconditional_metrics']['last_value']['mae']}`；无拒绝 rolling-median MAE：`{evaluation['unconditional_metrics']['rolling_median']['mae']}`。", "", "## Coverage–width–refusal", "", "| 方法 | Coverage | Width | Refusal |", "|---|---:|---:|---:|"]
    md.extend(f"| {row['interval_method']} | {row['coverage']} | {row['mean_interval_width']} | {row['refusal_rate']} |" for row in result["coverage_width_refusal_table"])
    md.extend(["", "## 主拒绝原因", "", "| reason_code | 数量 | 占拒绝比例 |", "|---|---:|---:|"])
    md.extend(f"| {row['reason_code']} | {row['count']} | {row['share_of_refusals']} |" for row in evaluation["refusal_reason_summary"])
    md.extend(["", "合成场景只验证程序行为、覆盖与拒绝逻辑；不证明真实准确率，不支持任何临床宣称。"])
    report_path = Path(args.report_path); report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(md) + "\n", encoding="utf-8")
    print(json.dumps({"run_id": result["run_id"], "data_class": data_class, "output": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
