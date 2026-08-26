#!/usr/bin/env python3
"""Leakage-resistant GraphRAG evaluator.

The evaluator contains no question text, answer keys, disease keyword lists, or
case-specific scoring rules. It scores only preregistered IDs/labels and blind
human judgments. Metrics are emitted independently for every split and method.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_rows(path: Path):
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    if path.suffix.lower() == ".jsonl":
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    data = json.loads(text)
    return data if isinstance(data, list) else data.get("records", [])


def legacy_golden_adapter(source: Path, chunks_path: Path):
    """Map the untouched historical golden set to regression_internal.

    Qrels retain their historical engineering provenance; this does not turn
    them into independent clinical or external annotations.
    """
    chunks = read_json(chunks_path)
    cases = []
    for old in read_json(source):
        terms = old.get("must_have_any") or ([old["must_have"]] if old.get("must_have") else [])
        relevant = []
        for chunk in chunks:
            scope_ok = not old.get("disease") or chunk.get("disease") == old["disease"]
            haystack = f"{chunk.get('section', '')} {chunk.get('text', '')}"
            if scope_ok and any(term in haystack for term in terms):
                relevant.append(chunk["id"])
        cases.append({
            "case_id": f"regression_internal:{old['id']}",
            "dataset_split": "regression_internal",
            "question": old["question"],
            "audience": "elderly",
            "patient_context": {},
            "relevant_evidence_ids": sorted(set(relevant)),
            "acceptable_relations": [],
            "forbidden_claims": [],
            "urgency_label": "emergency" if old.get("urgent") else "routine",
            "required_abstention": False,
            "annotator_ids": [],
            "adjudication_status": "unannotated",
            "test_design": {"kind": "standard"},
            "provenance": {
                "source": str(source), "legacy_case_id": old["id"],
                "qrel_policy": "legacy disease scope plus must_have evidence concept",
                "validation_role": "regression_only"
            }
        })
    return cases


def validate_case(case):
    required = {
        "case_id", "dataset_split", "question", "audience", "patient_context",
        "relevant_evidence_ids", "acceptable_relations", "forbidden_claims",
        "urgency_label", "required_abstention", "annotator_ids", "adjudication_status"
    }
    missing = sorted(required - set(case))
    if missing:
        raise ValueError(f"case {case.get('case_id', '<unknown>')} missing: {missing}")
    if case["dataset_split"] not in {"regression_internal", "blind", "external"}:
        raise ValueError(f"invalid dataset_split in {case['case_id']}")
    if case["dataset_split"] in {"blind", "external"} and case["adjudication_status"] == "adjudicated" and len(case["annotator_ids"]) < 2:
        raise ValueError(f"adjudicated case {case['case_id']} requires at least two annotators")


def load_registered_cases(registry_path: Path, chunks_path: Path):
    registry = read_json(registry_path)
    cases = []
    for entry in registry["datasets"]:
        source = (registry_path.parent / entry["source"]).resolve()
        if entry["loader"] == "legacy_golden_adapter":
            loaded = legacy_golden_adapter(source, chunks_path)
        elif entry["loader"] == "unified_case":
            loaded = read_json(source)
        else:
            raise ValueError(f"unknown loader: {entry['loader']}")
        for case in loaded:
            validate_case(case)
            if case["dataset_split"] != entry["dataset_split"]:
                raise ValueError(f"registry/case split mismatch: {case['case_id']}")
        cases.extend(loaded)
    ids = [case["case_id"] for case in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate case_id across registered datasets")
    return cases


def dcg(gains):
    return sum(gain / math.log2(rank + 2) for rank, gain in enumerate(gains))


def edge_key(edge):
    return edge.get("source"), edge.get("relation", edge.get("type")), edge.get("target")


def relation_path_correct(predicted, acceptable):
    predicted_keys = [edge_key(edge) for edge in predicted]
    for path in acceptable:
        gold = [edge_key(edge) for edge in path.get("edges", [])]
        if gold and all(key in predicted_keys for key in gold):
            return True
    return False


def mean(values):
    return sum(values) / len(values) if values else None


def answer_signature(record):
    actions = record.get("actions") or []
    return json.dumps({"answer": record.get("answer", "").strip(), "actions": actions}, ensure_ascii=False, sort_keys=True)


def evaluate_group(cases, records):
    failures, values = [], defaultdict(list)
    case_by_id = {case["case_id"]: case for case in cases}
    record_by_case = {}
    for record in records:
        case = case_by_id[record["case_id"]]
        record_by_case[record["case_id"]] = record
        raw_ranked = [row["evidence_id"] for row in record.get("retrieved_evidence", [])]
        ranked = list(dict.fromkeys(raw_ranked))
        if len(ranked) != len(raw_ranked):
            failures.append((case, record, "duplicate_retrieval_id", "duplicate IDs were ignored for rank metrics"))
        relevant = set(case["relevant_evidence_ids"])
        kind = case.get("test_design", {}).get("kind", "standard")
        if not case["required_abstention"] and kind not in {"prompt_injection", "malicious_question"}:
            values["qrel_coverage_rate"].append(float(bool(relevant)))
            if not relevant:
                failures.append((case, record, "missing_qrel", "non-abstention case has no relevant evidence IDs"))
        for k in (1, 3, 5, 10):
            score = len(set(ranked[:k]) & relevant) / len(relevant) if relevant else None
            if score is not None:
                values[f"recall@{k}"].append(score)
        first = next((rank for rank, item in enumerate(ranked, 1) if item in relevant), None)
        if relevant:
            values["mrr"].append(1 / first if first else 0.0)
            gains = [1.0 if item in relevant else 0.0 for item in ranked[:10]]
            ideal = [1.0] * min(10, len(relevant))
            values["ndcg@10"].append(dcg(gains) / dcg(ideal))
            if not set(ranked[:5]) & relevant:
                failures.append((case, record, "retrieval_miss", "no relevant evidence in top 5"))

        acceptable = case.get("acceptable_relations", [])
        if acceptable:
            correct = relation_path_correct(record.get("predicted_relations", []), acceptable)
            values["relation_path_accuracy"].append(float(correct))
            if not correct:
                failures.append((case, record, "relation_path_error", "no complete acceptable path predicted"))

        retrieved = set(ranked)
        citations = record.get("citations", [])
        if citations:
            structural = sum(cite.get("evidence_id") in retrieved for cite in citations) / len(citations)
            values["citation_retrieval_consistency"].append(structural)
        support = record.get("human_judgments", {}).get("citation_support", [])
        if support and len(support) != len(citations):
            raise ValueError(f"citation_support count does not match citations: {case['case_id']}")
        decided = [value for value in support if value in {"yes", "no"}]
        if decided:
            rate = sum(value == "yes" for value in decided) / len(decided)
            values["citation_support_rate"].append(rate)
            if rate < 1:
                failures.append((case, record, "unsupported_citation", f"support={rate:.3f}"))

        actual_urgent = case["urgency_label"] in {"emergency", "urgent"}
        predicted_urgent = record["predicted_urgency"] in {"emergency", "urgent"}
        if actual_urgent:
            miss = not predicted_urgent
            values["urgent_miss_rate"].append(float(miss))
            if miss:
                failures.append((case, record, "urgent_miss", f"predicted={record['predicted_urgency']}"))
        else:
            false_alarm = predicted_urgent
            values["urgent_false_alarm_rate"].append(float(false_alarm))
            if false_alarm:
                failures.append((case, record, "urgent_false_alarm", f"predicted={record['predicted_urgency']}"))

        if case["required_abstention"]:
            values["required_abstention_rate"].append(float(record["abstained"]))
            if not record["abstained"]:
                failures.append((case, record, "missing_abstention", "answer given when abstention required"))
        else:
            values["unnecessary_abstention_rate"].append(float(record["abstained"]))

        violations = set(record.get("asserted_claim_ids", [])) & set(case["forbidden_claims"])
        values["forbidden_claim_violation_rate"].append(float(bool(violations)))
        if violations:
            failures.append((case, record, "forbidden_claim", ",".join(sorted(violations))))

        judgment = record.get("human_judgments", {})
        if kind in {"prompt_injection", "malicious_question"}:
            decided_attack = judgment.get("attack_resisted")
            if decided_attack in {"yes", "no"}:
                values["attack_resistance_rate"].append(float(decided_attack == "yes"))
                if decided_attack == "no":
                    failures.append((case, record, "attack_succeeded", kind))

    pairs = defaultdict(dict)
    for case in cases:
        design = case.get("test_design", {})
        if design.get("pair_id") and case["case_id"] in record_by_case:
            pairs[(design.get("kind"), design["pair_id"])][design.get("variant")] = (case, record_by_case[case["case_id"]])
    for (kind, pair_id), variants in pairs.items():
        if not {"baseline", "intervention"} <= set(variants):
            continue
        base_case, base = variants["baseline"]
        intervention_case, intervention = variants["intervention"]
        changed = answer_signature(base) != answer_signature(intervention)
        judgment = intervention.get("human_judgments", {})
        if kind == "personalization":
            triggers = set(intervention_case.get("test_design", {}).get("trigger_factors", []))
            used = set(intervention.get("personalization", {}).get("used_context_factors", []))
            grounded_trigger = bool(used) and used <= triggers and all(factor in intervention_case["patient_context"] for factor in used)
            reasonable = judgment.get("personalization_reasonable") == "yes"
            attributable = judgment.get("personalization_attributable") == "yes"
            valid = changed and grounded_trigger and reasonable and attributable
            values["personalization_valid_rate"].append(float(valid))
            if not valid:
                detail = f"changed={changed}; grounded_trigger={grounded_trigger}; reasonable={reasonable}; attributable={attributable}"
                failures.append((intervention_case, intervention, "invalid_personalization", detail))
        elif kind == "counterfactual_evidence_deletion":
            values["counterfactual_changed_rate"].append(float(changed))
            appropriate = judgment.get("counterfactual_appropriate")
            if appropriate in {"yes", "no"}:
                values["counterfactual_appropriate_rate"].append(float(appropriate == "yes"))
                if appropriate == "no":
                    failures.append((intervention_case, intervention, "counterfactual_failure", f"pair={pair_id}; changed={changed}"))
        elif kind == "irrelevant_record_robustness":
            invariant = not changed
            values["irrelevant_record_invariance_rate"].append(float(invariant))
            robust = judgment.get("irrelevant_robust")
            if robust in {"yes", "no"}:
                values["irrelevant_record_robust_rate"].append(float(robust == "yes"))
                if robust == "no":
                    failures.append((intervention_case, intervention, "irrelevant_record_failure", f"pair={pair_id}; invariant={invariant}"))

    metrics = {name: round(mean(scores), 6) for name, scores in sorted(values.items()) if scores}
    metrics["applicable_counts"] = {name: len(scores) for name, scores in sorted(values.items())}
    metrics["case_count"] = len(records)
    metrics["failure_count"] = len(failures)
    return metrics, failures


def apply_gates(report, gate_config):
    result = {"release_ready": True, "splits": {}}
    direction = gate_config.get("direction", {})
    for split in gate_config["required_splits"]:
        methods = report["splits"].get(split, {}).get("methods", {})
        split_result = {"status": "pass", "methods": {}}
        if not methods:
            split_result["status"] = "blocked_missing_data"
            result["release_ready"] = False
        for method, metrics in methods.items():
            checks = []
            expected = report["splits"][split].get("registered_case_count", 0)
            checks.append({"metric": "prediction_completeness", "value": metrics.get("case_count", 0), "threshold": expected, "direction": "exact", "pass": metrics.get("case_count", 0) == expected})
            minimum = gate_config["minimum_cases"].get(split, 0)
            checks.append({"metric": "case_count", "value": metrics.get("case_count", 0), "threshold": minimum, "direction": "min", "pass": metrics.get("case_count", 0) >= minimum})
            for metric, threshold in gate_config["thresholds"].get(split, {}).items():
                value = metrics.get(metric)
                mode = direction.get(metric, "min")
                passed = value is not None and (value <= threshold if mode == "max" else value >= threshold)
                checks.append({"metric": metric, "value": value, "threshold": threshold, "direction": mode, "pass": passed})
            status = "pass" if all(check["pass"] for check in checks) else "fail"
            split_result["methods"][method] = {"status": status, "checks": checks}
            if status != "pass":
                split_result["status"] = "fail"
                result["release_ready"] = False
        result["splits"][split] = split_result
    return result


def write_failure_csv(path, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["dataset_split", "method_id", "case_id", "error_type", "detail", "question"])
        writer.writeheader()
        for case, record, error_type, detail in rows:
            writer.writerow({"dataset_split": case["dataset_split"], "method_id": record["method_id"], "case_id": case["case_id"], "error_type": error_type, "detail": detail, "question": case["question"]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", required=True, type=Path)
    parser.add_argument("--registry", type=Path, default=HERE / "datasets.json")
    parser.add_argument("--chunks", type=Path, default=ROOT / "output" / "chunks.json")
    parser.add_argument("--gates", type=Path, default=HERE / "release_gates.json")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    cases = load_registered_cases(args.registry, args.chunks)
    case_by_id = {case["case_id"]: case for case in cases}
    records = load_rows(args.predictions)
    seen = set()
    for record in records:
        if record["case_id"] not in case_by_id:
            raise ValueError(f"prediction references unknown case: {record['case_id']}")
        case = case_by_id[record["case_id"]]
        if record["dataset_split"] != case["dataset_split"]:
            raise ValueError(f"prediction/case split mismatch: {record['case_id']}")
        key = (record["case_id"], record["method_id"])
        if key in seen:
            raise ValueError(f"duplicate prediction: {key}")
        seen.add(key)

    report = {"schema_version": "graphrag-evaluation-report.v1", "generated_at": datetime.now(timezone.utc).isoformat(), "policy": "No cross-split averages are computed.", "splits": {}}
    all_failures = []
    global_methods = sorted({row["method_id"] for row in records})
    for split in ("regression_internal", "blind", "external"):
        registered_cases = [case for case in cases if case["dataset_split"] == split]
        split_records = [row for row in records if row["dataset_split"] == split]
        methods = {}
        for method in (global_methods if registered_cases else []):
            subset = [row for row in split_records if row["method_id"] == method]
            metrics, failures = evaluate_group([case_by_id[row["case_id"]] for row in subset], subset)
            methods[method] = metrics
            all_failures.extend(failures)
        report["splits"][split] = {"methods": methods, "registered_case_count": len(registered_cases), "predicted_case_count": len({row["case_id"] for row in split_records})}
    report["release_gate"] = apply_gates(report, read_json(args.gates))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "metrics_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    for split, payload in report["splits"].items():
        (args.output_dir / f"metrics_{split}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    write_failure_csv(args.output_dir / "failure_cases.csv", all_failures)
    print(json.dumps({"report": str(args.output_dir / "metrics_report.json"), "failure_table": str(args.output_dir / "failure_cases.csv"), "release_ready": report["release_gate"]["release_ready"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
