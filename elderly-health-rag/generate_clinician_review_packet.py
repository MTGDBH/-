#!/usr/bin/env python3
"""Generate a 90-row clinician review packet without filling reviewer decisions."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "output"
DATA_GAP = "[MISSING_SOURCE_METADATA: must be completed from the primary source before approval]"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=OUTPUT / "relation_review_manifest.json")
    parser.add_argument("--relationships", type=Path, default=OUTPUT / "relationships.json")
    parser.add_argument("--chunks", type=Path, default=OUTPUT / "chunks.json")
    parser.add_argument("--source-manifest", type=Path, default=OUTPUT / "source_manifest.json")
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    relationships = json.loads(args.relationships.read_text(encoding="utf-8"))
    chunks = {row["id"]: row for row in json.loads(args.chunks.read_text(encoding="utf-8"))}
    sources = json.loads(args.source_manifest.read_text(encoding="utf-8")).get("sources", [])
    source_by_key = {}
    for source in sources:
        for key in (source.get("file"), source.get("source_id"), f"registry:{source.get('source_id')}"):
            if key:
                source_by_key[str(key)] = source
    rows = []
    for review in manifest.get("relations", []):
        index = int(review["relation_index"])
        relation = relationships[index]
        chunk = chunks.get(relation.get("chunk_id"), {})
        source = source_by_key.get(str(chunk.get("source")), {})
        opinion = review.get("ai_review_opinion") or {}
        rows.append({
            "relation_index": index, "source": review.get("source"), "type": review.get("type"), "target": review.get("target"),
            "relation_direction": f"{review.get('source')} -> {review.get('target')}",
            "causal_wording": relation.get("causal_status") or "unspecified_requires_review",
            "strength": review.get("strength"), "evidence": review.get("evidence"), "evidence_level": review.get("evidence_level"),
            "source_excerpt": chunk.get("text") or DATA_GAP,
            "source_url": relation.get("source_url") or chunk.get("source_url") or source.get("source_url") or DATA_GAP,
            "source_version": chunk.get("source_version") or source.get("version") or DATA_GAP,
            "publication_date": str(chunk.get("publication_year") or source.get("publication_year") or DATA_GAP),
            "publication_date_precision": "year" if chunk.get("publication_year") or source.get("publication_year") else "unknown",
            "applicable_population": relation.get("population") or source.get("population") or DATA_GAP,
            "limitations": source.get("limitations") or "",
            "proposed_allowed_expression": opinion.get("allowed_expression") or "使用相关/可能/需结合复测与医生评估等非确定性表述。",
            "proposed_forbidden_expression": opinion.get("forbidden_expression") or "不得声称确诊、必然因果、具体用药剂量或保证疗效。",
            "wording_status": "draft_not_clinician_approved",
            "decision": "", "revision_text": "", "reviewer_id": "", "reviewer_role": "", "reviewed_at": "", "review_version": "", "rationale": "",
        })
    if len(rows) != 90:
        raise SystemExit(f"expected 90 high-risk relations, found {len(rows)}")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.output_dir / "high_risk_relation_review.json"
    csv_path = args.output_dir / "high_risk_relation_review.csv"
    json_path.write_text(json.dumps({"schema_version": "clinician-relation-review-package.v1", "status": "pending_medical_review", "reviewed_relations": 0, "approved": 0, "policy": "Draft wording is not clinician approval. Reviewer identity fields and decisions are intentionally blank.", "relations": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader(); writer.writerows(rows)
    guide = ["# 高风险关系医生审核包", "", f"待审核关系：{len(rows)}；已审核：0；approved：0。", "", "> 本包由现有证据和 pending 清单机械生成。建议表述不是医生意见，不能自动转为 approved。", "", "审核人逐条核对原文、URL、版本、发布日期/年份、适用人群、关系方向和因果口径后，填写 `decision=approve|reject|revise`。决定不为空时必须填写匿名 `reviewer_id`、`reviewer_role`、ISO-8601 `reviewed_at`、`review_version` 和 `rationale`；`revise` 还必须填写 `revision_text`。", "", "不得填写虚假姓名、机构、签字或日期。身份映射保存在受控系统，不进入公开仓库。"]
    (args.output_dir / "README.md").write_text("\n".join(guide) + "\n", encoding="utf-8")
    print(json.dumps({"relations": len(rows), "approved": 0, "csv": str(csv_path), "json": str(json_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
