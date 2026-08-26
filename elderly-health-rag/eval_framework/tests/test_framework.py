from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from agreement import cohens_kappa, krippendorff_alpha_nominal
from evaluator import evaluate_group, legacy_golden_adapter, relation_path_correct


class FrameworkTests(unittest.TestCase):
    def test_relation_requires_complete_acceptable_path(self):
        gold = [{"path_id": "p", "edges": [
            {"source": "a", "relation": "r1", "target": "b"},
            {"source": "b", "relation": "r2", "target": "c"}
        ]}]
        self.assertFalse(relation_path_correct([{"source": "a", "relation": "r1", "target": "b"}], gold))
        self.assertTrue(relation_path_correct([
            {"source": "a", "relation": "r1", "target": "b"},
            {"source": "b", "relation": "r2", "target": "c"}
        ], gold))

    def test_personalization_checks_change_reason_and_factor(self):
        common = {
            "dataset_split": "blind", "question": "q", "audience": "elderly",
            "relevant_evidence_ids": [], "acceptable_relations": [], "forbidden_claims": [],
            "urgency_label": "routine", "required_abstention": False,
            "annotator_ids": ["a", "b"], "adjudication_status": "adjudicated"
        }
        cases = [
            {**common, "case_id": "base", "patient_context": {}, "test_design": {"kind": "personalization", "pair_id": "p", "variant": "baseline", "trigger_factors": ["fall_history"]}},
            {**common, "case_id": "ctx", "patient_context": {"fall_history": True}, "test_design": {"kind": "personalization", "pair_id": "p", "variant": "intervention", "trigger_factors": ["fall_history"]}}
        ]
        base_record = {"case_id": "base", "dataset_split": "blind", "method_id": "m", "answer": "一般活动", "actions": ["步行"], "retrieved_evidence": [], "predicted_relations": [], "citations": [], "predicted_urgency": "routine", "abstained": False}
        ctx_record = {"case_id": "ctx", "dataset_split": "blind", "method_id": "m", "answer": "先评估跌倒风险", "actions": ["评估", "陪同活动"], "retrieved_evidence": [], "predicted_relations": [], "citations": [], "predicted_urgency": "routine", "abstained": False, "personalization": {"used_context_factors": ["fall_history"]}, "human_judgments": {"personalization_reasonable": "yes", "personalization_attributable": "yes"}}
        metrics, _ = evaluate_group(cases, [base_record, ctx_record])
        self.assertEqual(metrics["personalization_valid_rate"], 1.0)
        ctx_record["personalization"]["used_context_factors"] = ["age"]
        metrics, _ = evaluate_group(cases, [base_record, ctx_record])
        self.assertEqual(metrics["personalization_valid_rate"], 0.0)

    def test_agreement(self):
        rows = {"1": {"a": "yes", "b": "yes"}, "2": {"a": "no", "b": "no"}}
        kappa, count = cohens_kappa(rows)
        alpha, _ = krippendorff_alpha_nominal(rows)
        self.assertEqual(count, 2)
        self.assertEqual(kappa, 1.0)
        self.assertEqual(alpha, 1.0)

    def test_legacy_adapter_does_not_claim_external(self):
        root = HERE.parent.parent
        cases = legacy_golden_adapter(root / "eval" / "golden_questions.json", root / "output" / "chunks.json")
        self.assertTrue(cases)
        self.assertTrue(all(case["dataset_split"] == "regression_internal" for case in cases))
        self.assertTrue(all(case["provenance"]["validation_role"] == "regression_only" for case in cases))


if __name__ == "__main__":
    unittest.main()
