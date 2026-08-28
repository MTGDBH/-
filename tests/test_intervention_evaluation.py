from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone

from ml.intervention_evaluation.engine import evaluate_intervention


def _iso(day: int, hour: int = 8, *, start=datetime(2026, 1, 1, tzinfo=timezone.utc)) -> str:
    return (start + timedelta(days=day, hours=hour)).isoformat().replace("+00:00", "Z")


def _measurement(day: int, value: float, condition="fasting", **extra):
    return {"recorded_at": _iso(day), "value": value, "measurement_condition": condition,
            "data_quality": {"flags": []}, **extra}


def _payload(metric="glucose"):
    # 14-day baseline and 7-day outcome: every outcome weekday has two baseline
    # matches and the baseline span is long enough for a stable personal summary.
    measurements = [_measurement(day, 7.0 + (day % 3) * .1) for day in range(14)]
    measurements += [_measurement(day, 6.2 + (day % 3) * .1) for day in range(21, 28)]
    return {
        "intervention": {"intervention_id": "synthetic-intv", "minimum_adherence_rate": .7,
                         "planned_execution_count": 7},
        "target_metric": {"metric": metric, "unit": "mmol/L"},
        "baseline_window": {"start": _iso(0, 0), "end": _iso(13, 23)},
        "intervention_window": {"start": _iso(14, 0), "end": _iso(20, 23)},
        "outcome_window": {"start": _iso(21, 0), "end": _iso(27, 23)},
        "execution_records": [{"execution_log_id": f"x{i}", "performed": i != 3} for i in range(7)],
        "measurements": measurements, "timezone": "Asia/Shanghai", "random_seed": 42,
        "bootstrap_iterations": 800, "confidence_level": .95,
        "expected_measurement_count": {"baseline": 14, "outcome": 7},
        "concurrent_interventions": [], "acute_events": [], "prior_evaluations": [],
    }


def test_future_point_does_not_change_historical_evaluation():
    payload = _payload()
    before = evaluate_intervention(payload)
    future = deepcopy(payload)
    future["measurements"].append(_measurement(100, 30.0, device_id="future-device"))
    assert evaluate_intervention(future) == before


def test_measurement_conditions_are_never_mixed():
    payload = _payload()
    for row in payload["measurements"]:
        if _iso(21, 0) <= row["recorded_at"]:
            row["measurement_condition"] = "random"
    result = evaluate_intervention(payload)
    assert result["evidence_level"] == "insufficient"
    assert result["reason_code"] == "NO_MATCHED_MEASUREMENT_CONDITION"
    assert result["absolute_change"] is None


def test_insufficient_data_is_refused():
    payload = _payload()
    payload["measurements"] = payload["measurements"][:3] + payload["measurements"][-3:]
    result = evaluate_intervention(payload)
    assert result["evidence_level"] == "insufficient"
    assert result["reason_code"] == "INSUFFICIENT_MATCHED_DATA"


def test_concurrent_intervention_is_reported_and_downgrades_evidence():
    payload = _payload()
    payload["concurrent_interventions"] = [{"intervention_id": "other-1", "title": "同期睡眠干预"}]
    result = evaluate_intervention(payload)
    assert result["evidence_level"] == "descriptive_only"
    assert "CONCURRENT_INTERVENTIONS" in {item["code"] for item in result["confounders"]}


def test_bootstrap_is_reproducible():
    first = evaluate_intervention(_payload())
    second = evaluate_intervention(_payload())
    assert first["uncertainty_interval"] == second["uncertainty_interval"]
    assert first["input_fingerprint"] == second["input_fingerprint"]


def test_timezone_and_dst_offsets_do_not_change_local_date_grouping():
    payload = _payload()
    payload["timezone"] = "America/New_York"
    # Represent the same local 08:00 observations on the two sides of DST with
    # the correct offset. Matching is by local date/weekday, not UTC day.
    base_local = datetime(2026, 2, 23, 8)
    rows = []
    for day in range(14):
        local = base_local + timedelta(days=day)
        rows.append({"recorded_at": local.replace(tzinfo=timezone(timedelta(hours=-5))).isoformat(),
                     "value": 7 + day % 2 * .1, "measurement_condition": "fasting"})
    for day in range(21, 28):
        local = base_local + timedelta(days=day)
        rows.append({"recorded_at": local.replace(tzinfo=timezone(timedelta(hours=-4))).isoformat(),
                     "value": 6.3 + day % 2 * .1, "measurement_condition": "fasting"})
    payload["measurements"] = rows
    payload["baseline_window"] = {"start": rows[0]["recorded_at"], "end": (base_local + timedelta(days=13, hours=15)).replace(tzinfo=timezone(timedelta(hours=-5))).isoformat()}
    payload["intervention_window"] = {"start": (base_local + timedelta(days=14)).replace(tzinfo=timezone(timedelta(hours=-5))).isoformat(), "end": (base_local + timedelta(days=20, hours=15)).replace(tzinfo=timezone(timedelta(hours=-4))).isoformat()}
    payload["outcome_window"] = {"start": rows[14]["recorded_at"], "end": (base_local + timedelta(days=27, hours=15)).replace(tzinfo=timezone(timedelta(hours=-4))).isoformat()}
    result = evaluate_intervention(payload)
    assert result["evidence_level"] == "personal_preliminary"
    assert result["measurement_count"]["baseline"] == 14
    assert result["measurement_count"]["outcome"] == 7


def test_isolated_outlier_removed_but_change_point_retained_and_flagged():
    isolated = _payload()
    isolated["measurements"][16]["value"] = 20
    isolated_result = evaluate_intervention(isolated)
    assert isolated_result["measurement_count"]["excluded"]["outcome_isolated_outlier"] == 1
    assert "CONTINUOUS_STATE_CHANGE" not in {x["code"] for x in isolated_result["confounders"]}

    shifted = _payload()
    for row in shifted["measurements"][-5:]:
        row["value"] = 10.5
    shifted_result = evaluate_intervention(shifted)
    assert "CONTINUOUS_STATE_CHANGE" in {x["code"] for x in shifted_result["confounders"]}
    assert shifted_result["evidence_level"] == "descriptive_only"
    assert shifted_result["sensitivity_analysis"]["model"] == "segmented_time_series"


def test_low_value_is_not_mislabeled_as_improvement():
    payload = _payload()
    for row in payload["measurements"][-7:]:
        row["value"] = 3.0
    result = evaluate_intervention(payload)
    assert result["clinical_interpretation"] == "unsafe_or_out_of_target"
    assert "不能解释为改善" in result["message"]
    assert "已证明有效" not in result["message"]
