"""Post-training acceptance checks for the committed CHARLS evaluation report."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REPORT_PATH = ROOT / "ml" / "reports" / "charls-multitarget-evaluation.json"

NUMERIC_TARGETS = {"systo", "diasto", "hr", "weight", "waist", "grip"}
RISK_TARGETS = {"glucose", "hba1c", "cholesterol", "uricacid", "creatinine"}
SUBGROUPS = {"age", "gender", "missingness", "disease_status", "device"}


def main() -> None:
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))

    split = report["split"]
    assert split["method"] == "participant_disjoint_70_15_15_plus_geographic_holdout"
    assert split["participant_overlap"] == 0
    assert min(split[f"{name}_participants"] for name in ("train", "validation", "test", "external")) > 0

    assert set(report["numeric_targets"]) == NUMERIC_TARGETS
    for target, result in report["numeric_targets"].items():
        assert {"last_value", "linear", "boosting"} <= set(result["validation_candidates"])
        assert result["selected_model"] in result["validation_candidates"]
        assert {
            "mae",
            "rmse",
            "mase",
            "refusal_rate",
            "interval_coverage",
            "interval_width",
        } <= set(result["test"])
        assert SUBGROUPS <= set(result["test"]["subgroups"])
        assert result["external"]["n"] > 0

    assert set(report["lab_risks"]) == RISK_TARGETS
    for target, tiers in report["lab_risks"].items():
        assert set(tiers) == {"noninvasive", "micro_anchor"}
        for tier, result in tiers.items():
            assert {"prevalence", "logistic", "boosting"} <= set(result["validation_candidates"])
            assert result["selected_model"] in result["validation_candidates"]
            assert {
                "auroc",
                "pr_auc",
                "sensitivity",
                "specificity",
                "brier",
                "calibration",
                "refusal_rate",
            } <= set(result["test"])
            assert SUBGROUPS <= set(result["test"]["subgroups"])
            assert result["external"]["n"] > 0

    bp = report["blood_pressure_joint_constraint"]
    assert bp["minimum_pulse_pressure"] > 0
    assert bp["violations_after"] == 0
    print("CHARLS report acceptance: PASS")


if __name__ == "__main__":
    main()
