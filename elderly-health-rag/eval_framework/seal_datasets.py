#!/usr/bin/env python3
"""Create a preregistration seal for protected evaluation files."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, default=Path(__file__).parent / "datasets.json")
    parser.add_argument("--protocol-id", required=True)
    parser.add_argument("--custodian-id", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--require-ready", action="store_true", help="refuse to seal undersized or unadjudicated protected splits")
    args = parser.parse_args()
    registry = json.loads(args.registry.read_text(encoding="utf-8"))
    hashes = {}
    counts = {}
    readiness_errors = []
    for entry in registry["datasets"]:
        path = (args.registry.parent / entry["source"]).resolve()
        hashes[entry["dataset_split"]] = sha256(path)
        rows = json.loads(path.read_text(encoding="utf-8"))
        counts[entry["dataset_split"]] = len(rows)
        minimum = int(entry.get("recommended_minimum_cases") or 0)
        if args.require_ready and len(rows) < minimum:
            readiness_errors.append(f"{entry['dataset_split']} has {len(rows)} cases; requires at least {minimum}")
        if args.require_ready and entry["dataset_split"] in {"blind", "external"}:
            incomplete = [row.get("case_id") for row in rows if row.get("adjudication_status") != "adjudicated" or len(row.get("annotator_ids") or []) < 2]
            if incomplete:
                readiness_errors.append(f"{entry['dataset_split']} has unadjudicated cases: {incomplete[:10]}")
    if readiness_errors:
        raise SystemExit("dataset not ready to seal: " + "; ".join(readiness_errors))
    seal = {"schema_version": "dataset-seal.v2", "sealed_at": datetime.now(timezone.utc).isoformat(), "protocol_id": args.protocol_id, "custodian_id": args.custodian_id, "dataset_hashes": hashes, "dataset_counts": counts, "policy": "Any post-seal change requires a new protocol version; never edit cases in response to test performance."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(seal, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(seal, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
