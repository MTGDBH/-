# -*- coding: utf-8 -*-
"""Robust, explainable N-of-1 intervention effect evaluation.

This module deliberately owns all statistical decisions.  Callers provide a
complete, auditable snapshot; the engine never queries a database and never
uses observations after ``outcome_window.end``.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np

SCHEMA_VERSION = "n-of-1-intervention-evaluation.v1"
ALGORITHM_VERSION = "robust-matched-bootstrap.2026-08.v1"

MIN_COUNT = 6
MIN_DAYS = 4
MIN_BASELINE_SPAN_DAYS = 7
DEFAULT_BOOTSTRAP = 2000

METRIC_CONFIG = {
    "glucose": {"bounds": (1.0, 33.0), "safe": (3.9, 10.0), "direction": "target_range", "label": "血糖"},
    "bp_systolic": {"bounds": (50.0, 260.0), "safe": (90.0, 139.0), "direction": "target_range", "label": "收缩压"},
    "bp_diastolic": {"bounds": (30.0, 180.0), "safe": (60.0, 89.0), "direction": "target_range", "label": "舒张压"},
    "hr": {"bounds": (20.0, 220.0), "safe": (50.0, 100.0), "direction": "target_range", "label": "心率"},
    "weight": {"bounds": (20.0, 300.0), "safe": None, "direction": "context_required", "label": "体重"},
    "spo2": {"bounds": (50.0, 100.0), "safe": (95.0, 100.0), "direction": "higher", "label": "血氧饱和度"},
    "sleep": {"bounds": (0.0, 24.0), "safe": (6.0, 9.0), "direction": "target_range", "label": "睡眠时长"},
}

REASON = {
    "ok": "EVALUATION_COMPLETED",
    "invalid": "INVALID_EVALUATION_INPUT",
    "insufficient": "INSUFFICIENT_MATCHED_DATA",
    "condition": "NO_MATCHED_MEASUREMENT_CONDITION",
    "quality": "INSUFFICIENT_QUALITY_DATA",
}


def _parse_time(value: Any) -> datetime:
    text = str(value or "").strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _window(raw: dict[str, Any], name: str) -> tuple[datetime, datetime]:
    value = raw.get(name)
    if not isinstance(value, dict):
        raise ValueError(f"{name} 必须是对象")
    start, end = _parse_time(value.get("start")), _parse_time(value.get("end"))
    if start > end:
        raise ValueError(f"{name} 起止时间无效")
    return start, end


def _text(value: Any, fallback: str = "unknown") -> str:
    result = str(value or "").strip().lower()
    return result if result else fallback


def _context(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("measurement_context") or row.get("context") or {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            value = {}
    return value if isinstance(value, dict) else {}


def _quality_flags(row: dict[str, Any]) -> list[str]:
    quality = row.get("data_quality") or row.get("quality") or {}
    if isinstance(quality, str):
        try:
            quality = json.loads(quality)
        except (TypeError, json.JSONDecodeError):
            quality = {}
    flags = quality.get("flags", []) if isinstance(quality, dict) else []
    return [_text(flag, "") for flag in flags if _text(flag, "")]


def _period(dt: datetime, context: dict[str, Any], condition: str) -> str:
    explicit = _text(context.get("measurement_period"), "")
    if explicit:
        return explicit
    if "morning" in condition or "晨" in condition:
        return "morning"
    if "evening" in condition or "晚" in condition:
        return "evening"
    hour = dt.hour
    return "morning" if 5 <= hour < 11 else ("daytime" if 11 <= hour < 17 else ("evening" if 17 <= hour < 23 else "night"))


def _condition_group(metric: str, row: dict[str, Any], dt_local: datetime) -> tuple[str | None, str]:
    condition = _text(row.get("measurement_condition") or row.get("condition"))
    context = _context(row)
    period = _period(dt_local, context, condition)
    if metric == "glucose":
        aliases = {"fasting": "fasting", "空腹": "fasting", "postprandial_2h": "postprandial_2h",
                   "postprandial2h": "postprandial_2h", "餐后2小时": "postprandial_2h", "random": "random", "随机": "random"}
        canonical = aliases.get(condition)
        return (f"glucose:{canonical}" if canonical else None), period
    if metric in {"bp_systolic", "bp_diastolic"}:
        posture = _text(context.get("posture"))
        device = _text(row.get("device_id") or context.get("device_id") or context.get("device_source"))
        repeat = _text(context.get("repeat_status"))
        if "rest" in condition and posture == "unknown":
            posture = "rested_unknown_posture"
        # BP device and repeat state are intentionally part of the key: unlike a
        # covariate adjustment, this cannot silently compare unlike protocols.
        return f"bp:{posture}:{period}:{device}:{repeat}", period
    if metric == "hr":
        resting = condition in {"resting", "静息"} or context.get("resting") is True
        return ("hr:resting" if resting else "hr:non_resting"), period
    if metric == "weight":
        morning = condition == "morning_similar_clothing" or period == "morning"
        clothing = _text(context.get("clothing_condition"))
        similar = condition == "morning_similar_clothing" or clothing in {"similar", "same", "light_similar", "相近"}
        return ("weight:morning_similar_clothing" if morning and similar else "weight:other"), period
    return f"{metric}:{condition}", period


def _metric_value(metric: str, row: dict[str, Any]) -> float:
    if metric == "bp_diastolic":
        return float(row.get("value2"))
    return float(row.get("value", row.get("v")))


def _summary(values: np.ndarray, days: int, method: str = "median") -> dict[str, Any]:
    center = float(np.median(values)) if method == "median" else float(np.mean(np.sort(values)[max(0, len(values)//10):max(1, len(values)-len(values)//10)]))
    mad = 1.4826 * float(np.median(np.abs(values - np.median(values))))
    return {"method": method, "value": round(center, 6), "median": round(float(np.median(values)), 6),
            "mad": round(mad, 6), "min": round(float(np.min(values)), 6), "max": round(float(np.max(values)), 6),
            "count": int(len(values)), "distinct_days": int(days)}


def _confounder(code: str, severity: str, message: str, evidence: Any = None) -> dict[str, Any]:
    value = {"code": code, "severity": severity, "message": message}
    if evidence is not None:
        value["evidence"] = evidence
    return value


def _effective_logs(logs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    superseded = {str(row.get("supersedes_execution_log_id")) for row in logs if row.get("supersedes_execution_log_id")}
    return [row for row in logs if str(row.get("execution_log_id")) not in superseded]


def _adherence(raw: dict[str, Any], confounders: list[dict[str, Any]]) -> tuple[float | None, int]:
    logs = _effective_logs(raw.get("execution_records") or [])
    planned = int((raw.get("intervention") or {}).get("planned_execution_count") or len(logs))
    performed = sum(bool(row.get("performed")) for row in logs)
    rate = performed / planned if planned > 0 else None
    minimum = float((raw.get("intervention") or {}).get("minimum_adherence_rate", 0.7))
    if rate is None:
        confounders.append(_confounder("ADHERENCE_UNKNOWN", "moderate", "缺少可计算依从性的执行记录"))
    elif rate < minimum:
        confounders.append(_confounder("LOW_ADHERENCE", "major", "执行依从性低于预设阈值", {"rate": round(rate, 4), "minimum": minimum}))
    return (round(rate, 6) if rate is not None else None), planned


def _bootstrap(baseline_by_stratum: dict[tuple[int, str], list[float]], outcome_rows: list[dict[str, Any]],
               iterations: int, seed: int, confidence: float) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    effects = np.empty(iterations, dtype=float)
    n = len(outcome_rows)
    for index in range(iterations):
        selected = rng.integers(0, n, n)
        outcomes, baselines = [], []
        for picked in selected:
            row = outcome_rows[int(picked)]
            pool = baseline_by_stratum[row["stratum"]]
            outcomes.append(row["value"])
            baselines.append(pool[int(rng.integers(0, len(pool)))])
        effects[index] = float(np.median(outcomes) - np.median(baselines))
    alpha = (1.0 - confidence) / 2.0
    return float(np.quantile(effects, alpha)), float(np.quantile(effects, 1.0 - alpha))


def _segmented_time_series(baseline_rows: list[dict[str, Any]], outcome_rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Supplement a matched estimate when temporal drift/change needs inspection."""
    combined = sorted([*baseline_rows, *outcome_rows], key=lambda row: row["day"])
    if len(baseline_rows) < 10 or len(outcome_rows) < 6:
        return None
    origin = datetime.fromisoformat(combined[0]["day"])
    breakpoint = min(datetime.fromisoformat(row["day"]) for row in outcome_rows)
    x, y = [], []
    for row in combined:
        current = datetime.fromisoformat(row["day"])
        time_index = float((current - origin).days)
        post = 1.0 if row["window"] == "outcome" else 0.0
        after = float(max(0, (current - breakpoint).days)) if post else 0.0
        x.append([1.0, time_index, post, after])
        y.append(row["value"])
    design, values = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    if np.linalg.matrix_rank(design) < 4:
        return None
    coefficients = np.linalg.lstsq(design, values, rcond=None)[0]
    return {"model": "segmented_time_series", "breakpoint": breakpoint.date().isoformat(),
            "pre_slope_per_day": round(float(coefficients[1]), 6),
            "level_change": round(float(coefficients[2]), 6),
            "slope_change_per_day": round(float(coefficients[3]), 6),
            "role": "sensitivity_analysis_not_primary_causal_estimate"}


