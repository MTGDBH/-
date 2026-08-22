"""Evaluate numeric/risk prediction exports with baselines and subgroup audits."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from population.modeling import classification_metrics, numeric_metrics


def _numeric_group(group: pd.DataFrame) -> dict:
    actual = group.actual.to_numpy(dtype=float)
    predicted = group.predicted.to_numpy(dtype=float)
    accepted = group.get("accepted", pd.Series(True, index=group.index)).fillna(False).astype(bool).to_numpy()
    baseline = group.get("baseline_pred", pd.Series(np.nan, index=group.index)).to_numpy(dtype=float)
    linear = group.get("linear_pred", pd.Series(np.nan, index=group.index)).to_numpy(dtype=float)
    baseline_mask = np.isfinite(baseline)
    scale = float(np.mean(np.abs(actual[baseline_mask] - baseline[baseline_mask]))) if baseline_mask.any() else float(np.mean(np.abs(actual - np.median(actual))))
    lower = group.lower.to_numpy(dtype=float) if "lower" in group else None
    upper = group.upper.to_numpy(dtype=float) if "upper" in group else None
    model = numeric_metrics(actual, predicted, scale=max(scale, 1e-9), lower=lower, upper=upper, accepted=accepted)
    comparisons = {}
    if baseline_mask.any():
        comparisons["last_value"] = numeric_metrics(actual[baseline_mask], baseline[baseline_mask], scale=max(scale, 1e-9))
    linear_mask = np.isfinite(linear)
    if linear_mask.any():
        comparisons["linear"] = numeric_metrics(actual[linear_mask], linear[linear_mask], scale=max(scale, 1e-9))
    simple_mae = min([value.get("mae", float("inf")) for value in comparisons.values()] or [float("inf")])
    model["complex_model_enabled"] = bool(model.get("mae") is not None and model["mae"] <= simple_mae * 0.98)
    model["baseline_comparison"] = comparisons
    return model


def _risk_group(group: pd.DataFrame) -> dict:
    actual = group.actual_class.to_numpy(dtype=int)
    probability = group.risk_probability.to_numpy(dtype=float)
    accepted = group.get("accepted", pd.Series(True, index=group.index)).fillna(False).astype(bool).to_numpy()
    threshold = float(group.get("threshold", pd.Series(0.5, index=group.index)).iloc[0])
    result = classification_metrics(actual[accepted], probability[accepted], threshold)
    result["total_n"] = int(len(group))
    result["refusal_rate"] = round(float(1.0 - np.mean(accepted)), 6)
    if "logistic_probability" in group:
        logistic = classification_metrics(actual[accepted], group.loc[accepted, "logistic_probability"].to_numpy(dtype=float), threshold)
        result["logistic_baseline"] = logistic
        result["complex_model_enabled"] = bool(
            (result.get("pr_auc") or 0) >= (logistic.get("pr_auc") or 0) + 0.01
            and result["brier"] <= logistic["brier"] * 1.05
        )
    return result


def _subgroups(group: pd.DataFrame, task: str) -> dict:
    dimensions = [column for column in ("age_group", "gender", "device_model", "missingness_group", "disease_status") if column in group]
    output = {}
    for dimension in dimensions:
        output[dimension] = {}
        for label, subset in group.groupby(dimension, dropna=False):
            if len(subset) < 20:
                continue
            output[dimension][str(label)] = _numeric_group(subset) if task == "numeric" else _risk_group(subset)
    return output


def evaluate(frame: pd.DataFrame) -> dict:
    required = {"participant_id", "timestamp", "metric", "task", "split"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"missing required columns: {missing}")
    split_ids = {name: set(group.participant_id.astype(str)) for name, group in frame.groupby("split")}
    overlap = sum(len(split_ids[a] & split_ids[b]) for index, a in enumerate(split_ids) for b in list(split_ids)[index + 1:])
    if overlap:
        raise ValueError(f"participant leakage across splits: {overlap}")
    output = {"schema_version": "external-prediction-evaluation.v1", "participant_overlap": 0, "metrics": {}}
    evaluation = frame[frame.split.isin(["test", "external"])].copy()
    for (split, metric, task), group in evaluation.groupby(["split", "metric", "task"]):
        if task == "numeric":
            required_task = {"actual", "predicted"}
            result = _numeric_group(group)
        elif task == "risk":
            required_task = {"actual_class", "risk_probability"}
            result = _risk_group(group)
        else:
            raise ValueError(f"unsupported task: {task}")
        task_missing = sorted(required_task - set(group.columns))
        if task_missing:
            raise ValueError(f"{metric}/{task} missing: {task_missing}")
        result["subgroups"] = _subgroups(group, task)
        output["metrics"].setdefault(str(split), {})[str(metric)] = {"task": task, **result}
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    source = Path(args.csv)
    report = evaluate(pd.read_csv(source))
    out = Path(args.out) if args.out else source.with_suffix(".evaluation.json")
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(out), "splits": list(report["metrics"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
