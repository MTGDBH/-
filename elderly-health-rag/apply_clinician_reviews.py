# -*- coding: utf-8 -*-
"""Create a versioned clinician-review decision artifact after full sign-off.

This command never overwrites relationships.json. It requires a complete,
validated complete review table and refuses to produce an importable artifact when
any relation is unsigned, needs revision, or is rejected.
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from validate_clinician_reviews import DECISIONS, MANIFEST, REQUIRED


ROOT = Path(__file__).resolve().parent
DEFAULT_OUT = ROOT / "output" / "clinician_review_decisions.v1.json"


def load_rows(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not REQUIRED.issubset(set(reader.fieldnames or [])):
            raise ValueError("review CSV missing required columns")
        return list(reader)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--apply", action="store_true", help="write versioned decision artifact; never overwrites live graph")
    args = parser.parse_args()
    rows = load_rows(args.csv)
    expected = {int(r["relation_index"]) for r in json.loads(MANIFEST.read_text(encoding="utf-8")).get("relations", [])}
    indexes = {int(r["relation_index"]) for r in rows if str(r.get("relation_index", "")).strip().isdigit()}
    errors = []
    if indexes != expected: errors.append("review table must contain exactly all relation_index rows")
    for row in rows:
        decision = str(row.get("decision", "")).strip()
        if decision not in DECISIONS: errors.append(f"relation {row.get('relation_index')}: missing or invalid decision")
        for field in ("reviewer_id", "reviewer_role", "reviewed_at", "review_version", "rationale"):
            if not str(row.get(field, "")).strip(): errors.append(f"relation {row.get('relation_index')}: missing {field}")
    unsafe = [r.get("relation_index") for r in rows if str(r.get("decision", "")).strip() in {"revise", "reject"}]
    if unsafe: errors.append(f"cannot create approved decision artifact; unresolved decisions: {unsafe[:10]}")
    payload = {
        "schema_version": "clinician-review-decisions.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": str(args.csv.resolve()),
        "reviewed_relations": len(rows), "approved_relations": len(rows) if not errors else 0,
        "status": "ready_to_import" if not errors else "blocked",
        "errors": errors,
        "policy": "This artifact is versioned and does not overwrite live GraphRAG; import requires a separate deployment review.",
        "decisions": [{k: row.get(k, "") for k in ("relation_index", "decision", "reviewer_id", "reviewer_role", "reviewed_at", "review_version", "rationale", "revision_text", "proposed_allowed_expression", "proposed_forbidden_expression")} for row in rows],
    }
    if args.apply:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": payload["status"], "errors": len(errors), "written": bool(args.apply), "out": str(args.out)}, ensure_ascii=False))
    raise SystemExit(0 if not errors else 1)


if __name__ == "__main__":
    main()