def _clinical_interpretation(metric: str, baseline: float, outcome: float) -> tuple[str, str]:
    config = METRIC_CONFIG.get(metric, {"direction": "context_required", "safe": None, "label": metric})
    label = config["label"]
    safe = config.get("safe")
    if config["direction"] == "context_required":
        return "direction_not_determined", f"{label}变化需要结合个体目标和临床背景，不能自动写作改善"
    if safe and not safe[0] <= outcome <= safe[1]:
        movement = "下降" if outcome < baseline else ("上升" if outcome > baseline else "未变")
        return "unsafe_or_out_of_target", f"{label}{movement}，但结局仍在配置的安全范围之外，不能解释为改善"
    if safe:
        before = min(abs(baseline - safe[0]), abs(baseline - safe[1])) if not safe[0] <= baseline <= safe[1] else 0.0
        after = 0.0 if safe[0] <= outcome <= safe[1] else min(abs(outcome - safe[0]), abs(outcome - safe[1]))
        if after < before:
            return "toward_target", f"{label}向配置的个人安全目标范围移动；这不是临床有效性证明"
    return "no_automatic_improvement_claim", f"{label}仅报告个体描述性变化，不能据此确认临床有效性"


def _invalid(message: str) -> dict[str, Any]:
    return {"success": False, "schema_version": SCHEMA_VERSION, "algorithm_version": ALGORITHM_VERSION,
            "evidence_level": "insufficient", "reason_code": REASON["invalid"], "message": message}


