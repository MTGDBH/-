# -*- coding: utf-8 -*-
"""Audit source provenance and evidence-layer coverage for GraphRAG."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "output" / "source_manifest.json"
OUT_JSON = ROOT.parent / "reports" / "source-integrity-audit-20260821.json"
OUT_MD = ROOT.parent / "reports" / "source-integrity-audit-20260821.md"
CORE = ["hypertension", "diabetes", "heart_disease", "stroke", "chronic_kidney_disease", "frailty"]


def disease_key(source: dict) -> str:
    sid = str(source.get("source_id", "")).lower()
    text = f"{sid} {source.get('file', '')}"
    if "hypertension" in text or "sprint" in text or "高血压" in text: return "hypertension"
    if "diabetes" in text or "dpp" in text or "糖尿病" in text: return "diabetes"
    if "stroke" in text or "卒中" in text: return "stroke"
    if "kidney" in text or "ckd" in text or "kdigo" in text or "肾" in text: return "chronic_kidney_disease"
    if "frailty" in text or "衰弱" in text: return "frailty"
    if "cvd" in text or "cardiovascular" in text or "心血管" in text: return "heart_disease"
    return "unknown"


def main() -> None:
    payload = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sources = payload.get("sources", [])
    by_disease = defaultdict(list)
    incomplete = []
    for source in sources:
        disease = disease_key(source)
        by_disease[disease].append(source)
        required = ["source_id", "source_url", "publisher", "publication_year", "document_type", "evidence_level", "population", "limitations", "version", "retrieved_at"]
        missing = [key for key in required if source.get(key) in (None, "")]
        if missing:
            incomplete.append({"source_id": source.get("source_id"), "missing": missing})
    coverage = {}
    for disease in CORE:
        rows = by_disease.get(disease, [])
        levels = {str(r.get("evidence_level")) for r in rows}
        coverage[disease] = {
            "sources": len(rows),
            "authoritative_guidance": "authoritative_guidance" in levels or "professional_guideline" in levels or "clinical_standard" in levels,
            "systematic_review": "systematic_review" in levels,
            "randomized_trial": "randomized_trial" in levels,
            "levels": sorted(levels),
        }
    legacy = [s for s in sources if str(s.get("document_type", "")).startswith("legacy") or "复核前仅用于演示" in str(s.get("review_status", "")) or "需专业人员复核" in str(s.get("review_status", "")) or "演示条目" in str(s.get("review_status", ""))]
    result = {
        "schema_version": "source-integrity-audit.v1",
        "run_id": "source-integrity-audit-20260821",
        "generated_at": str(date.today()),
        "index_version": payload.get("index_version"),
        "source_count": len(sources),
        "core_disease_coverage": coverage,
        "incomplete_metadata": incomplete,
        "legacy_pending_sources": [{"source_id": s.get("source_id"), "file": s.get("file"), "review_status": s.get("review_status"), "source_url": s.get("source_url")} for s in legacy],
        "pass": not incomplete and all(all(coverage[d][key] for key in ("authoritative_guidance", "systematic_review", "randomized_trial")) for d in CORE),
        "limitations": ["来源元数据完整不等于医学审核完成", "URL 可访问性需在有网络环境下另行检查", "legacy pending 来源不得作为已审核医学知识宣传"],
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# GraphRAG 来源完整性与证据层审计（2026-08-21）",
        "",
        f"来源总数：**{result['source_count']}**；索引版本：`{result['index_version']}`；审计通过：**{result['pass']}**。",
        "",
        "| 核心疾病 | 来源数 | 指南/标准 | 系统综述 | 关键研究 | 证据层 |",
        "|---|---:|---|---|---|---|",
    ]
    for disease in CORE:
        row = coverage[disease]
        lines.append(f"| {disease} | {row['sources']} | {'是' if row['authoritative_guidance'] else '否'} | {'是' if row['systematic_review'] else '否'} | {'是' if row['randomized_trial'] else '否'} | {', '.join(row['levels'])} |")
    lines += ["", f"元数据不完整来源：**{len(incomplete)}**", f"legacy/待复核来源：**{len(legacy)}**", "", "## 解释", "", "本审计证明的是来源字段和证据层结构完整；4 个 legacy 来源仍需专业人员确认或移出核心范围，不能把本报告当成医生审核证明。"]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"pass": result["pass"], "sources": len(sources), "legacy": len(legacy), "incomplete": len(incomplete)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
