"""Freeze the checksums and provenance of the national-award submission bundle."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "submission-artifact-manifest-20260821.json"


FILES = [
    "FINAL_DELIVERY.md",
    "deliverables/national_award/project_title.md",
    "deliverables/national_award/SUBMISSION_INDEX.md",
    "deliverables/national_award/elderly_health_national_award.pptx",
    "deliverables/national_award/ppt_build/build_deck.mjs",
    "reports/create_submission_bundle.py",
    "deliverables/national_award/latex/project_summary.tex",
    "deliverables/national_award/latex/project_summary.pdf",
    "deliverables/national_award/demo_script.md",
    "deliverables/national_award/data_card.md",
    "deliverables/national_award/model_card.md",
    "reports/national-award-task-matrix-20260821.md",
    "reports/submission-readiness-check-20260821.md",
    "reports/clinician-review-packet-20260821.md",
    "reports/graphrag-method-comparison-20260821.md",
    "reports/graphrag-personalization-pairs-20260821.md",
    "reports/graphrag-internal-holdout-20260821.md",
    "reports/curve-model-evaluation-2026-08-20.md",
    "reports/curve-temporal-validation-20260821.md",
    "reports/national-award-risk-evaluation-20260821.md",
    "reports/human-evaluation-protocol-20260821.md",
    "reports/human-evaluation-dry-run-20260821.md",
    "reports/deepseek-runtime-audit-20260821.md",
    "reports/final_submission_audit.py",
    "reports/final-submission-audit-20260821.json",
    "reports/final-submission-audit-20260821.md",
    "reports/external-gate-execution-checklist-20260821.md",
    "reports/regression-suite-summary-20260821.md",
    "reports/regression-suite-summary-20260821.json",
    "elderly-health-rag/eval/heldout_paraphrase_questions.json",
    "elderly-health-rag/evaluate_holdout_questions.py",
    "elderly-health-rag/audit_source_integrity.py",
    "elderly-health-rag/test_source_gate.py",
    "elderly-health-rag/generate_clinician_review_template.py",
    "elderly-health-rag/validate_clinician_reviews.py",
    "elderly-health-rag/apply_clinician_reviews.py",
    "elderly-health-rag/README.md",
    "elderly-health-rag/output/source_manifest.json",
    "elderly-health-rag/output/relationships.json",
    "elderly-health-rag/output/entities.json",
    "elderly-health-rag/output/relation_review_manifest.json",
    "elderly-health-rag/output/medical_pre_review.json",
    "elderly-health-rag/output/evidence_conflicts.json",
    "reports/source-integrity-audit-20260821.md",
    "reports/clinician-review-template.csv",
    "reports/clinician-review-validation.json",
    "reports/clinician-review-submission-guide-20260821.md",
    "reports/clinician-review-report-20260821.md",
    "reports/clinician-review-report-20260821.json",
    "reports/graphrag-source-gate-regression-20260821.json",
    "ml/curve/temporal_validation.py",
    "ml/curve/external_dataset_schema.json",
    "ml/curve/external_dataset_template.csv",
    "ml/curve/validate_external_dataset.py",
    "ml/curve/test_validate_external_dataset.py",
    "ml/disease_risk/plot_national_award_evaluation.py",
    "ml/disease_risk/evaluate_temporal_charls.py",
    "ml/reports/national-award-risk-temporal-evaluation-20260821.json",
    "reports/national-award-risk-temporal-evaluation-20260821.md",
    "ml/reports/national-award-risk-temporal-disjoint-evaluation-20260821.json",
    "reports/national-award-risk-temporal-disjoint-evaluation-20260821.md",
    "reports/curve-external-data-collection-kit-20260821.md",
    "reports/human-evaluation-data-template.csv",
    "reports/analyze_human_evaluation.py",
    "reports/test_human_evaluation_analyzer.py",
    "reports/human-evaluation-data-collection-kit-20260821.md",
    "reports/human-evaluation-consent-template.md",
    "reports/create_human_evaluation_synthetic_fixture.py",
    "reports/human-evaluation-synthetic-fixture.csv",
    "reports/human-evaluation-synthetic-pipeline-20260821.json",
    "reports/human-evaluation-synthetic-pipeline-20260821.md",
    "ml/risk_data_manifest.json",
    "ml/reports/curve-v2-regression-20260821.json",
    "ml/reports/curve-temporal-validation-20260821.json",
    "ml/reports/national-award-risk-evaluation-20260821.json",
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def git_revision() -> str | None:
    try:
        return subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        return None


def main() -> None:
    artifacts = []
    missing = []
    for rel in FILES:
        path = ROOT / rel
        if not path.exists():
            missing.append(rel)
            continue
        artifacts.append({"path": rel, "bytes": path.stat().st_size, "sha256": sha256(path)})
    payload = {
        "schema_version": "submission-artifact-manifest.v1",
        "run_id": "submission-bundle-freeze-20260821",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_revision": git_revision(),
        "artifacts": artifacts,
        "missing": missing,
        "data_versions": {
            "risk": "charls_w1w2_incidence.v2",
            "graphrag": "2026-08-21.v6",
            "curve": "curve-v2-regression-20260821",
        },
        "limitations": [
            "清单冻结的是工程提交物，不是临床有效性证明",
            "医生签署、真实受试者和带日期外部纵向验证仍是线下依赖",
        ],
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUT), "artifacts": len(artifacts), "missing": missing}, ensure_ascii=False))


if __name__ == "__main__":
    main()
