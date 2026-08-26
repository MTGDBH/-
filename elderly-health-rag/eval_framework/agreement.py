#!/usr/bin/env python3
"""Compute Cohen's kappa (two raters) or nominal Krippendorff's alpha."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


def load_annotations(paths, field):
    rows = defaultdict(dict)
    for path in paths:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                value = row.get(field, "").strip().lower()
                if value:
                    rows[row["item_id"]][row["annotator_id"]] = value
    return rows


def cohens_kappa(rows):
    complete = [list(ratings.values()) for ratings in rows.values() if len(ratings) == 2]
    if not complete:
        return None, 0
    observed = sum(left == right for left, right in complete) / len(complete)
    left_counts, right_counts = Counter(row[0] for row in complete), Counter(row[1] for row in complete)
    categories = set(left_counts) | set(right_counts)
    expected = sum((left_counts[c] / len(complete)) * (right_counts[c] / len(complete)) for c in categories)
    return ((observed - expected) / (1 - expected) if expected < 1 else 1.0), len(complete)


def krippendorff_alpha_nominal(rows):
    usable = [list(ratings.values()) for ratings in rows.values() if len(ratings) >= 2]
    if not usable:
        return None, 0
    observed_numerator = observed_denominator = 0.0
    pooled = Counter()
    for ratings in usable:
        pooled.update(ratings)
        discordant_unordered = 0
        for i in range(len(ratings)):
            for j in range(i + 1, len(ratings)):
                discordant_unordered += ratings[i] != ratings[j]
        # Krippendorff's coincidence weighting gives every unit total weight m.
        observed_numerator += 2 * discordant_unordered / (len(ratings) - 1)
        observed_denominator += len(ratings)
    observed = observed_numerator / observed_denominator
    total = sum(pooled.values())
    expected = 1 - sum(count * (count - 1) for count in pooled.values()) / (total * (total - 1)) if total > 1 else 0
    return (1 - observed / expected if expected else 1.0), len(usable)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--annotations", nargs="+", required=True, type=Path)
    parser.add_argument("--fields", nargs="+", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    annotators = set()
    for path in args.annotations:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            annotators.update(row["annotator_id"] for row in csv.DictReader(handle) if row.get("annotator_id"))
    method = "cohens_kappa" if len(annotators) == 2 else "krippendorff_alpha_nominal"
    result = {"agreement_method": method, "annotator_count": len(annotators), "fields": {}}
    for field in args.fields:
        rows = load_annotations(args.annotations, field)
        score, item_count = cohens_kappa(rows) if method == "cohens_kappa" else krippendorff_alpha_nominal(rows)
        result["fields"][field] = {"score": None if score is None else round(score, 6), "items": item_count}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
