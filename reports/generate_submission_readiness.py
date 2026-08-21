"""Create a reproducible pre-submission readiness checklist."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "reports" / "submission-readiness-check-20260821.md"


def exists(rel: str) -> bool:
    return (ROOT / rel).exists()


def main() -> None:
    checks: list[tuple[str, bool, str]] = []
    required = [
        ("最终交付说明", "FINAL_DELIVERY.md"),
        ("国家奖 PPT", "deliverables/national_award/elderly_health_national_award.pptx"),
        ("项目总结书 PDF", "deliverables/national_award/latex/project_summary.pdf"),
        ("项目总结书 LaTeX 源码", "deliverables/national_award/latex/project_summary.tex"),
        ("GraphRAG 任务矩阵", "reports/national-award-task-matrix-20260821.md"),
        ("风险模型审计", "reports/national-award-risk-evaluation-20260821.md"),
        ("风险模型波次时间审计", "reports/national-award-risk-temporal-evaluation-20260821.md"),
        ("风险模型参与者独立敏感性分析", "reports/national-award-risk-temporal-disjoint-evaluation-20260821.md"),
        ("Curve V2 本地评测", "reports/curve-model-evaluation-2026-08-20.md"),
        ("Curve 时间验证干跑", "reports/curve-temporal-validation-20260821.md"),
        ("Curve 外部采集包", "reports/curve-external-data-collection-kit-20260821.md"),
        ("Curve 外部数据模板", "ml/curve/external_dataset_template.csv"),
        ("Curve 外部数据校验脚本", "ml/curve/validate_external_dataset.py"),
        ("人因评价采集包", "reports/human-evaluation-data-collection-kit-20260821.md"),
        ("人因评价数据模板", "reports/human-evaluation-data-template.csv"),
        ("人因评价分析脚本", "reports/analyze_human_evaluation.py"),
        ("人因评价合成流程夹具", "reports/human-evaluation-synthetic-pipeline-20260821.md"),
        ("人因评价知情同意模板", "reports/human-evaluation-consent-template.md"),
        ("GraphRAG 来源完整性审计", "reports/source-integrity-audit-20260821.md"),
        ("人因评价协议", "reports/human-evaluation-protocol-20260821.md"),
        ("人因评价干跑", "reports/human-evaluation-dry-run-20260821.md"),
        ("医生审核包", "reports/clinician-review-packet-20260821.md"),
        ("医生审核结构化表", "reports/clinician-review-submission-guide-20260821.md"),
        ("医生审核导入保护脚本", "elderly-health-rag/apply_clinician_reviews.py"),
        ("数据卡", "deliverables/national_award/data_card.md"),
        ("模型卡", "deliverables/national_award/model_card.md"),
        ("提交物哈希清单", "reports/submission-artifact-manifest-20260821.json"),
        ("风险校准图", "ml/reports/national-award-risk-figures/calibration-curves.svg"),
        ("风险决策曲线图", "ml/reports/national-award-risk-figures/decision-curves.svg"),
        ("GraphRAG 内部改写留出评测", "reports/graphrag-internal-holdout-20260821.md"),
        ("DeepSeek 运行链路审计", "reports/deepseek-runtime-audit-20260821.md"),
    ]
    for label, rel in required:
        checks.append((label, exists(rel), rel))

    manifest_path = ROOT / "elderly-health-rag" / "output" / "relation_review_manifest.json"
    if manifest_path.exists():
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        statuses = payload.get("statuses", {})
        checks.append(("GraphRAG 关系审核状态未伪造批准", statuses.get("approved", 0) == 0,
                       f"pending={statuses.get('pending_medical_review', '?')}, approved={statuses.get('approved', '?')}"))
    else:
        checks.append(("GraphRAG 关系审核状态未伪造批准", False, "manifest missing"))

    risk_path = ROOT / "ml" / "reports" / "national-award-risk-evaluation-20260821.json"
    if risk_path.exists():
        risk = json.loads(risk_path.read_text(encoding="utf-8"))
        temporal = risk.get("temporal_external_validation", {})
        checks.append(("风险模型明确记录时间验证边界", temporal.get("status") == "unavailable",
                       temporal.get("reason", "")))
    else:
        checks.append(("风险模型明确记录时间验证边界", False, "risk json missing"))

    curve_path = ROOT / "ml" / "reports" / "curve-temporal-validation-20260821.json"
    if curve_path.exists():
        curve = json.loads(curve_path.read_text(encoding="utf-8"))
        evaluation = curve.get("evaluation", {})
        checks.append(("Curve 时间验证标记为合成干跑", curve.get("data_class") == "test_synthetic_dry_run",
                       f"forecasted={evaluation.get('forecasted_windows')}, refused={evaluation.get('refused_windows')}"))
    else:
        checks.append(("Curve 时间验证标记为合成干跑", False, "curve json missing"))

    human_path = ROOT / "reports" / "human-evaluation-dry-run-20260821.md"
    human_text = human_path.read_text(encoding="utf-8") if human_path.exists() else ""
    checks.append(("人因评价未把合成样本写成真实样本", "真实老人受试者 | 0" in human_text and "真实医生/健康管理人员 | 0" in human_text,
                   "真实样本仍待招募"))

    bundle_path = ROOT / "reports" / "submission-artifact-manifest-20260821.json"
    if bundle_path.exists():
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        checks.append(("提交物哈希清单无缺失", not bundle.get("missing"),
                       f"artifacts={len(bundle.get('artifacts', []))}, missing={len(bundle.get('missing', []))}"))
    else:
        checks.append(("提交物哈希清单无缺失", False, "manifest missing"))

    passed = sum(ok for _, ok, _ in checks)
    lines = [
        "# 提交前自检清单（2026-08-21）",
        "",
        f"生成日期：`{date.today().isoformat()}`",
        f"通过：**{passed}/{len(checks)}**",
        "",
        "> 这份清单只检查材料、代码和边界声明是否齐全，不替代医生审核、真实用户研究或外部时间验证。",
        "",
        "| 检查项 | 状态 | 证据/说明 |",
        "|---|---|---|",
    ]
    for label, ok, detail in checks:
        lines.append(f"| {label} | {'通过' if ok else '待处理'} | `{detail}` |")
    lines += [
        "",
        "## 提交前仍需人工完成",
        "",
        "1. 邀请 3–5 名医生或健康管理人员，完成 `clinician-review-packet-20260821.md` 的逐条审核和签名。",
        "2. 招募 15–30 名老人完成知情同意和人因评价，替换合成干跑结果。",
        "3. 获取带个体日期的外部纵向数据，完成 Curve V2 60–90 天外部验证。",
        "4. 风险模型补充时间切分或独立外部队列后，再更新模型卡和答辩数字。",
    ]
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"output": str(REPORT), "passed": passed, "total": len(checks)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
