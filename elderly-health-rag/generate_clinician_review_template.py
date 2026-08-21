# -*- coding: utf-8 -*-
"""Export a structured, blank clinician-review form from the frozen graph."""
from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "output" / "relation_review_manifest.json"
OUT = ROOT.parent / "reports" / "clinician-review-template.csv"
FIELDS = [
    "relation_index", "source", "target", "type", "strength", "evidence",
    "evidence_level", "ai_pre_review_status", "clinician_decision",
    "clinician_id", "clinician_role", "review_date", "rationale",
    "approved_wording", "forbidden_wording", "signoff",
]


def main() -> None:
    payload = json.loads(MANIFEST.read_text(encoding="utf-8"))
    rows = []
    for row in payload.get("relations", []):
        rows.append({
            "relation_index": row.get("relation_index"), "source": row.get("source"),
            "target": row.get("target"), "type": row.get("type"),
            "strength": row.get("strength"), "evidence": row.get("evidence"),
            "evidence_level": row.get("evidence_level"),
            "ai_pre_review_status": row.get("ai_pre_review_status", ""),
            "clinician_decision": "", "clinician_id": "", "clinician_role": "",
            "review_date": "", "rationale": "", "approved_wording": "",
            "forbidden_wording": "", "signoff": "",
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader(); writer.writerows(rows)
    print(json.dumps({"output": str(OUT), "rows": len(rows), "blank_signoffs": len(rows)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
