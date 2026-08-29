# -*- coding: utf-8 -*-
"""Validate and aggregate anonymized older-adult usability data.

Empty templates, synthetic fixtures, and undersized datasets never become a
completed human-study result.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter
from pathlib import Path
from statistics import median


REQUIRED = {
    "participant_id", "session_id", "role", "age_band", "assistive_accommodation", "consent_confirmed", "eligibility_confirmed",
    "case_id", "task_id", "condition", "task_order", "task_completed", "response_seconds",
    "help_count", "critical_understanding_score", "error_count", "error_type",
    "forecast_mistaken_as_diagnosis", "unsafe_advice", "urgent_recall", "scale_type",
    "sus_score", "ease_reading", "ease_navigation", "confidence_using", "perceived_burden",
    "withdrawn", "safety_event", "missing_reason", "notes",
}
CONDITIONS = {"template", "ordinary_rag", "graphrag", "product"}
BINARY = {
    "consent_confirmed", "eligibility_confirmed", "task_completed",
    "forecast_mistaken_as_diagnosis", "unsafe_advice", "urgent_recall", "withdrawn",
}
DIRECT_IDENTIFIER_COLUMNS = {"name", "full_name", "doctor_name", "id_card", "idcard", "phone", "address", "institution_name"}


def _text(row: dict, key: str) -> str:
    return str(row.get(key, "") or "").strip()


def _number(row: dict, key: str):
    raw = _text(row, key)
    if not raw:
        return None
    try:
        value = float(raw)
        return value if math.isfinite(value) else None
    except ValueError:
        return None


def _mean(values):
    values = [float(value) for value in values if value is not None]
    return round(sum(values) / len(values), 4) if values else None


def _wilson(successes: int, total: int):
    if total <= 0:
        return {"estimate": None, "lower": None, "upper": None, "n": 0}
    z = 1.959963984540054
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    half = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
    return {"estimate": round(p, 4), "lower": round(max(0, center - half), 4), "upper": round(min(1, center + half), 4), "n": total}


def analyze(path: Path) -> dict:
    errors, warnings, rows = [], [], []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = set(reader.fieldnames or [])
        direct = sorted(DIRECT_IDENTIFIER_COLUMNS & {field.lower() for field in fields})
        if direct:
            return {"status": "invalid", "errors": [f"direct identifier columns are forbidden: {direct}"], "n_rows": 0}
        missing = sorted(REQUIRED - fields)
        if missing:
            return {"status": "invalid", "errors": [f"missing columns: {missing}"], "n_rows": 0}
        seen = set()
        for line_no, row in enumerate(reader, 2):
            participant, session, task_id = (_text(row, key) for key in ("participant_id", "session_id", "task_id"))
            if not participant or not session or not task_id or not _text(row, "case_id"):
                errors.append(f"line {line_no}: anonymous participant/session/case/task identifiers are required")
            key = (participant, session, task_id, _text(row, "condition"))
            if key in seen:
                errors.append(f"line {line_no}: duplicate participant/session/task/condition")
            seen.add(key)
            if _text(row, "role") != "older_adult":
                errors.append(f"line {line_no}: role must be older_adult")
            if _text(row, "age_band") not in {"65-69", "70-79", "80-89", "90+"}:
                errors.append(f"line {line_no}: age_band must be 65-69, 70-79, 80-89, or 90+")
            if _text(row, "condition") not in CONDITIONS:
                errors.append(f"line {line_no}: condition must be one of {sorted(CONDITIONS)}")
            for field in BINARY:
                if _number(row, field) not in (0, 1):
                    errors.append(f"line {line_no}: {field} must be 0 or 1")
            if _number(row, "consent_confirmed") != 1 or _number(row, "eligibility_confirmed") != 1:
                errors.append(f"line {line_no}: consent and eligibility must be confirmed")
            for field in ("response_seconds", "help_count", "error_count"):
                value = _number(row, field)
                if value is None or value < 0:
                    errors.append(f"line {line_no}: {field} must be non-negative")
            score = _number(row, "critical_understanding_score")
            if score is None or score not in (0, 1, 2):
                errors.append(f"line {line_no}: critical_understanding_score must be 0, 1, or 2")
            scale_type = _text(row, "scale_type")
            if scale_type not in {"sus", "elderly_4item", "not_administered_this_row"}:
                errors.append(f"line {line_no}: invalid scale_type={scale_type or '<empty>'}")
            if scale_type == "sus":
                sus = _number(row, "sus_score")
                if sus is None or not 0 <= sus <= 100:
                    errors.append(f"line {line_no}: sus_score must be 0-100")
            if scale_type == "elderly_4item":
                for field in ("ease_reading", "ease_navigation", "confidence_using", "perceived_burden"):
                    value = _number(row, field)
                    if value is None or not 1 <= value <= 5:
                        errors.append(f"line {line_no}: {field} must be 1-5")
            if _number(row, "task_completed") == 0 and not _text(row, "missing_reason"):
                warnings.append(f"line {line_no}: incomplete task should include missing_reason")
            rows.append(row)

    if not rows:
        return {
            "status": "pending", "errors": [], "warnings": ["empty template; no real participant data"],
            "n_rows": 0, "older_adult_participants": 0, "primary_endpoints": {}, "secondary_endpoints": {},
            "safety": {}, "limitations": ["真实老人任务尚未执行；不得报告完成率、SUS 或理解度结果"],
        }
    participants = sorted({_text(row, "participant_id") for row in rows})
    synthetic = any(participant.upper().startswith(("SYN", "DEMO", "TEST")) for participant in participants)
    if len(participants) < 10:
        warnings.append(f"older_adult_participants={len(participants)} < minimum exploratory target 10")
    if synthetic:
        warnings.append("synthetic/demo/test identifiers detected; no real-person claim is allowed")
    by_condition = {}
    for condition in sorted(CONDITIONS):
        subset = [row for row in rows if _text(row, "condition") == condition]
        if not subset:
            continue
        completion = [int(_number(row, "task_completed")) for row in subset]
        times = [_number(row, "response_seconds") for row in subset if _number(row, "response_seconds") is not None]
        by_condition[condition] = {
            "n_task_rows": len(subset), "task_completion": _wilson(sum(completion), len(completion)),
            "response_seconds_median": median(times),
            "help_count_mean": _mean(_number(row, "help_count") for row in subset),
            "critical_understanding_mean_0_to_2": _mean(_number(row, "critical_understanding_score") for row in subset),
            "error_count_mean": _mean(_number(row, "error_count") for row in subset),
            "error_types": dict(Counter(_text(row, "error_type") or "none" for row in subset)),
        }
    survey_rows = {}
    for row in rows:
        if _text(row, "scale_type") != "not_administered_this_row":
            survey_rows[_text(row, "participant_id")] = row
    sus_values = [_number(row, "sus_score") for row in survey_rows.values() if _text(row, "scale_type") == "sus"]
    elderly_values = []
    for row in survey_rows.values():
        if _text(row, "scale_type") == "elderly_4item":
            values = [_number(row, "ease_reading"), _number(row, "ease_navigation"), _number(row, "confidence_using"), _number(row, "perceived_burden")]
            if all(value is not None for value in values):
                elderly_values.append(_mean([values[0], values[1], values[2], 6 - values[3]]))
    safety = {
        "diagnosis_misinterpretations": sum(_number(row, "forecast_mistaken_as_diagnosis") == 1 for row in rows),
        "unsafe_advice_events": sum(_number(row, "unsafe_advice") == 1 for row in rows),
        "urgent_recall_failures": sum(_number(row, "urgent_recall") == 0 for row in rows),
        "recorded_safety_events": sum(bool(_text(row, "safety_event")) for row in rows),
        "withdrawn_participants": len({_text(row, "participant_id") for row in rows if _number(row, "withdrawn") == 1}),
    }
    eligible = not errors and 10 <= len(participants) <= 15 and not synthetic
    return {
        "status": "exploratory_complete" if eligible else ("invalid" if errors else "pending"),
        "errors": errors, "warnings": warnings, "n_rows": len(rows), "older_adult_participants": len(participants),
        "primary_endpoints": {"task_metrics_by_condition": by_condition, "critical_understanding_definition": "0=错误/未答，1=部分正确，2=正确复述结论与边界"},
        "secondary_endpoints": {"sus_mean": _mean(sus_values), "elderly_4item_mean_1_to_5": _mean(elderly_values), "survey_participants": len(survey_rows)},
        "safety": safety,
        "missing_data_policy": "不填补任务完成、安全事件、求助或错误；连续时间仅描述可用观测数并报告缺失原因。",
        "limitations": ["探索性小样本人因评价，不代表临床有效性", "elderly_4item 是项目简化量表，不等同于经验证的 SUS", "参与者编号必须与身份映射分开保存"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    result = analyze(args.csv)
    result["input"] = str(args.csv.resolve())
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(2 if result["status"] == "invalid" else 0)


if __name__ == "__main__":
    main()