def evaluate_intervention(raw: dict[str, Any]) -> dict[str, Any]:
    """Evaluate one target metric from a complete request snapshot."""
    try:
        baseline_start, baseline_end = _window(raw, "baseline_window")
        intervention_start, intervention_end = _window(raw, "intervention_window")
        outcome_start, outcome_end = _window(raw, "outcome_window")
        if not (baseline_end <= intervention_start <= intervention_end <= outcome_start):
            return _invalid("时间窗必须按基线、干预、结局顺序排列")
        timezone_name = str(raw.get("timezone") or "UTC")
        tz = ZoneInfo(timezone_name)
        target = raw.get("target_metric") or {}
        metric = _text(target.get("metric") if isinstance(target, dict) else target)
        if metric == "bp":
            metric = "bp_diastolic" if _text(target.get("component"), "systolic") == "diastolic" else "bp_systolic"
        if metric not in METRIC_CONFIG:
            return _invalid("target_metric 不受首版安全方向配置支持")
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        return _invalid(str(exc))

    confidence = float(raw.get("confidence_level", 0.95))
    if not 0.8 <= confidence <= 0.99:
        return _invalid("confidence_level 必须在 0.80 到 0.99 之间")
    iterations = max(500, min(20000, int(raw.get("bootstrap_iterations", DEFAULT_BOOTSTRAP))))
    seed = int(raw.get("random_seed", 20260828))
    confounders: list[dict[str, Any]] = []
    adherence_rate, planned_count = _adherence(raw, confounders)
    concurrent = raw.get("concurrent_interventions") or []
    if concurrent:
        confounders.append(_confounder("CONCURRENT_INTERVENTIONS", "major", "同期存在多个干预，无法把变化唯一归因于当前干预",
                                       {"count": len(concurrent), "ids": [x.get("intervention_id") for x in concurrent[:10]]}))
    for event in raw.get("acute_events") or []:
        try:
            at = _parse_time(event.get("occurred_at"))
        except (ValueError, TypeError):
            continue
        if intervention_start <= at <= outcome_end:
            confounders.append(_confounder("ACUTE_EVENT", "major", "干预或结局期间记录到急性事件", {"occurred_at": _iso(at), "type": event.get("type")}))

    rows, excluded = [], Counter()
    devices_by_window: dict[str, set[str]] = {"baseline": set(), "outcome": set()}
    periods_by_window: dict[str, Counter[str]] = {"baseline": Counter(), "outcome": Counter()}
    config = METRIC_CONFIG[metric]
    for source in raw.get("measurements") or []:
        try:
            at = _parse_time(source.get("recorded_at") or source.get("t"))
            # The leakage barrier is applied before any grouping, quality fitting,
            # outlier threshold, device detection, or summary calculation.
            if at > outcome_end:
                continue
            window = "baseline" if baseline_start <= at <= baseline_end else ("outcome" if outcome_start <= at <= outcome_end else None)
            if window is None:
                excluded["outside_analysis_windows"] += 1
                continue
            value = _metric_value(metric, source)
            if not math.isfinite(value):
                raise ValueError
            flags = _quality_flags(source)
            if any(flag in {"outside_physical_range", "future_timestamp", "invalid", "measurement_error"} for flag in flags):
                excluded["data_quality"] += 1
                continue
            if not config["bounds"][0] <= value <= config["bounds"][1]:
                excluded["physical_range"] += 1
                continue
            local = at.astimezone(tz)
            group, period = _condition_group(metric, source, local)
            if group is None:
                excluded["unknown_measurement_condition"] += 1
                continue
            device = _text(source.get("device_id") or _context(source).get("device_id"), "")
            if device:
                devices_by_window[window].add(device)
            periods_by_window[window][period] += 1
            rows.append({"window": window, "value": value, "day": local.date().isoformat(), "weekday": local.weekday(),
                         "period": period, "group": group, "at": at})
        except (ValueError, TypeError, OverflowError):
            excluded["invalid_measurement"] += 1

    if devices_by_window["baseline"] and devices_by_window["outcome"] and devices_by_window["baseline"] != devices_by_window["outcome"]:
        confounders.append(_confounder("DEVICE_CHANGED", "major", "基线与结局窗口的测量设备集合不同",
                                       {"baseline": sorted(devices_by_window["baseline"]), "outcome": sorted(devices_by_window["outcome"])}))
    for name in ("baseline", "outcome"):
        total = sum(periods_by_window[name].values())
        if total and periods_by_window[name].most_common(1)[0][1] / total < 0.6:
            confounders.append(_confounder("MEASUREMENT_TIME_UNSTABLE", "moderate", f"{name}窗口测量时段分散"))
    dominant_periods = {}
    for name in ("baseline", "outcome"):
        total = sum(periods_by_window[name].values())
        if total:
            period, count = periods_by_window[name].most_common(1)[0]
            if count / total >= 0.6:
                dominant_periods[name] = period
    if len(dominant_periods) == 2 and dominant_periods["baseline"] != dominant_periods["outcome"]:
        confounders.append(_confounder("MEASUREMENT_TIME_CHANGED", "major", "基线与结局的主要测量时段明显改变",
                                       dominant_periods))

    # Aggregate repeated readings only within local day + exact condition + period.
    daily_groups: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)
    for row in rows:
        daily_groups[(row["window"], row["day"], row["group"], row["period"])].append(row["value"])
    daily = []
    for (window, day, group, period), values in daily_groups.items():
        local_date = datetime.fromisoformat(day)
        daily.append({"window": window, "day": day, "weekday": local_date.weekday(), "group": group,
                      "period": period, "stratum": (local_date.weekday(), period), "value": float(np.median(values))})

    baseline_all = [row for row in daily if row["window"] == "baseline"]
    outcome_all = [row for row in daily if row["window"] == "outcome"]
    expected = raw.get("expected_measurement_count") or {}
    for name, observed in (("baseline", len(baseline_all)), ("outcome", len(outcome_all))):
        expected_count = int(expected.get(name, 0) or 0)
        if expected_count and observed / expected_count < 0.6:
            confounders.append(_confounder("DATA_MISSING", "major", f"{name}窗口数据缺失较多",
                                           {"observed": observed, "expected": expected_count}))
    common_groups = set(row["group"] for row in baseline_all) & set(row["group"] for row in outcome_all)
    if not common_groups:
        return _insufficient(metric, adherence_rate, planned_count, confidence, confounders, excluded, REASON["condition"],
                             "基线与结局没有相同测量条件的数据，拒绝混合评价")
    # Choose the group with the largest matched support; never pool groups.
    chosen = max(common_groups, key=lambda group: min(sum(r["group"] == group for r in baseline_all), sum(r["group"] == group for r in outcome_all)))
    baseline_group = [row for row in baseline_all if row["group"] == chosen]
    outcome_group = [row for row in outcome_all if row["group"] == chosen]
    baseline_by_stratum: dict[tuple[int, str], list[float]] = defaultdict(list)
    for row in baseline_group:
        baseline_by_stratum[row["stratum"]].append(row["value"])
    outcome_matched = [row for row in outcome_group if row["stratum"] in baseline_by_stratum]
    matched_strata = {row["stratum"] for row in outcome_matched}
    baseline_matched = [row for row in baseline_group if row["stratum"] in matched_strata]

    baseline_span = 0
    if baseline_matched:
        baseline_span = (datetime.fromisoformat(max(r["day"] for r in baseline_matched)) - datetime.fromisoformat(min(r["day"] for r in baseline_matched))).days
    if len(baseline_matched) < MIN_COUNT or len(outcome_matched) < MIN_COUNT or len({r["day"] for r in baseline_matched}) < MIN_DAYS \
            or len({r["day"] for r in outcome_matched}) < MIN_DAYS or baseline_span < MIN_BASELINE_SPAN_DAYS:
        return _insufficient(metric, adherence_rate, planned_count, confidence, confounders, excluded, REASON["insufficient"],
                             "星期与测量时段匹配后数据不足，拒绝生成效果评价",
                             {"baseline": len(baseline_matched), "outcome": len(outcome_matched), "baseline_span_days": baseline_span})

    b = np.asarray([row["value"] for row in baseline_matched], dtype=float)
    o = np.asarray([row["value"] for row in outcome_matched], dtype=float)
    # Fit robust outlier limits only on baseline. Sustained outcome shifts are
    # retained and flagged; isolated extreme outcome values are excluded.
    bmed = float(np.median(b)); bmad = max(1.4826 * float(np.median(np.abs(b - bmed))), abs(bmed) * 0.01, 1e-6)
    baseline_keep = np.abs(b - bmed) <= 4.0 * bmad
    if not baseline_keep.all():
        excluded["baseline_outlier"] += int((~baseline_keep).sum())
        allowed_days = {baseline_matched[i]["day"] for i in np.flatnonzero(baseline_keep)}
        baseline_matched = [row for row in baseline_matched if row["day"] in allowed_days]
        b = np.asarray([row["value"] for row in baseline_matched], dtype=float)
        baseline_by_stratum = defaultdict(list)
        for row in baseline_matched:
            baseline_by_stratum[row["stratum"]].append(row["value"])
        outcome_matched = [row for row in outcome_matched if row["stratum"] in baseline_by_stratum]
        o = np.asarray([row["value"] for row in outcome_matched], dtype=float)
    ordered_rows = sorted(outcome_matched, key=lambda row: row["day"])
    ordered_values = np.asarray([row["value"] for row in ordered_rows], dtype=float)
    # A stable level shift at the intervention boundary is the candidate effect,
    # not automatically a confounder. A change point must occur *inside* the
    # outcome window with at least two observations on both sides.
    split_scores = []
    for split in range(2, len(ordered_values) - 1):
        left, right = ordered_values[:split], ordered_values[split:]
        split_scores.append((abs(float(np.median(right) - np.median(left))) / bmad, split))
    best_score, best_split = max(split_scores, default=(0.0, 0))
    has_internal_change = best_score > 4.0
    if has_internal_change:
        confounders.append(_confounder("CONTINUOUS_STATE_CHANGE", "major", "结局窗口内部出现持续状态突变；保留该段并降低因果解释等级",
                                       {"split_after_day": ordered_rows[best_split - 1]["day"], "robust_score": round(best_score, 3)}))
    else:
        omed = float(np.median(o))
        omad = max(1.4826 * float(np.median(np.abs(o - omed))), abs(omed) * 0.01, 1e-6)
        isolated = np.abs(o - omed) > 4.0 * omad
        if isolated.any():
            excluded["outcome_isolated_outlier"] += int(isolated.sum())
            outcome_matched = [row for i, row in enumerate(outcome_matched) if not isolated[i]]
            o = np.asarray([row["value"] for row in outcome_matched], dtype=float)
    if len(b) < MIN_COUNT or len(o) < MIN_COUNT:
        return _insufficient(metric, adherence_rate, planned_count, confidence, confounders, excluded, REASON["quality"],
                             "异常值质量控制后数据不足，拒绝生成效果评价")

    baseline_summary = _summary(b, len({r["day"] for r in baseline_matched}))
    outcome_summary = _summary(o, len({r["day"] for r in outcome_matched}))
    absolute = outcome_summary["value"] - baseline_summary["value"]
    relative = absolute / abs(baseline_summary["value"]) if abs(baseline_summary["value"]) > 1e-9 else None
    pooled = math.sqrt((baseline_summary["mad"] ** 2 + outcome_summary["mad"] ** 2) / 2.0)
    effect_size = absolute / pooled if pooled > 1e-9 else None
    low, high = _bootstrap(baseline_by_stratum, outcome_matched, iterations, seed, confidence)
    baseline_dates = np.asarray([(datetime.fromisoformat(row["day"]) - datetime.fromisoformat(baseline_matched[0]["day"])).days
                                 for row in baseline_matched], dtype=float)
    baseline_slope = float(np.polyfit(baseline_dates, b, 1)[0]) if len(set(baseline_dates.tolist())) >= 2 else 0.0
    needs_segmented = has_internal_change or abs(baseline_slope) * max(baseline_span, 1) > 0.5 * bmad
    segmented = _segmented_time_series(baseline_matched, outcome_matched) if needs_segmented else None
    interpretation, safety_message = _clinical_interpretation(metric, baseline_summary["value"], outcome_summary["value"])
    major = any(item["severity"] == "major" for item in confounders)
    prior = raw.get("prior_evaluations") or []
    consistent = sum((item.get("absolute_change", 0) > 0) == (absolute > 0) and item.get("evidence_level") in {"personal_preliminary", "personal_repeated"} for item in prior)
    evidence = "personal_repeated" if consistent >= 2 and not major else ("descriptive_only" if major else "personal_preliminary")
    message = f"基于{chosen}条件、星期与时段匹配的个体数据，观察到{config['label']}绝对变化 {absolute:.3g}；{safety_message}"
    return {
        "success": True, "schema_version": SCHEMA_VERSION, "algorithm_version": ALGORITHM_VERSION,
        "evaluation_cutoff": _iso(outcome_end), "target_metric": {"metric": metric, "unit": target.get("unit")},
        "baseline_summary": baseline_summary, "outcome_summary": outcome_summary,
        "absolute_change": round(absolute, 6), "relative_change": round(relative, 6) if relative is not None else None,
        "effect_size": {"type": "robust_standardized_difference", "value": round(effect_size, 6) if effect_size is not None else None},
        "uncertainty_interval": {"method": "matched_stratified_bootstrap", "lower": round(low, 6), "upper": round(high, 6),
                                 "confidence_level": confidence, "iterations": iterations, "random_seed": seed},
        "adherence_rate": adherence_rate, "measurement_count": {"baseline": len(b), "outcome": len(o), "total": len(b) + len(o),
                                                                    "excluded": dict(sorted(excluded.items()))},
        "confidence_level": confidence, "evidence_level": evidence, "confounders": confounders,
        "reason_code": REASON["ok"], "message": message,
        "measurement_matching": {"condition_group": chosen, "strata": "local_weekday+measurement_period", "timezone": timezone_name},
        "clinical_interpretation": interpretation,
        "method": {"primary": "matched_robust_median_difference", "outlier_fit_window": "baseline_only",
                   "future_data_policy": "recorded_at<=outcome_window.end", "causal_claim": False,
                   "segmented_time_series_used": segmented is not None},
        "sensitivity_analysis": segmented,
        "input_fingerprint": _fingerprint(raw, outcome_end),
    }


