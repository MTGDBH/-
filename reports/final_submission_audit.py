"""Run a conservative final audit for the national-award package.

The audit separates locally reproducible engineering evidence from external
evidence that cannot be manufactured by the software project (clinician
sign-off, real human participants, and independent longitudinal cohorts).
It intentionally reports ``ready_with_external_gates`` instead of claiming
clinical completion when those gates are still open.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_json(relative: str) -> dict:
    path = ROOT / relative
    if not path.exists():
        return {"_missing": relative}
    return json.loads(path.read_text(encoding="utf-8"))


def read_readiness() -> dict:
    path = ROOT / "reports/submission-readiness-check-20260821.md"
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    marker = "通过：**"
    if marker not in text:
        return {}
    value = text.split(marker, 1)[1].split("**", 1)[0]
    passed, total = value.split("/", 1)
    return {"passed": int(passed), "total": int(total)}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def audit() -> dict:
    readiness = read_readiness()
    manifest = read_json("reports/submission-artifact-manifest-20260821.json")
    source_gate = read_json("reports/graphrag-source-gate-regression-20260821.json")
    medical_gate = read_json("reports/medical-gate-regression-20260821.json")
    clinician = read_json("reports/clinician-review-validation.json")
    human = read_json("reports/human-evaluation-synthetic-pipeline-20260821.json")
    curve = read_json("ml/reports/curve-temporal-validation-20260821.json")
    risk = read_json("ml/reports/national-award-risk-temporal-disjoint-evaluation-20260821.json")

    missing = []
    mismatches = []
    for row in manifest.get("artifacts", []):
        path = ROOT / row["path"]
        if not path.exists():
            missing.append(row["path"])
        elif sha256(path) != row["sha256"]:
            mismatches.append(row["path"])

    bundle_path = ROOT / "deliverables/national_award/national_award_submission_bundle.zip"
    bundle_ok = False
    bundle_entries = 0
    bundle_error = None
    if bundle_path.exists():
        try:
            with zipfile.ZipFile(bundle_path) as archive:
                bundle_error = archive.testzip()
                bundle_entries = len(archive.namelist())
                bundle_ok = bundle_error is None
        except Exception as exc:  # pragma: no cover - defensive audit path
            bundle_error = str(exc)

    deliverables = {
        rel: (ROOT / rel).exists()
        for rel in [
            "deliverables/national_award/project_title.md",
            "deliverables/national_award/elderly_health_national_award.pptx",
            "deliverables/national_award/latex/project_summary.tex",
            "deliverables/national_award/latex/project_summary.pdf",
            "deliverables/national_award/national_award_submission_bundle.zip",
        ]
    }

    external_gates = {
        "clinician_review": {
            "status": "pending" if clinician.get("status") == "pending" else clinician.get("status"),
            "expected_relations": clinician.get("expected_relations"),
            "signed_rows": clinician.get("signed_rows"),
            "required_action": "由持证医生完成83条关系审核与签字",
        },
        "human_evaluation": {
            "status": "synthetic_fixture_only" if human.get("input", "").endswith("human-evaluation-synthetic-fixture.csv") else "review",
            "older_adult_participants": human.get("older_adult_participants", 0),
            "clinician_participants": human.get("clinician_participants", 0),
            "required_action": "招募真实15–30名老人和3–5名医生并完成伦理/知情同意流程",
        },
        "curve_external_validation": {
            "status": "synthetic_dry_run_only" if curve.get("data_class") == "test_synthetic_dry_run" else "review",
            "data_class": curve.get("data_class"),
            "required_action": "采集至少60–90天真实纵向数据，并按老人隔离完成外部验证",
        },
        "risk_external_validation": {
            "status": "temporal_cohort_sensitivity_only" if risk.get("limitations") else "review",
            "required_action": "补充独立地区/日期外部队列并重新校准概率",
        },
    }

    local_checks = {
        "readiness_36_of_36": readiness.get("passed") == readiness.get("total") == 36,
        "artifact_manifest_complete": bool(manifest.get("artifacts")) and not manifest.get("missing"),
        "artifact_hashes_match": not missing and not mismatches,
        "graphrag_source_gate": source_gate.get("passed") is True,
        "medical_gate": medical_gate.get("passed") is True,
        "bundle_integrity": bundle_ok,
        "deliverables_present": all(deliverables.values()),
    }

    return {
        "schema_version": "final-submission-audit.v1",
        "run_id": "final-submission-audit-20260821",
        # Keep the report deterministic so its SHA256 can itself be frozen in
        # the submission manifest without a timestamp/hash feedback loop.
        "generated_at": "2026-08-21",
        "status": "ready_with_external_gates" if all(local_checks.values()) else "local_materials_incomplete",
        "local_checks": local_checks,
        "artifact_count": len(manifest.get("artifacts", [])),
        "hash_missing": missing,
        "hash_mismatches": mismatches,
        "bundle_entries": bundle_entries,
        "deliverables": deliverables,
        "external_gates": external_gates,
        "non_claims": [
            "合成老人/医生数据仅用于验证采集与分析流水线，不代表真实人因结果",
            "CHARLS 波次时间切分不是独立地区临床外部验证",
            "AI 预审不等于医生签字审核",
        ],
    }


def render_markdown(result: dict) -> str:
    lines = [
        "# 最终提交审计（2026-08-21）",
        "",
        f"状态：**{result['status']}**",
        "",
        "## 本地可复现检查",
        "",
        "| 检查 | 结果 |",
        "|---|---|",
    ]
    for name, passed in result["local_checks"].items():
        lines.append(f"| {name} | {'通过' if passed else '未通过'} |")
    lines += [
        "",
        f"工件数量：{result['artifact_count']}；哈希缺失：{len(result['hash_missing'])}；哈希不一致：{len(result['hash_mismatches'])}；压缩包条目：{result['bundle_entries']}",
        "",
        "## 外部证据门槛",
        "",
        "| 项目 | 当前状态 | 必须由项目组完成 |",
        "|---|---|---|",
    ]
    for name, item in result["external_gates"].items():
        lines.append(f"| {name} | {item['status']} | {item['required_action']} |")
    lines += [
        "",
        "本审计不把合成数据、AI 预审或调查波次时间切分写成临床结论。",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default=str(ROOT / "reports"))
    args = parser.parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    result = audit()
    json_path = out_dir / "final-submission-audit-20260821.json"
    md_path = out_dir / "final-submission-audit-20260821.md"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(render_markdown(result), encoding="utf-8")
    print(json.dumps({"status": result["status"], "json": str(json_path), "markdown": str(md_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
