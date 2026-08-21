# -*- coding: utf-8 -*-
"""Validate clinician review submissions without changing the live graph."""
from __future__ import annotations

import argparse
import csv
import json
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "output" / "relation_review_manifest.json"
DECISIONS = {"approve_education", "approve_with_guardrails", "needs_revision", "reject"}
REQUIRED = {
    "relation_index", "source", "target", "type", "strength", "evidence",
    "evidence_level", "clinician_decision", "clinician_id", "clinician_role",
    "review_date", "rationale", "signoff",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    expected = {int(r["relation_index"]) for r in manifest.get("relations", [])}
    errors = []
    rows = []
    with args.csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = sorted(REQUIRED - set(reader.fieldnames or []))
        if missing:
            errors.append(f"missing columns: {missing}")
        for line_no, row in enumerate(reader, 2):
            rows.append(row)
            try:
                idx = int(str(row.get("relation_index", "")).strip())
            except ValueError:
                errors.append(f"line {line_no}: relation_index must be integer")
                continue
            if idx not in expected:
                errors.append(f"line {line_no}: unknown relation_index={idx}")
            decision = str(row.get("clinician_decision", "")).strip()
            if decision and decision not in DECISIONS:
                errors.append(f"line {line_no}: invalid clinician_decision={decision}")
            if decision:
                for field in ("clinician_id", "clinician_role", "review_date", "rationale", "signoff"):
                    if not str(row.get(field, "")).strip():
                        errors.append(f"line {line_no}: {field} required when decision is filled")
                try:
                    date.fromisoformat(str(row.get("review_date", "")).strip())
                except ValueError:
                    errors.append(f"line {line_no}: review_date must be YYYY-MM-DD")
    indexes = []
    for row in rows:
        try: indexes.append(int(str(row.get("relation_index", "")).strip()))
        except ValueError: pass
    duplicates = sorted({x for x in indexes if indexes.count(x) > 1})
    if duplicates: errors.append(f"duplicate relation_index: {duplicates}")
    missing_rows = sorted(expected - set(indexes))
    if missing_rows: errors.append(f"missing relation_index rows: {missing_rows[:10]}" + ("..." if len(missing_rows) > 10 else ""))
    signed = [r for r in rows if str(r.get("clinician_decision", "")).strip()]
    complete = not errors and len(signed) == len(expected)
    result = {
        "status": "valid_submission" if complete else "pending",
        "review_complete": complete,
        "errors": errors, "expected_relations": len(expected), "rows": len(rows),
        "signed_rows": len(signed), "unsigned_rows": max(0, len(expected) - len(signed)),
        "decisions": {d: sum(str(r.get("clinician_decision", "")).strip() == d for r in rows) for d in sorted(DECISIONS)},
        "policy": "验证脚本不写入 live GraphRAG；只有项目组完成医生签字和复核后，才允许人工导入 approved 状态。",
    }
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if not errors else 1)


if __name__ == "__main__":
    main()
