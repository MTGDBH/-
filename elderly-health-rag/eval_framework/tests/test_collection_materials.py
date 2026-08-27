from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
FRAMEWORK = HERE.parent
GRAPH_ROOT = FRAMEWORK.parent
sys.path.insert(0, str(FRAMEWORK))

from evaluator import legacy_golden_adapter


def test_regression_count_and_protected_splits_remain_honest():
    cases = legacy_golden_adapter(GRAPH_ROOT / "eval" / "golden_questions.json", GRAPH_ROOT / "output" / "chunks.json")
    assert len(cases) == 61
    assert json.loads((FRAMEWORK / "cases" / "blind.json").read_text(encoding="utf-8")) == []
    assert json.loads((FRAMEWORK / "cases" / "external.json").read_text(encoding="utf-8")) == []


def test_collection_templates_are_blank():
    templates = FRAMEWORK / "templates"
    assert json.loads((templates / "blind_cases.template.json").read_text(encoding="utf-8")) == []
    assert json.loads((templates / "external_clinician_cases.template.json").read_text(encoding="utf-8")) == []
    for name in ("blind_question_intake.csv", "external_clinician_question_intake.csv", "case_annotation.csv", "case_adjudication.csv"):
        with (templates / name).open(encoding="utf-8-sig", newline="") as handle:
            assert list(csv.DictReader(handle)) == []


def test_clinician_packet_has_no_fake_review():
    packet = json.loads((FRAMEWORK / "review_packets" / "clinician_review_v1" / "high_risk_relation_review.json").read_text(encoding="utf-8"))
    assert packet["status"] == "pending_medical_review"
    assert packet["approved"] == 0 and packet["reviewed_relations"] == 0
    assert len(packet["relations"]) == 90
    for row in packet["relations"]:
        assert row["decision"] == ""
        assert row["reviewer_id"] == "" and row["reviewer_role"] == ""
        assert row["reviewed_at"] == "" and row["review_version"] == ""
        assert row["source_excerpt"] and row["source_url"] and row["source_version"]
        assert row["wording_status"] == "draft_not_clinician_approved"
