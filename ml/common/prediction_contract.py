"""Canonical output contract shared by offline and online prediction tools."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


CONTRACT_PATH = Path(__file__).resolve().parents[1] / "prediction_contract.json"
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
SCHEMA_VERSION = str(CONTRACT["schema_version"])
ALLOWED_MODES = frozenset(CONTRACT["allowed_prediction_modes"])
VALUE_LABELS = dict(CONTRACT["value_labels"])
METRICS = dict(CONTRACT["metrics"])


def metric_config(metric: str) -> dict[str, Any]:
    """Return a defensive copy; unknown/custom metrics explicitly abstain."""
    config = METRICS.get(str(metric), {})
    return {
        "prediction_mode": config.get("prediction_mode", "not_supported"),
        "horizons_days": list(config.get("horizons_days", [])),
        "target_kind": config.get("target_kind", "not_supported"),
    }


def build_prediction_output(
    metric: str,
    *,
    value_kind: str,
    status: str,
    horizon_days: int = 0,
    model: str | None = None,
    point: float | None = None,
    lower: float | None = None,
    upper: float | None = None,
    risk_probability: float | None = None,
    risk_level: str | None = None,
    abstained: bool = False,
    reason: str | None = None,
    metadata: dict[str, Any] | None = None,
    prediction_mode: str | None = None,
    target_kind: str | None = None,
) -> dict[str, Any]:
    """Build and validate a stable prediction payload.

    ``value_kind`` distinguishes actual measurements from model estimates and
    genuine future forecasts. Missing or unsafe results must be represented by
    ``abstained=True`` rather than a fabricated point value.
    """
    if value_kind not in VALUE_LABELS:
        raise ValueError(f"unsupported value_kind: {value_kind}")
    config = metric_config(metric)
    mode = prediction_mode or config["prediction_mode"]
    if mode not in ALLOWED_MODES:
        raise ValueError(f"unsupported prediction_mode: {mode}")
    if lower is not None and upper is not None and lower > upper:
        raise ValueError("lower must not exceed upper")
    if point is not None and lower is not None and point < lower:
        raise ValueError("point must be within interval")
    if point is not None and upper is not None and point > upper:
        raise ValueError("point must be within interval")
    if risk_probability is not None and not 0.0 <= risk_probability <= 1.0:
        raise ValueError("risk_probability must be within [0, 1]")
    return {
        "schema_version": SCHEMA_VERSION,
        "metric": str(metric),
        "prediction_mode": mode,
        "target_kind": target_kind or config["target_kind"],
        "value_kind": value_kind,
        "display_label": VALUE_LABELS[value_kind],
        "status": str(status),
        "horizon_days": int(horizon_days or 0),
        "point": point,
        "lower": lower,
        "upper": upper,
        "risk_probability": risk_probability,
        "risk_level": risk_level,
        "model": model,
        "abstained": bool(abstained),
        "reason": reason,
        "metadata": metadata or {},
    }
