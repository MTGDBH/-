#!/usr/bin/env python3
"""Validate collection completeness without inventing missing annotations."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from evaluator import load_registered_cases

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, default=Path(__file__).parent / "datasets.json")
    parser.add_argument("--chunks", type=Path, default=Path(__file__).parent.parent / "output" / "chunks.json")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--require-ready", action="store_true")
    args = parser.parse_args()
    registry = json.loads(args.registry.read_text(encoding="utf-8"))
    cases = load_registered_cases(args.registry, args.chunks)
    evidence_ids = {row["id"] for row in json.loads(args.chunks.read_text(encoding="utf-8"))}
    findings = []
    counts = {split: sum(row["dataset_split"] == split for row in cases) for split in ("regression_internal", "blind", "external")}
    if counts["regression_internal"] != 61:
        findings.append({"severity": "error", "code": "REGRESSION_COUNT_CHANGED", "actual": counts["regression_internal"], "expected": 61})
    for entry in registry["datasets"]:
        split = entry["dataset_split"]
        minimum = int(entry.get("recommended_minimum_cases") or 0)
        if counts.get(split, 0) < minimum:
            findings.append({"severity": "error" if args.require_ready else "warning", "code": "BELOW_RECOMMENDED_MINIMUM", "dataset_split": split, "actual": counts.get(split, 0), "minimum": minimum})
    seen = set()
    for case in cases:
        if case["case_id"] in seen:
            findings.append({"severity": "error", "code": "DUPLICATE_CASE_ID", "case_id": case["case_id"]})
        seen.add(case["case_id"])
        missing_evidence = sorted(set(case["relevant_evidence_ids"]) - evidence_ids)
        if missing_evidence:
            findings.append({"severity": "error", "code": "UNKNOWN_EVIDENCE_ID", "case_id": case["case_id"], "ids": missing_evidence})
        if case["dataset_split"] in {"blind", "external"}:
            if len(case.get("annotator_ids") or []) < 2 or case.get("adjudication_status") != "adjudicated":
                findings.append({"severity": "error", "code": "PROTECTED_CASE_NOT_DOUBLE_ANNOTATED", "case_id": case["case_id"]})
            provenance = case.get("provenance") or {}
            if provenance.get("ai_generated_gold_standard") is not False:
                findings.append({"severity": "error", "code": "AI_GOLD_STANDARD_NOT_EXPLICITLY_PROHIBITED", "case_id": case["case_id"]})
            if case["dataset_split"] == "blind" and provenance.get("question_author_independent_of_retrieval_development") is not True:
                findings.append({"severity": "error", "code": "BLIND_AUTHOR_INDEPENDENCE_NOT_ATTESTED", "case_id": case["case_id"]})
            if case["dataset_split"] == "external" and provenance.get("source_type") not in {"clinician", "partner_institution"}:
                findings.append({"severity": "error", "code": "EXTERNAL_SOURCE_NOT_ATTESTED", "case_id": case["case_id"]})
    report = {"schema_version": "dataset-integrity.v1", "counts": counts, "findings": findings, "ready_to_seal": not any(row["severity"] == "error" for row in findings) and counts["blind"] >= 100 and counts["external"] >= 50, "policy": "Empty or undersized protected splits remain not_collected; no synthetic or AI annotation is substituted."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if not any(row["severity"] == "error" for row in findings) else 2)


if __name__ == "__main__":
    main()
