# -*- coding: utf-8 -*-
"""Analyze anonymized human-evaluation data without fabricating study results."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


REQUIRED = {"participant_id", "role", "case_id", "condition", "comprehension_score", "found_recheck", "task_completed", "forecast_mistaken_as_diagnosis", "unsafe_advice", "urgent_recall"}
CONDITIONS = {"template", "ordinary_rag", "graphrag"}


def number(row: dict, key: str, default=None):
    raw = str(row.get(key, "")).strip()
    if raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def analyze(path: Path) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    rows: list[dict] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = sorted(REQUIRED - set(reader.fieldnames or []))
        if missing:
            return {"status": "invalid", "errors": [f"missing columns: {missing}"]}
        for line_no, row in enumerate(reader, 2):
            if row.get("condition") not in CONDITIONS:
                errors.append(f"line {line_no}: condition must be one of {sorted(CONDITIONS)}")
            if not row.get("participant_id") or not row.get("case_id"):
                errors.append(f"line {line_no}: participant_id and case_id are required")
            for key in ("found_recheck", "task_completed", "forecast_mistaken_as_diagnosis", "unsafe_advice", "urgent_recall"):
                val = number(row, key)
                if val not in (0, 1):
                    errors.append(f"line {line_no}: {key} must be 0 or 1")
            for key in ("comprehension_score", "doctor_evidence_score", "personalization_score"):
                val = number(row, key)
                if val is not None and not 1 <= val <= 5:
                    errors.append(f"line {line_no}: {key} must be 1-5")
            rows.append(row)
    older = {r.get("participant_id") for r in rows if r.get("role") == "older_adult"}
    clinicians = {r.get("participant_id") for r in rows if r.get("role") in ("clinician", "health_manager")}
    if len(older) < 15:
        warnings.append(f"older_adult_participants={len(older)} < target 15")
    if len(clinicians) < 3:
        warnings.append(f"clinician_participants={len(clinicians)} < target 3")
    by_condition = {}
    for condition in sorted(CONDITIONS):
        subset = [r for r in rows if r.get("condition") == condition]
        def mean(key):
            vals = [number(r, key) for r in subset]
            vals = [v for v in vals if v is not None]
            return round(sum(vals) / len(vals), 4) if vals else None
        by_condition[condition] = {
            "n_rows": len(subset),
            "comprehension_mean": mean("comprehension_score"),
            "recheck_find_rate": mean("found_recheck"),
            "task_completion_rate": mean("task_completed"),
            "diagnosis_misinterpretation_rate": mean("forecast_mistaken_as_diagnosis"),
            "unsafe_advice_rate": mean("unsafe_advice"),
            "urgent_recall": mean("urgent_recall"),
            "doctor_evidence_mean": mean("doctor_evidence_score"),
            "personalization_mean": mean("personalization_score"),
        }
    return {"status": "candidate" if not errors and rows else "incomplete", "errors": errors, "warnings": warnings, "n_rows": len(rows), "older_adult_participants": len(older), "clinician_participants": len(clinicians), "by_condition": by_condition, "limitations": ["未达到样本量前不输出研究结论", "匿名数据仍需伦理/知情同意和安全事件管理", "统计结果不代表临床有效性"]}


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


if __name__ == "__main__":
    main()
