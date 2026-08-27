#!/usr/bin/env python3
"""Agreement diagnostics for independent case labels; never adjudicates automatically."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from itertools import combinations
from pathlib import Path

from agreement import cohens_kappa, krippendorff_alpha_nominal
from collect_cases import normalized_label

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def jaccard(left, right):
    left, right = set(left), set(right)
    return len(left & right) / len(left | right) if left or right else 1.0


def relation_keys(paths):
    return {json.dumps(edge, ensure_ascii=False, sort_keys=True) for path in paths for edge in path.get("edges", [])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--annotations", nargs="+", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--minimum-kappa", type=float, default=0.60)
    parser.add_argument("--minimum-jaccard", type=float, default=0.70)
    args = parser.parse_args()
    ratings = defaultdict(dict)
    for path in args.annotations:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                if row.get("case_id") and row.get("annotator_id"):
                    ratings[row["case_id"]][row["annotator_id"]] = normalized_label(row)
    annotators = sorted({annotator for rows in ratings.values() for annotator in rows})
    categorical = {}
    for field in ("urgency_label", "required_abstention", "audience"):
        shaped = {case_id: {annotator: str(label[field]) for annotator, label in rows.items()} for case_id, rows in ratings.items()}
        score, n = cohens_kappa(shaped) if len(annotators) == 2 else krippendorff_alpha_nominal(shaped)
        categorical[field] = {"score": score, "items": n}
    multilabel = {}
    for field in ("relevant_evidence_ids", "forbidden_claims", "acceptable_relations"):
        values = []
        for rows in ratings.values():
            for left, right in combinations(rows.values(), 2):
                a = relation_keys(left[field]) if field == "acceptable_relations" else left[field]
                b = relation_keys(right[field]) if field == "acceptable_relations" else right[field]
                values.append(jaccard(a, b))
        multilabel[field] = {"mean_pairwise_jaccard": sum(values) / len(values) if values else None, "pairs": len(values)}
    low = [field for field, row in categorical.items() if row["score"] is None or row["score"] < args.minimum_kappa]
    low += [field for field, row in multilabel.items() if row["mean_pairwise_jaccard"] is None or row["mean_pairwise_jaccard"] < args.minimum_jaccard]
    result = {"schema_version": "case-annotation-agreement.v1", "annotator_count": len(annotators), "categorical": categorical, "multilabel": multilabel, "guideline_revision_required": bool(low), "fields_below_threshold": low, "policy": "Revise the annotation guide and retrain annotators before adjudication when agreement is insufficient; never alter labels to improve system scores."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
