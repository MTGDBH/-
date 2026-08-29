# -*- coding: utf-8 -*-
"""One-command validation and anonymous aggregation for real-world evaluation.

No participant/reviewer identifiers are copied to outputs. Empty inputs remain
pending, and exploratory samples never become clinical-effectiveness claims.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean, median


ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"
CURVE = ROOT / "ml" / "curve"
RAG_PACKET = ROOT / "elderly-health-rag" / "eval_framework" / "review_packets" / "clinician_review_v1" / "high_risk_relation_review.csv"
sys.path.insert(0, str(REPORTS))
sys.path.insert(0, str(CURVE))
from analyze_human_evaluation import analyze as analyze_human  # noqa: E402
from validate_external_dataset import validate as validate_external_measurements  # noqa: E402

DIRECT_IDENTIFIERS = {"name", "full_name", "doctor_name", "physician_name", "id_card", "idcard", "phone", "address", "institution", "institution_name"}
CLINICIAN_REQUIRED = {
    "relation_index", "reviewer_id", "reviewer_role", "consent_confirmed", "independent_review",
    "evidence_consistency", "safety", "explainability", "applicability", "inappropriate_certainty",
    "decision", "rationale", "adjudication_required", "reviewed_at", "protocol_version",
}
WINDOW_REQUIRED = {
    "participant_id", "site_id", "split", "metric", "measurement_condition", "horizon_days",
    "history_start", "history_end", "origin_time", "target_time", "status", "actual", "predicted",
    "lower", "upper", "refusal_reason",
}


def text(row, key):
    return str(row.get(key, "") or "").strip()


def number(row, key):
    try:
        value = float(text(row, key))
        return value if math.isfinite(value) else None
    except ValueError:
        return None


def parse_time(value):
    raw = str(value or "").strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timezone is required")
    return parsed


def read_csv(path: Path, required: set[str]):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields = set(reader.fieldnames or [])
        direct = sorted(DIRECT_IDENTIFIERS & {field.lower() for field in fields})
        missing = sorted(required - fields)
        return list(reader), direct, missing


def average(values):
    values = [float(value) for value in values if value is not None]
    return round(mean(values), 4) if values else None


def analyze_clinician(path: Path, packet: Path) -> dict:
    rows, direct, missing = read_csv(path, CLINICIAN_REQUIRED)
    if direct or missing:
        return {"status": "invalid", "errors": ([f"direct identifier columns forbidden: {direct}"] if direct else []) + ([f"missing columns: {missing}"] if missing else [])}
    if not rows:
        return {"status": "pending", "reviewers": 0, "relations": 0, "ratings": 0, "errors": [], "warnings": ["empty clinician panel template; no real clinician review"]}
    packet_rows, _, _ = read_csv(packet, {"relation_index"})
    valid_relations = {text(row, "relation_index") for row in packet_rows}
    errors, warnings, seen = [], [], set()
    by_relation, reviewers = defaultdict(list), set()
    for line_no, row in enumerate(rows, 2):
        relation, reviewer = text(row, "relation_index"), text(row, "reviewer_id")
        if relation not in valid_relations:
            errors.append(f"line {line_no}: relation_index not in current 90-row review packet")
        if not reviewer or reviewer.upper().startswith(("SYN", "DEMO", "TEST")):
            errors.append(f"line {line_no}: reviewer_id must be a real anonymous controlled code")
        if (relation, reviewer) in seen:
            errors.append(f"line {line_no}: duplicate relation/reviewer rating")
        seen.add((relation, reviewer)); reviewers.add(reviewer); by_relation[relation].append(row)
        if text(row, "consent_confirmed") != "1" or text(row, "independent_review") != "1":
            errors.append(f"line {line_no}: consent_confirmed and independent_review must be 1")
        for field in ("evidence_consistency", "safety", "explainability", "applicability"):
            value = number(row, field)
            if value is None or value not in (1, 2, 3, 4, 5):
                errors.append(f"line {line_no}: {field} must be 1-5")
        for field in ("inappropriate_certainty", "adjudication_required"):
            if text(row, field) not in {"0", "1"}:
                errors.append(f"line {line_no}: {field} must be 0 or 1")
        if text(row, "decision") not in {"approve", "revise", "reject"} or not text(row, "rationale"):
            errors.append(f"line {line_no}: decision and rationale are required")
        try:
            parse_time(text(row, "reviewed_at"))
        except Exception as exc:
            errors.append(f"line {line_no}: reviewed_at invalid ({exc})")
    if not 3 <= len(reviewers) <= 5:
        warnings.append(f"reviewers={len(reviewers)}; minimum executable panel requires 3-5")
    if len(by_relation) < 12:
        warnings.append(f"core_relations={len(by_relation)} < minimum 12")
    under_rated = sum(len({text(row, 'reviewer_id') for row in ratings}) < 2 for ratings in by_relation.values())
    if under_rated:
        warnings.append(f"relations_with_fewer_than_2_independent_ratings={under_rated}")
    decisions = Counter(text(row, "decision") for row in rows)
    agreement_rows = []
    for ratings in by_relation.values():
        relation_decisions = [text(row, "decision") for row in ratings]
        if len(relation_decisions) >= 2:
            agreement_rows.append(max(Counter(relation_decisions).values()) / len(relation_decisions))
    eligible = not errors and not warnings and 3 <= len(reviewers) <= 5
    return {
        "status": "exploratory_complete" if eligible else ("invalid" if errors else "pending"),
        "errors": errors, "warnings": warnings, "reviewers": len(reviewers), "relations": len(by_relation), "ratings": len(rows),
        "endpoints": {
            field: average(number(row, field) for row in rows)
            for field in ("evidence_consistency", "safety", "explainability", "applicability")
        } | {
            "inappropriate_certainty_rate": average(number(row, "inappropriate_certainty") for row in rows),
            "decision_counts": dict(decisions), "mean_majority_agreement": average(agreement_rows),
            "adjudication_required": sum(text(row, "adjudication_required") == "1" for row in rows),
        },
        "claim_boundary": "专业人员探索性审核；不是机构背书、伦理批准或临床有效性证明。",
    }


def window_metrics(rows):
    attempted = len(rows)
    refused = [row for row in rows if text(row, "status") == "refused"]
    scored = [row for row in rows if text(row, "status") == "forecasted" and all(number(row, field) is not None for field in ("actual", "predicted", "lower", "upper"))]
    errors = [number(row, "predicted") - number(row, "actual") for row in scored]
    covered = [number(row, "lower") <= number(row, "actual") <= number(row, "upper") for row in scored]
    return {
        "attempts": attempted, "forecasted_scorable": len(scored), "refused": len(refused),
        "refusal_rate": round(len(refused) / attempted, 4) if attempted else None,
        "coverage": round(sum(covered) / len(covered), 4) if covered else None,
        "mae": round(mean(abs(value) for value in errors), 4) if errors else None,
        "rmse": round(math.sqrt(mean(value * value for value in errors)), 4) if errors else None,
        "bias": round(mean(errors), 4) if errors else None,
        "mean_interval_width": round(mean(number(row, "upper") - number(row, "lower") for row in scored), 4) if scored else None,
    }


def analyze_curve(measurements: Path, windows_path: Path) -> dict:
    measurement_required = {"participant_id", "site_id", "timestamp", "metric", "value", "unit", "condition", "posture", "device_id", "measurement_source", "repeat_flag", "medication_context", "missing_reason", "quality_flag", "age", "sex", "region", "baseline_conditions"}
    measurements_rows, direct, missing = read_csv(measurements, measurement_required)
    windows, window_direct, window_missing = read_csv(windows_path, WINDOW_REQUIRED)
    errors = ([f"measurement direct identifiers forbidden: {direct}"] if direct else []) + ([f"measurement missing columns: {missing}"] if missing else [])
    errors += ([f"window direct identifiers forbidden: {window_direct}"] if window_direct else []) + ([f"window missing columns: {window_missing}"] if window_missing else [])
    if not measurements_rows and not windows:
        return {"status": "pending", "participants": 0, "measurement_rows": 0, "prediction_windows": 0, "errors": errors, "warnings": ["empty Curve templates; no real longitudinal data"]}
    external_quality = validate_external_measurements(measurements)
    if external_quality.get("errors"):
        errors.append(f"external_measurement_validator_errors={len(external_quality['errors'])}")
    participants, participant_splits, participant_sites = set(), defaultdict(set), defaultdict(set)
    condition_counts, missing_counts = Counter(), Counter()
    last_time = {}
    for line_no, row in enumerate(measurements_rows, 2):
        participant = text(row, "participant_id"); participants.add(participant)
        participant_sites[participant].add(text(row, "site_id")); condition_counts[f"{text(row, 'metric')}|{text(row, 'condition')}"] += 1
        if not text(row, "value"):
            missing_counts[text(row, "missing_reason") or "unspecified"] += 1
        try:
            timestamp = parse_time(text(row, "timestamp"))
            series = (participant, text(row, "metric"), text(row, "condition"))
            if series in last_time and timestamp < last_time[series]:
                errors.append(f"measurement line {line_no}: rows are not time ordered within participant/metric/condition")
            last_time[series] = timestamp
        except Exception as exc:
            errors.append(f"measurement line {line_no}: invalid timestamp ({exc})")
    site_isolation_violations = sum(len(sites) != 1 for sites in participant_sites.values())
    if site_isolation_violations:
        errors.append(f"participant_site_isolation_violations={site_isolation_violations}")
    refusal_reasons = Counter()
    for line_no, row in enumerate(windows, 2):
        participant = text(row, "participant_id"); participants.add(participant); participant_splits[participant].add(text(row, "split"))
        try:
            history_start, history_end = parse_time(text(row, "history_start")), parse_time(text(row, "history_end"))
            origin, target = parse_time(text(row, "origin_time")), parse_time(text(row, "target_time"))
            if not history_start <= history_end <= origin < target:
                errors.append(f"window line {line_no}: strict temporal order history_start<=history_end<=origin<target violated")
        except Exception as exc:
            errors.append(f"window line {line_no}: invalid temporal fields ({exc})")
        status = text(row, "status")
        if status not in {"forecasted", "refused", "forecasted_unscorable"}:
            errors.append(f"window line {line_no}: invalid status")
        if status == "refused":
            refusal_reasons[text(row, "refusal_reason") or "unspecified"] += 1
            if any(text(row, field) for field in ("predicted", "lower", "upper")):
                errors.append(f"window line {line_no}: refused prediction must not contain predicted interval")
        elif status == "forecasted":
            values = [number(row, field) for field in ("actual", "predicted", "lower", "upper")]
            if any(value is None for value in values) or not values[2] <= values[1] <= values[3]:
                errors.append(f"window line {line_no}: forecasted row requires actual and lower<=predicted<=upper")
    split_isolation_violations = sum(len(splits) != 1 for splits in participant_splits.values())
    if split_isolation_violations:
        errors.append(f"participant_split_isolation_violations={split_isolation_violations}")
    grouped_participant = defaultdict(list); grouped_site = defaultdict(list); grouped_condition = defaultdict(list)
    for row in windows:
        grouped_participant[text(row, "participant_id")].append(row)
        grouped_site[text(row, "site_id")].append(row)
        grouped_condition[f"{text(row, 'metric')}|{text(row, 'measurement_condition')}"] .append(row)
    micro = window_metrics(windows)
    macro_fields = ("mae", "rmse", "coverage", "refusal_rate", "bias", "mean_interval_width")
    participant_summaries = [window_metrics(rows) for rows in grouped_participant.values()]
    site_summaries = [window_metrics(rows) for rows in grouped_site.values()]
    participant_macro = {field: average(row[field] for row in participant_summaries) for field in macro_fields}
    site_macro = {field: average(row[field] for row in site_summaries) for field in macro_fields}
    observed_measurements = sum(bool(text(row, "value")) and text(row, "quality_flag") != "missing" for row in measurements_rows)
    measurement_row_coverage = round(observed_measurements / len(measurements_rows), 4) if measurements_rows else None
    valid_days = defaultdict(set)
    for row in measurements_rows:
        if text(row, "value") and text(row, "quality_flag") == "valid":
            try:
                valid_days[text(row, "participant_id")].add(parse_time(text(row, "timestamp")).date())
            except Exception:
                pass
    day_counts = sorted(len(days) for days in valid_days.values())
    warnings = []
    if len(participants) < 5:
        warnings.append(f"participants={len(participants)} < exploratory minimum 5")
    if len(participants) > 10:
        warnings.append(f"participants={len(participants)} exceeds exploratory toolkit range 5-10; use frozen formal protocol")
    eligible = not errors and 5 <= len(participants) <= 10 and bool(windows)
    return {
        "status": "exploratory_complete" if eligible else ("invalid" if errors else "pending"),
        "errors": errors, "warnings": warnings, "participants": len(participants), "measurement_rows": len(measurements_rows), "prediction_windows": len(windows),
        "participant_overlap_across_splits": split_isolation_violations,
        "temporal_rule": "history_start <= history_end <= origin_time < target_time",
        "micro": micro, "participant_macro": participant_macro, "site_macro": site_macro,
        "measurement_row_coverage": measurement_row_coverage,
        "valid_days_per_participant": {"minimum": min(day_counts) if day_counts else None, "median": median(day_counts) if day_counts else None, "maximum": max(day_counts) if day_counts else None},
        "by_measurement_condition": {key: window_metrics(value) for key, value in sorted(grouped_condition.items())},
        "measurement_condition_distribution": dict(condition_counts), "missing_reason_distribution": dict(missing_counts),
        "refusal_reason_distribution": dict(refusal_reasons),
        "external_measurement_quality": {
            "valid": external_quality.get("valid"), "error_count": len(external_quality.get("errors", [])),
            "warning_count": len(external_quality.get("warnings", [])), "participants": external_quality.get("participants"),
            "sites": external_quality.get("sites"), "span_days": external_quality.get("span_days"),
            "missingness": external_quality.get("missingness"), "quality_flag_distribution": external_quality.get("quality_flag_distribution"),
            "readiness": external_quality.get("readiness"),
        },
        "claim_boundary": "5-10 人探索性纵向可行性评价；不得解释为外部验证、临床有效性或因果疗效。",
    }


def render_markdown(report: dict) -> str:
    human, clinician, curve = (report[key] for key in ("older_adult_usability", "clinician_review", "curve_longitudinal"))
    return "\n".join([
        "# 真实评价匿名统计状态报告", "", f"总状态：`{report['status']}`", "",
        "> 本报告不含姓名、机构、签字或参与者级记录。pending 表示尚无足够真实数据，不是阴性结果。", "",
        "| 模块 | 状态 | 匿名样本/记录 |", "|---|---|---|",
        f"| 老人适老化任务 | {human['status']} | {human.get('older_adult_participants', 0)} 人 / {human.get('n_rows', 0)} 行 |",
        f"| 医生核心关系审核 | {clinician['status']} | {clinician.get('reviewers', 0)} 人 / {clinician.get('relations', 0)} 关系 / {clinician.get('ratings', 0)} 评分 |",
        f"| Curve 探索性纵向 | {curve['status']} | {curve.get('participants', 0)} 人 / {curve.get('measurement_rows', 0)} 测量 / {curve.get('prediction_windows', 0)} 窗口 |", "",
        "## 解释边界", "", "- N-of-1 与 5–10 人纵向阶段仅为探索性，不直接支持因果疗效。",
        "- 任何 invalid/pending 模块不得在申报书中填写完成率、性能提升或医生认可率。",
        "- 医生编号和参与者编号的身份映射留在线下受控位置，不进入统计报告。", "",
    ])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--human", type=Path, default=REPORTS / "human-evaluation-data-template.csv")
    parser.add_argument("--clinician", type=Path, default=REPORTS / "clinician-panel-ratings-template.csv")
    parser.add_argument("--clinician-packet", type=Path, default=RAG_PACKET)
    parser.add_argument("--curve-measurements", type=Path, default=CURVE / "external_dataset_template.csv")
    parser.add_argument("--curve-windows", type=Path, default=CURVE / "exploratory_prediction_windows_template.csv")
    parser.add_argument("--out-json", type=Path, default=REPORTS / "real-world-evaluation-status.json")
    parser.add_argument("--out-md", type=Path, default=REPORTS / "real-world-evaluation-status.md")
    args = parser.parse_args()
    report = {
        "schema_version": "real-world-evaluation-toolkit.v1", "generated_at": datetime.now().astimezone().isoformat(),
        "older_adult_usability": analyze_human(args.human),
        "clinician_review": analyze_clinician(args.clinician, args.clinician_packet),
        "curve_longitudinal": analyze_curve(args.curve_measurements, args.curve_windows),
    }
    statuses = [report[key]["status"] for key in ("older_adult_usability", "clinician_review", "curve_longitudinal")]
    report["status"] = "invalid" if "invalid" in statuses else ("exploratory_complete" if all(status == "exploratory_complete" for status in statuses) else "pending")
    report["prohibited_claims"] = ["医生审核已完成（当状态非完成）", "经临床验证", "已证明疗效", "N-of-1 证明因果", "通过伦理审批（无真实批件时）"]
    args.out_json.parent.mkdir(parents=True, exist_ok=True); args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    args.out_md.write_text(render_markdown(report), encoding="utf-8")
    print(json.dumps({"status": report["status"], "json": str(args.out_json), "markdown": str(args.out_md)}, ensure_ascii=False))
    raise SystemExit(2 if report["status"] == "invalid" else 0)


if __name__ == "__main__":
    main()
