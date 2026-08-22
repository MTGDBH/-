from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common.feature_builder import build_window_features
from common.prediction_contract import ALLOWED_MODES, METRICS, build_prediction_output


assert len(METRICS) == 19
assert {v["prediction_mode"] for v in METRICS.values()} <= ALLOWED_MODES

payload = build_prediction_output(
    "bp", value_kind="predicted", status="available", horizon_days=7,
    model="test", point=128.0, lower=120.0, upper=136.0,
)
assert payload["display_label"] == "预测值"
assert payload["prediction_mode"] == "value"

records = pd.DataFrame([
    {"participant_id": "P1", "timestamp": "2026-01-01T08:00:00Z", "metric": "hr", "value": 70},
    {"participant_id": "P1", "timestamp": "2026-01-03T08:00:00Z", "metric": "hr", "value": 74},
    {"participant_id": "P1", "timestamp": "2026-01-10T08:00:00Z", "metric": "hr", "value": 200},
])
features = build_window_features(records, as_of="2026-01-04T00:00:00Z")
assert len(features) == 1
assert features.loc[0, "hr__last"] == 74
assert features.loc[0, "hr__w7__count"] == 2
assert features.loc[0, "hr__w7__max"] == 74  # future record must not leak
print("prediction contract and feature builder: PASS")