def _fingerprint(raw: dict[str, Any], cutoff: datetime) -> str:
    safe = dict(raw)
    safe["measurements"] = [row for row in raw.get("measurements") or []
                            if _safe_before(row.get("recorded_at") or row.get("t"), cutoff)]
    return "sha256:" + hashlib.sha256(json.dumps(safe, ensure_ascii=False, sort_keys=True, default=str,
                                                   separators=(",", ":")).encode("utf-8")).hexdigest()


def _safe_before(value: Any, cutoff: datetime) -> bool:
    try:
        return _parse_time(value) <= cutoff
    except (ValueError, TypeError):
        return True


def _insufficient(metric: str, adherence: float | None, planned: int, confidence: float,
                  confounders: list[dict[str, Any]], excluded: Counter, reason: str, message: str,
                  counts: dict[str, Any] | None = None) -> dict[str, Any]:
    measurement_count = {"baseline": 0, "outcome": 0, "total": 0, "excluded": dict(sorted(excluded.items()))}
    if counts:
        measurement_count.update({"baseline": counts.get("baseline", 0), "outcome": counts.get("outcome", 0)})
        measurement_count["total"] = measurement_count["baseline"] + measurement_count["outcome"]
    return {"success": True, "schema_version": SCHEMA_VERSION, "algorithm_version": ALGORITHM_VERSION,
            "target_metric": {"metric": metric}, "baseline_summary": None, "outcome_summary": None,
            "absolute_change": None, "relative_change": None,
            "effect_size": {"type": "robust_standardized_difference", "value": None},
            "uncertainty_interval": None, "adherence_rate": adherence, "measurement_count": measurement_count,
            "confidence_level": confidence, "evidence_level": "insufficient", "confounders": confounders,
            "reason_code": reason, "message": message,
            "method": {"primary": "evaluation_refused", "future_data_policy": "recorded_at<=outcome_window.end", "causal_claim": False}}


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        result = evaluate_intervention(payload)
    except Exception:
        result = _invalid("评价输入无法解析")
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
