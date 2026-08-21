"""Generate a clinician review packet without changing medical review statuses.

The packet is deliberately a blank review form: AI pre-review can help triage,
but it never becomes clinical approval.  A clinician must complete the decision
fields before a high-risk relationship is eligible for deterministic advice.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "output" / "relation_review_manifest.json"
PRE_REVIEW = ROOT / "output" / "medical_pre_review.json"
OUT = ROOT.parent / "reports" / "clinician-review-packet-20260821.md"


def main() -> None:
    payload = json.loads(MANIFEST.read_text(encoding="utf-8"))
    relations = payload.get("relations", [])
    pre_payload = json.loads(PRE_REVIEW.read_text(encoding="utf-8")) if PRE_REVIEW.exists() else {}
    pre_by_index = {r.get("relation_index"): r for r in pre_payload.get("relations", [])}
    pending = [r for r in relations if r.get("review_status") == "pending_medical_review"]
    pending.sort(key=lambda r: (r.get("source", ""), r.get("target", ""), r.get("relation_index", 0)))

    lines = [
        "# GraphRAG 高风险关系医学审核包（待签署）",
        "",
        f"- 索引版本：`{payload.get('index_version', 'unknown')}`",
        f"- 生成日期：`{payload.get('generated_at', 'unknown')}`",
        f"- 待审核关系数：**{len(pending)}**",
        "- 用途：供老年医学/全科/慢病管理专业人员逐条审核；本文件不会自动改变系统中的 `review_status`。",
        "",
        "> 审核规则：未完成医学审核的高风险关系不得在老人端生成确定性诊断、用药调整或急症处置建议。AI 预审结果仅用于分流，不等同于医生批准。",
        "",
        "## 审核汇总",
        "",
        "| 关系索引 | 来源节点 | 目标节点 | 关系类型 | 强度 | 证据等级 | 原始状态 | AI预审 | 医生结论 | 医生签名/日期 |",
        "|---:|---|---|---|---|---|---|---|---|---|",
    ]
    for r in pending:
        ai = pre_by_index.get(r.get("relation_index"), {}).get("ai_review_opinion", {})
        ai_status = pre_by_index.get(r.get("relation_index"), {}).get("ai_pre_review_status", "未记录")
        ai_decision = f"{ai_status}; {ai.get('decision_label', '未记录')}"
        lines.append(
            f"| {r.get('relation_index', '')} | `{r.get('source', '')}` | `{r.get('target', '')}` | `{r.get('type', '')}` | {r.get('strength', '')} | {r.get('evidence_level', '')} | `{r.get('review_status', '')}` | {ai_decision} |  |  |"
        )

    lines += ["", "## 逐条审核记录", ""]
    for i, r in enumerate(pending, 1):
        pre = pre_by_index.get(r.get("relation_index"), {})
        ai = pre.get("ai_review_opinion", {}) if isinstance(pre, dict) else {}
        lines += [
            f"### {i}. 关系 #{r.get('relation_index', '')}",
            "",
            f"- **关系**：`{r.get('source', '')}` → `{r.get('target', '')}`",
            f"- **类型/强度**：`{r.get('type', '')}` / `{r.get('strength', '')}`",
            f"- **证据**：`{r.get('evidence', '')}`",
            f"- **证据等级**：`{r.get('evidence_level', '')}`",
            f"- **原始审核状态**：`{r.get('review_status', '')}`",
            f"- **AI 预审状态**：{pre.get('ai_pre_review_status', '未记录')}",
            f"- **AI 预审意见**：{ai.get('decision_label', '未记录')}",
            f"- **AI 预审允许表达**：{ai.get('allowed_expression', '未记录')}",
            f"- **AI 预审禁止表达**：{ai.get('forbidden_expression', '未记录')}",
            "",
            "#### 医学审核（由医生填写）",
            "",
            "- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝",
            "- 适用人群/限制条件：",
            "- 可用于老人端的表达：",
            "- 必须屏蔽的表达或行动：",
            "- 是否需要复测/就医边界：",
            "- 审核人：",
            "- 执业信息/机构：",
            "- 审核日期：",
            "- 签名：",
            "",
        ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"output": str(OUT), "pending": len(pending)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
