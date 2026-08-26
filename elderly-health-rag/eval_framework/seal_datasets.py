#!/usr/bin/env python3
"""Create a preregistration seal for protected evaluation files."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, default=Path(__file__).parent / "datasets.json")
    parser.add_argument("--protocol-id", required=True)
    parser.add_argument("--custodian-id", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    registry = json.loads(args.registry.read_text(encoding="utf-8"))
    hashes = {}
    for entry in registry["datasets"]:
        path = (args.registry.parent / entry["source"]).resolve()
        hashes[entry["dataset_split"]] = sha256(path)
    seal = {"schema_version": "dataset-seal.v1", "sealed_at": datetime.now(timezone.utc).isoformat(), "protocol_id": args.protocol_id, "custodian_id": args.custodian_id, "dataset_hashes": hashes}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(seal, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(seal, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
