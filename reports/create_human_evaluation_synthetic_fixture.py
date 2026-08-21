# -*- coding: utf-8 -*-
"""Generate a deterministic parser/pipeline fixture, never a human study result.

The values are deliberately synthetic and only exercise the CSV schema and
analysis code. They must not be used in a submission as comprehension,
completion, safety, or clinician evidence.
"""
from __future__ import annotations

import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "human-evaluation-synthetic-fixture.csv"
FIELDS = [
    "participant_id", "role", "case_id", "condition", "comprehension_score",
    "found_recheck", "task_completed", "forecast_mistaken_as_diagnosis",
    "unsafe_advice", "urgent_recall", "doctor_evidence_score",
    "personalization_score", "response_seconds", "notes",
]
CONDITIONS = ("template", "ordinary_rag", "graphrag")


def main() -> None:
    rows = []
    for i in range(1, 16):
        for j, condition in enumerate(CONDITIONS):
            rows.append({
                "participant_id": f"SYN_OLD_{i:02d}", "role": "older_adult",
                "case_id": f"paired_{(i - 1) % 6 + 1:02d}", "condition": condition,
                "comprehension_score": 3 + (j > 0) + ((i + j) % 2),
                "found_recheck": int(j > 0 or i % 3 == 0),
                "task_completed": int(j == 2 or i % 2 == 0),
                "forecast_mistaken_as_diagnosis": int(j == 0 and i % 4 == 0),
                "unsafe_advice": 0, "urgent_recall": 1,
                "doctor_evidence_score": "", "personalization_score": 3 + j,
                "response_seconds": 30 + j * 5 + i % 4,
                "notes": "synthetic fixture; not a human response",
            })
    for i in range(1, 4):
        for j, condition in enumerate(CONDITIONS):
            rows.append({
                "participant_id": f"SYN_CLN_{i:02d}", "role": "clinician",
                "case_id": f"paired_{(i - 1) % 6 + 1:02d}", "condition": condition,
                "comprehension_score": "", "found_recheck": 0, "task_completed": 0,
                "forecast_mistaken_as_diagnosis": 0, "unsafe_advice": 0, "urgent_recall": 1,
                "doctor_evidence_score": 3 + j, "personalization_score": 3 + j,
                "response_seconds": 0, "notes": "synthetic fixture; not clinician evidence",
            })
    OUT.write_text("", encoding="utf-8")
    with OUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader(); writer.writerows(rows)
    print({"output": str(OUT), "rows": len(rows), "participants": 18, "synthetic_only": True})


if __name__ == "__main__":
    main()
