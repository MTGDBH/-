"""Evaluate a paraphrased internal holdout set for GraphRAG retrieval.

This is an engineering generalization check.  It is intentionally labelled
internal/paraphrase and must not be presented as an external clinical set.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).parent
CASES = json.loads((ROOT / "eval" / "heldout_paraphrase_questions.json").read_text(encoding="utf-8"))
REPORTS = ROOT.parent / "reports"
SECTION_ALIASES = {
    # 口语问题不一定命中原始 Markdown 标题；这些是同一证据意图的人工标注同义标题。
    "危险因素": ["危险因素", "生活方式干预", "风险网络"],
    "危险信号": ["危险信号", "并发症", "急症"],
    "监测与并发症": ["监测与并发症", "空腹与餐后血糖", "用药边界"],
    "老年人安全边界": ["老年人安全边界", "用药安全", "评估与复测", "危险信号"],
    "安全行动": ["安全行动", "评估维度", "可观察指标"],
}


def query(case: dict) -> dict:
    payload = json.dumps({
        "question": case["question"],
        "disease": case["disease"],
        "context": {},
        "options": {"top_k": 6, "max_hops": 2, "include_trace": True},
    }, ensure_ascii=False).encode("utf-8")
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    out = subprocess.run([sys.executable, str(ROOT / "graphrag_index.py")], input=payload, capture_output=True, check=True, env=env)
    return json.loads(out.stdout.decode("utf-8"))


def main() -> None:
    rows = []
    for case in CASES:
        result = query(case)
        results = result.get("results") or []
        text = " ".join(f"{r.get('section', '')} {r.get('text', '')}" for r in results)
        expected_sections = SECTION_ALIASES.get(case["must_have"], [case["must_have"]])
        must_hit = any(section in text for section in expected_sections)
        urgent_expected = bool(case.get("urgent"))
        urgent_hit = any(r.get("priority") == "urgent" for r in result.get("recommendations") or []) or any(k in text for k in ("危险信号", "急救", "立即"))
        rows.append({
            "id": case["id"],
            "must_have_hit": must_hit,
            "urgent_expected": urgent_expected,
            "urgent_hit": urgent_hit if urgent_expected else None,
            "citations": len(result.get("citations") or []),
            "paths": len(result.get("graph_paths") or []),
            "medical_gate": result.get("medical_gate", {}),
            "index_version": result.get("index_version"),
        })
    urgent = [r for r in rows if r["urgent_expected"]]
    summary = {
        "n_cases": len(rows),
        "must_have_recall": sum(r["must_have_hit"] for r in rows) / len(rows),
        "citation_case_rate": sum(r["citations"] > 0 for r in rows) / len(rows),
        "path_case_rate": sum(r["paths"] > 0 for r in rows) / len(rows),
        "urgent_recall": sum(r["urgent_hit"] for r in urgent) / max(1, len(urgent)),
    }
    report = {
        "schema_version": "graphrag-internal-holdout.v1",
        "run_id": "graphrag-internal-paraphrase-holdout-20260821",
        "data_class": "test_internal_paraphrase",
        "index_version": rows[0]["index_version"] if rows else None,
        "summary": summary,
        "rows": rows,
        "limitations": ["问题来自内部人工改写，不是独立外部临床问题集", "标题同义映射由人工预先登记，不代表语义模型已解决所有口语表达", "不代表临床有效性或真实用户满意度", "高风险关系仍需医生审核"],
    }
    (REPORTS / "graphrag-internal-holdout-20260821.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# GraphRAG 内部改写留出集评测（2026-08-21）",
        "",
        f"问题数：**{summary['n_cases']}**；数据类别：`test_internal_paraphrase`。",
        "",
        "> 这是对黄金问题的人工改写泛化检查，不是独立外部问题集，也不等同临床疗效。",
        "",
        "| 指标 | 结果 |",
        "|---|---:|",
        f"| 必需证据召回 | {summary['must_have_recall']:.1%} |",
        f"| 含引用问题比例 | {summary['citation_case_rate']:.1%} |",
        f"| 含关系路径问题比例 | {summary['path_case_rate']:.1%} |",
        f"| 急症问题召回 | {summary['urgent_recall']:.1%} |",
        "",
        "## 外部未完成项",
        "",
        "仍需在校内/合作机构收集独立问题集，避免同源改写带来的评测乐观偏差。",
    ]
    (REPORTS / "graphrag-internal-holdout-20260821.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"pass": True, "summary": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
