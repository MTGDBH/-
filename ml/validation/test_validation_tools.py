from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from evaluate_predictions import evaluate
from validate_longitudinal_dataset import validate


records = []
for index in range(160):
    participant = f"P{index:03d}"
    site = "SITE_B" if index >= 100 else "SITE_A"
    for day in range(90):
        timestamp = pd.Timestamp("2026-01-01T08:00:00Z") + pd.Timedelta(days=day)
        records.append({
            "participant_id": participant, "timestamp": timestamp.isoformat(),
            "metric": "hr", "value": 70 + index % 5, "unit": "bpm", "condition": "resting",
            "source": "real_device", "device_model": "test", "site_id": site, "region_id": site,
            "measurement_id": f"{participant}-{day}", "quality_status": "valid",
        })
report, manifest = validate(pd.DataFrame(records))
assert report["valid"] is True
assert report["participants"] == 160
assert report["participant_overlap"] == 0
assert report["readiness"]["engineering_pilot"] is True
assert report["readiness"]["external_holdout"] is True
assert set(manifest.split) <= {"train", "validation", "test", "external"}

prediction_rows = []
for index in range(80):
    participant = f"T{index:03d}"
    split = "external" if index >= 60 else "test"
    actual = 120 + index % 10
    prediction_rows.append({
        "participant_id": participant, "timestamp": "2026-04-01", "metric": "systo", "task": "numeric", "split": split,
        "actual": actual, "predicted": actual + 1, "lower": actual - 4, "upper": actual + 4,
        "baseline_pred": actual + 5, "linear_pred": actual + 3, "accepted": True,
        "age_group": "60-69", "gender": "female", "device_model": "test",
        "missingness_group": "low", "disease_status": "none",
    })
evaluation = evaluate(pd.DataFrame(prediction_rows))
assert evaluation["participant_overlap"] == 0
assert evaluation["metrics"]["test"]["systo"]["mae"] == 1.0
assert evaluation["metrics"]["test"]["systo"]["complex_model_enabled"] is True
print("longitudinal validation tools: PASS")
