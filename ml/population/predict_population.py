"""CLI inference for trained CHARLS population models using the unified contract."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common.prediction_contract import build_prediction_output
from population.modeling import risk_levels


def load_input(path: str | None) -> dict:
    text = Path(path).read_text(encoding="utf-8") if path else sys.stdin.buffer.read().decode("utf-8")
    value = json.loads(text or "{}")
    if not isinstance(value, dict):
        raise ValueError("input must be a JSON object")
    return value


def feature_frame(payload: dict, features: list[str]) -> tuple[pd.DataFrame, float]:
    row = {}
    for feature in features:
        raw_name = feature[:-2] if feature.endswith("_x") else feature
        value = payload.get(feature, payload.get(raw_name))
        row[feature] = pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]
    frame = pd.DataFrame([row])
    completeness = float(frame.notna().mean(axis=1).iloc[0])
    return frame, completeness


def predict_numeric(target: str, metadata: dict, payload: dict, models_dir: Path) -> dict:
    contract_target = "bp" if target in {"systo", "diasto"} else target
    frame, completeness = feature_frame(payload, metadata["features"])
    if completeness < float(metadata["minimum_completeness"]):
        return build_prediction_output(contract_target, value_kind="predicted", status="insufficient_data", abstained=True, reason=f"特征完整度不足（{completeness:.0%}）", metadata={"component": target})
    selected = metadata["selected_model"]
    if selected == "last_value":
        source = metadata["source_field"]
        point = payload.get(source)
        if point is None:
            return build_prediction_output(contract_target, value_kind="predicted", status="insufficient_data", abstained=True, reason=f"缺少最近一次{source}直接测量值", metadata={"component": target})
        point = float(point)
    else:
        model = joblib.load(models_dir / f"numeric_{target}.joblib")
        point = float(model.predict(frame)[0])
    margin = float(metadata["conformal_q80"])
    return build_prediction_output(
        contract_target, value_kind="predicted", status="available", horizon_days=730,
        model=f"charls_{selected}", point=round(point, 3), lower=round(point - margin, 3), upper=round(point + margin, 3),
        metadata={"component": target, "population_horizon": "Wave1_to_Wave2", "feature_completeness": round(completeness, 3), "not_for_7_day_forecast": True},
    )


def predict_risk(target: str, tier: str, metadata: dict, payload: dict, models_dir: Path) -> dict:
    frame, completeness = feature_frame(payload, metadata["features"])
    if completeness < float(metadata["minimum_completeness"]):
        return build_prediction_output(target, value_kind="estimated", status="insufficient_data", abstained=True, reason=f"特征完整度不足（{completeness:.0%}）", prediction_mode="risk", target_kind=metadata.get("target_kind", "abnormal_risk"))
    model = joblib.load(models_dir / f"risk_{target}_{tier}.joblib")
    probability = float(model.predict_proba(frame)[0, 1])
    threshold = float(metadata["threshold"])
    level = str(risk_levels(np.asarray([probability]), threshold)[0])
    return build_prediction_output(
        target, value_kind="estimated", status="available", horizon_days=int(metadata.get("horizon_days", 1460)),
        model=f"charls_{metadata['selected_model']}_{tier}", risk_probability=round(probability, 6), risk_level=level,
        prediction_mode="risk", target_kind=metadata.get("target_kind", "abnormal_risk"),
        metadata={
            "population_horizon": metadata.get("population_horizon", "Wave1_to_Wave3"), "feature_tier": tier,
            "feature_completeness": round(completeness, 3), "risk_threshold": threshold,
            "does_not_replace_laboratory_test": True,
        },
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=["numeric", "risk"], required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--tier", choices=["noninvasive", "micro_anchor"], default="noninvasive")
    parser.add_argument("--input", default=None)
    parser.add_argument("--models-dir", default=str(ROOT / "models" / "population"))
    args = parser.parse_args()
    models_dir = Path(args.models_dir)
    suffix = f"numeric_{args.target}" if args.task == "numeric" else f"risk_{args.target}_{args.tier}"
    metadata = json.loads((models_dir / f"{suffix}.metadata.json").read_text(encoding="utf-8"))
    payload = load_input(args.input)
    output = predict_numeric(args.target, metadata, payload, models_dir) if args.task == "numeric" else predict_risk(args.target, args.tier, metadata, payload, models_dir)
    sys.stdout.buffer.write((json.dumps(output, ensure_ascii=False) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
