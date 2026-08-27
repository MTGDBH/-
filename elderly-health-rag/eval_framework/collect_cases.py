#!/usr/bin/env python3
"""Build adjudicated protected cases from independent question and annotation sheets."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path


JSON_FIELDS = ("patient_context", "test_design", "relevant_evidence_ids", "acceptable_relations", "forbidden_claims")
LABEL_FIELDS = ("relevant_evidence_ids", "acceptable_relations", "forbidden_claims", "urgency_label", "required_abstention", "audience", "patient_context")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def parse_json(row, field, default):
    raw = str(row.get(field, "")).strip()
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{row.get('case_id')}: invalid {field}_json: {exc}") from exc


def normalized_label(row):
    return {
        "relevant_evidence_ids": parse_json(row, "relevant_evidence_ids_json", []),
        "acceptable_relations": parse_json(row, "acceptable_relations_json", []),
        "forbidden_claims": parse_json(row, "forbidden_claims_json", []),
        "urgency_label": str(row.get("urgency_label", "")).strip(),
        "required_abstention": str(row.get("required_abstention", "")).strip().lower() == "true",
        "audience": str(row.get("audience", "")).strip(),
        "patient_context": parse_json(row, "patient_context_json", {}),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=("blind", "external"), required=True)
    parser.add_argument("--questions", required=True, type=Path)
    parser.add_argument("--annotations", nargs="+", required=True, type=Path)
    parser.add_argument("--adjudication", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    questions = {row["case_id"].strip(): row for row in read_csv(args.questions) if row.get("case_id", "").strip()}
    ratings = defaultdict(list)
    for path in args.annotations:
        for row in read_csv(path):
            case_id, annotator_id = row.get("case_id", "").strip(), row.get("annotator_id", "").strip()
            if case_id and annotator_id:
                required_cells = ("relevant_evidence_ids_json", "acceptable_relations_json", "forbidden_claims_json", "urgency_label", "required_abstention", "audience", "patient_context_json")
                missing = [field for field in required_cells if not str(row.get(field, "")).strip()]
                if missing:
                    raise SystemExit(f"collection blocked: {case_id}/{annotator_id} missing annotation fields: {missing}")
                if str(row.get("required_abstention", "")).strip().lower() not in {"true", "false"}:
                    raise SystemExit(f"collection blocked: {case_id}/{annotator_id} required_abstention must be true or false")
                ratings[case_id].append((annotator_id, normalized_label(row)))
    adjudication = {row["case_id"].strip(): row for row in read_csv(args.adjudication)} if args.adjudication else {}
    cases, errors = [], []
    for case_id, question in questions.items():
        if not question.get("question", "").strip() or not question.get("question_author_id", "").strip():
            errors.append(f"{case_id}: question and anonymous question_author_id are required")
            continue
        if question.get("independence_attestation", "").strip().lower() != "true":
            errors.append(f"{case_id}: question author independence must be attested")
            continue
        case_ratings = ratings.get(case_id, [])
        annotators = sorted({annotator for annotator, _ in case_ratings})
        if len(annotators) < 2:
            errors.append(f"{case_id}: at least two distinct annotator_id values required")
            continue
        labels = [label for _, label in case_ratings]
        disagreement = any(json.dumps(label, ensure_ascii=False, sort_keys=True) != json.dumps(labels[0], ensure_ascii=False, sort_keys=True) for label in labels[1:])
        if disagreement:
            decision = adjudication.get(case_id)
            if not decision or not decision.get("adjudicator_id", "").strip() or not decision.get("rationale", "").strip():
                errors.append(f"{case_id}: disagreement requires adjudicator_id and rationale")
                continue
            final = normalized_label(decision)
            adjudication_meta = {"adjudicator_id": decision["adjudicator_id"].strip(), "rationale": decision["rationale"].strip(), "review_version": decision.get("review_version", "").strip()}
        else:
            final = labels[0]
            adjudication_meta = {"method": "independent_exact_agreement"}
        source_type = question.get("source_type", "").strip()
        if args.split == "external" and source_type not in {"clinician", "partner_institution"}:
            errors.append(f"{case_id}: external source_type must be clinician or partner_institution")
            continue
        cases.append({
            "case_id": case_id, "dataset_split": args.split, "question": question.get("question", "").strip(),
            **final, "annotator_ids": annotators, "adjudication_status": "adjudicated",
            "test_design": parse_json(question, "test_design_json", {"kind": "standard"}),
            "provenance": {
                "collection_name": "blind_internal" if args.split == "blind" else "external_clinician",
                "question_author_id": question.get("question_author_id", "").strip(),
                "question_author_independent_of_retrieval_development": question.get("independence_attestation", "").strip().lower() == "true",
                "source_type": source_type or "independent_internal_contributor",
                "institution_code": question.get("institution_code", "").strip() or None,
                "adjudication": adjudication_meta,
                "ai_generated_gold_standard": False,
            },
        })
    if errors:
        raise SystemExit("collection blocked: " + "; ".join(errors))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"dataset_split": args.split, "cases": len(cases), "output": str(args.output), "ai_generated_gold_standard": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
