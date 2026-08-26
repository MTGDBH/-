#!/usr/bin/env python3
"""Audit split isolation, duplicate questions, source targeting, and data seals."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from difflib import SequenceMatcher
from pathlib import Path

from evaluator import load_registered_cases


def normalized(text):
    return "".join(re.findall(r"[a-z0-9\u4e00-\u9fff]", str(text).lower()))


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_files(root):
    allowed = {".py", ".js", ".mjs", ".ts", ".tsx", ".json", ".md", ".yaml", ".yml"}
    excluded = {".git", ".venv", "node_modules", "output", "reports", "private-artifacts", "eval_framework", "eval"}
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in allowed and not any(part in excluded for part in path.parts):
            yield path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, default=Path(__file__).parent / "datasets.json")
    parser.add_argument("--chunks", type=Path, default=Path(__file__).parent.parent / "output" / "chunks.json")
    parser.add_argument("--source-root", type=Path, default=Path(__file__).parent.parent)
    parser.add_argument("--seal", type=Path)
    parser.add_argument("--similarity-threshold", type=float, default=0.88)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    findings = []
    cases = load_registered_cases(args.registry, args.chunks)

    for index, left in enumerate(cases):
        for right in cases[index + 1:]:
            if left["dataset_split"] == right["dataset_split"]:
                continue
            lq, rq = normalized(left["question"]), normalized(right["question"])
            similarity = SequenceMatcher(None, lq, rq).ratio()
            if lq == rq:
                findings.append({"severity": "error", "type": "exact_cross_split_question", "left": left["case_id"], "right": right["case_id"], "similarity": 1.0})
            elif similarity >= args.similarity_threshold:
                findings.append({"severity": "error", "type": "near_duplicate_cross_split_question", "left": left["case_id"], "right": right["case_id"], "similarity": round(similarity, 4)})

    protected = [case for case in cases if case["dataset_split"] in {"blind", "external"}]
    needles = [(case, normalized(case["question"]), case["case_id"]) for case in protected]
    for path in source_files(args.source_root):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        compact = normalized(text)
        for case, question, case_id in needles:
            if case_id in text or (len(question) >= 8 and question in compact):
                findings.append({"severity": "error", "type": "protected_case_in_implementation", "case_id": case_id, "file": str(path)})

    for split in ("blind", "external"):
        split_cases = [case for case in cases if case["dataset_split"] == split]
        if not split_cases:
            findings.append({"severity": "warning", "type": "missing_split_cases", "dataset_split": split})
        for case in split_cases:
            if case["adjudication_status"] != "adjudicated" or len(case["annotator_ids"]) < 2:
                findings.append({"severity": "error", "type": "unadjudicated_protected_case", "case_id": case["case_id"]})

    registry = json.loads(args.registry.read_text(encoding="utf-8"))
    current_hashes = {}
    for entry in registry["datasets"]:
        path = (args.registry.parent / entry["source"]).resolve()
        current_hashes[entry["dataset_split"]] = {"path": str(path), "sha256": sha256(path)}
    if args.seal:
        seal = json.loads(args.seal.read_text(encoding="utf-8"))
        sealed = seal.get("dataset_hashes", {})
        for split in ("blind", "external"):
            expected = sealed.get(split)
            actual = current_hashes.get(split, {}).get("sha256")
            if not expected:
                findings.append({"severity": "error", "type": "missing_protected_split_seal", "dataset_split": split})
            elif expected != actual:
                findings.append({"severity": "error", "type": "protected_split_changed_after_seal", "dataset_split": split, "expected": expected, "actual": actual})
    else:
        findings.append({"severity": "warning", "type": "seal_not_checked", "detail": "pass --seal for release audit"})

    report = {
        "schema_version": "leakage-audit.v1",
        "policy": "golden_questions is regression_internal and is not external validation",
        "dataset_hashes": current_hashes,
        "counts": {"error": sum(row["severity"] == "error" for row in findings), "warning": sum(row["severity"] == "warning" for row in findings)},
        "findings": findings,
        "pass": not any(row["severity"] == "error" for row in findings)
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["pass"] else 2)


if __name__ == "__main__":
    main()
