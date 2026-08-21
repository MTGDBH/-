# -*- coding: utf-8 -*-
"""Regression checks for source-level review status handling.

The default elderly policy flags legacy pending sources without silently treating
them as approved.  A strict opt-in gate can exclude them; doctor/audit views keep
the complete graph for review.
"""
from __future__ import annotations

import json
from pathlib import Path

import graphrag_index


def query(options):
    graphrag_index._QUERY_CONTEXT = {}
    return graphrag_index.query("最近血压应该怎么复测？", "hypertension", 6, options)


def main() -> None:
    elderly = query({"audience": "elderly"})
    strict = query({"audience": "elderly", "source_gate": "exclude_legacy_pending"})
    doctor = query({"audience": "doctor"})

    assert elderly["retrieval_trace"]["source_gate"] == "flag_legacy_pending"
    assert elderly["retrieval_trace"]["source_gate_enabled"] is False
    assert elderly["retrieval_trace"]["source_flag_enabled"] is True
    assert elderly["retrieval_trace"]["flagged_legacy_pending_results"] >= 0
    assert strict["retrieval_trace"]["source_gate_enabled"] is True
    assert strict["retrieval_trace"]["excluded_legacy_pending_chunks"] >= 1
    assert all(not row.get("source_review_required") for row in strict["results"])
    assert doctor["retrieval_trace"]["source_gate_enabled"] is False
    assert doctor["retrieval_trace"]["source_flag_enabled"] is False

    payload = {
        "passed": True,
        "default_policy": "flag_legacy_pending",
        "strict_excluded_chunks": strict["retrieval_trace"]["excluded_legacy_pending_chunks"],
        "default_flagged_results": elderly["retrieval_trace"]["flagged_legacy_pending_results"],
        "doctor_complete_graph": doctor["retrieval_trace"]["blocked_edge_count"] == 0,
    }
    out = Path(__file__).resolve().parents[1] / "reports" / "graphrag-source-gate-regression-20260821.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
