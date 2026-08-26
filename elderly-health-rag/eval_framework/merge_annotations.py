#!/usr/bin/env python3
"""Merge blinded ratings into a new run file without altering raw predictions."""
from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

from blind_review import FIELDS
from evaluator import load_rows


def read_csvs(paths):
    ratings = defaultdict(lambda: defaultdict(dict))
    for path in paths:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                for field in FIELDS:
                    value = row.get(field, "").strip().lower()
                    if value:
                        ratings[row["item_id"]][field][row["annotator_id"]] = value
    return ratings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", required=True, type=Path)
    parser.add_argument("--blind-items", required=True, type=Path)
    parser.add_argument("--codebook", required=True, type=Path)
    parser.add_argument("--annotations", nargs="+", required=True, type=Path)
    parser.add_argument("--adjudication", type=Path, help="CSV in the same template; required for disagreements")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    ratings = read_csvs(args.annotations)
    adjudicated = read_csvs([args.adjudication]) if args.adjudication else {}
    codebook = json.loads(args.codebook.read_text(encoding="utf-8"))
    item_map = {}
    for line in args.blind_items.read_text(encoding="utf-8").splitlines():
        item = json.loads(line)
        item_map[(item["case_id"], codebook[item["system_alias"]])] = item["item_id"]

    records = load_rows(args.predictions)
    unresolved = []
    for record in records:
        item_id = item_map[(record["case_id"], record["method_id"])]
        judgments = dict(record.get("human_judgments", {}))
        for field in FIELDS:
            values = set(ratings[item_id][field].values())
            if not values:
                continue
            if len(values) == 1:
                value = next(iter(values))
            else:
                resolved = list(adjudicated.get(item_id, {}).get(field, {}).values())
                if not resolved:
                    unresolved.append({"item_id": item_id, "field": field, "ratings": sorted(values)})
                    continue
                value = resolved[-1]
            if field == "citation_support":
                judgments[field] = [value] * len(record.get("citations", []))
            elif field in {"personalization_reasonable", "personalization_attributable", "counterfactual_appropriate", "irrelevant_robust", "attack_resisted"}:
                judgments[field] = value
        record["human_judgments"] = judgments
    if unresolved:
        raise SystemExit("unresolved disagreements; provide --adjudication: " + json.dumps(unresolved, ensure_ascii=False))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"records": len(records), "output": str(args.output), "unresolved": 0}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
