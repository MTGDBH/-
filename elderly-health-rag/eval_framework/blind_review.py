#!/usr/bin/env python3
"""Create a method-blinded review package and annotation sheets."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
from pathlib import Path

from evaluator import load_registered_cases, load_rows

FIELDS = [
    "citation_support", "relation_correct", "urgency_correct", "abstention_correct",
    "personalization_reasonable", "personalization_attributable",
    "counterfactual_appropriate", "irrelevant_robust", "attack_resisted"
]


def alias_for(method, salt):
    digest = hashlib.sha256(f"{salt}:{method}".encode("utf-8")).hexdigest()[:10]
    return f"M-{digest.upper()}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", required=True, type=Path)
    parser.add_argument("--registry", type=Path, default=Path(__file__).parent / "datasets.json")
    parser.add_argument("--chunks", type=Path, default=Path(__file__).parent.parent / "output" / "chunks.json")
    parser.add_argument("--evidence-catalog", type=Path, default=Path(__file__).parent.parent / "output" / "chunks.json")
    parser.add_argument("--annotators", nargs="+", required=True)
    parser.add_argument("--salt", required=True, help="Private randomization salt; keep outside the reviewer package")
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    if len(set(args.annotators)) < 2:
        raise SystemExit("at least two distinct annotators are required")

    cases = {row["case_id"]: row for row in load_registered_cases(args.registry, args.chunks)}
    evidence = {row["id"]: row for row in json.loads(args.evidence_catalog.read_text(encoding="utf-8"))}
    records = load_rows(args.predictions)
    methods = sorted({row["method_id"] for row in records})
    codebook = {alias_for(method, args.salt): method for method in methods}
    reverse = {method: alias for alias, method in codebook.items()}
    items = []
    for row in records:
        case = cases[row["case_id"]]
        cited_ids = [cite["evidence_id"] for cite in row.get("citations", [])]
        reference_ids = sorted(set(cited_ids) | set(case["relevant_evidence_ids"]))
        items.append({
            "item_id": hashlib.sha256(f"{args.salt}:{row['case_id']}:{row['method_id']}".encode()).hexdigest()[:16],
            "system_alias": reverse[row["method_id"]],
            "dataset_split": row["dataset_split"],
            "case_id": row["case_id"],
            "question": case["question"],
            "audience": case["audience"],
            "patient_context": case["patient_context"],
            "answer": row["answer"],
            "actions": row.get("actions", []),
            "predicted_relations": row.get("predicted_relations", []),
            "citations": row.get("citations", []),
            "predicted_urgency": row["predicted_urgency"],
            "abstained": row["abstained"],
            "reference_evidence": [{"evidence_id": item_id, "text": evidence.get(item_id, {}).get("text", "[not in catalog]")} for item_id in reference_ids],
            "test_design": case.get("test_design", {"kind": "standard"})
        })
    random.Random(args.salt).shuffle(items)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    with (args.output_dir / "blind_items.jsonl").open("w", encoding="utf-8") as handle:
        for item in items:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")
    private_dir = args.output_dir / "private"
    private_dir.mkdir(exist_ok=True)
    (private_dir / "method_codebook.json").write_text(json.dumps(codebook, ensure_ascii=False, indent=2), encoding="utf-8")

    columns = ["item_id", "annotator_id", *FIELDS, "notes"]
    for annotator in sorted(set(args.annotators)):
        with (args.output_dir / f"annotation_{annotator}.csv").open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            for item in items:
                writer.writerow({"item_id": item["item_id"], "annotator_id": annotator})
    print(json.dumps({"items": len(items), "annotators": sorted(set(args.annotators)), "review_package": str(args.output_dir / "blind_items.jsonl"), "private_codebook": str(private_dir / "method_codebook.json")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
