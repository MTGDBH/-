# -*- coding: utf-8 -*-
"""Validate a real longitudinal Curve V2 candidate dataset before evaluation.

This validator never promotes a candidate to external evidence.  It only
checks whether the file is structurally eligible for a separate review run.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SCHEMA = json.loads((ROOT / "external_dataset_schema.json").read_text(encoding="utf-8"))


def parse_ts(value: str) -> datetime:
    text = str(value or "").strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def validate(path: Path) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    rows: list[dict] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = set(reader.fieldnames or [])
        missing = sorted(set(SCHEMA["required_columns"]) - fields)
        if missing:
            return {"valid": False, "errors": [f"missing required columns: {missing}"], "warnings": [], "n_rows": 0}
        for line_no, row in enumerate(reader, 2):
            try:
                ts = parse_ts(row.get("timestamp", ""))
            except Exception:
                errors.append(f"line {line_no}: invalid timestamp")
                continue
            try:
                value = float(row.get("value", ""))
            except Exception:
                errors.append(f"line {line_no}: value is not numeric")
                continue
            metric = str(row.get("metric", "")).strip()
            if metric not in SCHEMA["metrics"]:
                errors.append(f"line {line_no}: unsupported metric={metric}")
                continue
            condition = str(row.get("condition", "")).strip() or "unknown"
            allowed_conditions = SCHEMA["metrics"][metric]["condition"]
            if condition not in allowed_conditions:
                errors.append(f"line {line_no}: condition={condition} invalid for metric={metric}")
            source = str(row.get("source", "")).strip() or "unknown"
            if source not in SCHEMA["quality_gates"]["minimum_source_values"]:
                warnings.append(f"line {line_no}: source={source} is not an approved external source label")
            rows.append({"line": line_no, "participant_id": str(row.get("participant_id", "")).strip(), "timestamp": ts, "metric": metric, "value": value, "condition": condition, "source": source})

    keys = [(r["participant_id"], r["timestamp"], r["metric"], r["condition"]) for r in rows]
    for key, count in Counter(keys).items():
        if count > 1:
            errors.append(f"duplicate measurement key: {key} x{count}")
    if any(not row["participant_id"] for row in rows):
        errors.append("participant_id cannot be empty")
    if rows:
        span_days = (max(r["timestamp"] for r in rows) - min(r["timestamp"] for r in rows)).total_seconds() / 86400 + 1
    else:
        span_days = 0
        errors.append("dataset is empty")
    participants = sorted({r["participant_id"] for r in rows})
    by_series: dict[tuple[str, str, str], set] = defaultdict(set)
    for row in rows:
        by_series[(row["participant_id"], row["metric"], row["condition"])].add(row["timestamp"].date())
    short_series = [f"{key}:{len(days)} valid days" for key, days in by_series.items() if len(days) < SCHEMA["quality_gates"]["minimum_valid_days_for_7d_forecast"]]
    if len(participants) < SCHEMA["quality_gates"]["minimum_participants"]:
        warnings.append(f"participants={len(participants)} < recommended {SCHEMA['quality_gates']['minimum_participants']}")
    if span_days < SCHEMA["quality_gates"]["minimum_span_days"]:
        warnings.append(f"span_days={span_days:.1f} < minimum {SCHEMA['quality_gates']['minimum_span_days']}")
    if short_series:
        warnings.append(f"series below 7-day forecast gate: {len(short_series)}")
    return {"valid": not errors, "errors": errors, "warnings": warnings, "n_rows": len(rows), "participants": len(participants), "span_days": round(span_days, 2), "series": len(by_series), "short_series": short_series[:20], "data_class": "research_external_candidate"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    result = validate(args.csv)
    result["input"] = str(args.csv.resolve())
    result["schema_version"] = SCHEMA["schema_version"]
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
