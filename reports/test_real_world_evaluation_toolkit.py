import csv
import tempfile
from pathlib import Path

from analyze_human_evaluation import analyze as analyze_human
from run_real_world_evaluation import analyze_clinician, analyze_curve, RAG_PACKET


ROOT = Path(__file__).resolve().parents[1]
assert analyze_human(ROOT / "reports" / "human-evaluation-data-template.csv")["status"] == "pending"
assert analyze_clinician(ROOT / "reports" / "clinician-panel-ratings-template.csv", RAG_PACKET)["status"] == "pending"
empty_curve = analyze_curve(ROOT / "ml" / "curve" / "external_dataset_template.csv", ROOT / "ml" / "curve" / "exploratory_prediction_windows_template.csv")
assert empty_curve["status"] == "pending" and empty_curve["participants"] == 0

with tempfile.TemporaryDirectory() as folder:
    folder = Path(folder)
    # Structural unit fixture only: no real-person or performance claim.
    bad_human = folder / "bad-human.csv"
    bad_human.write_text("name,participant_id\n某姓名,OA001\n", encoding="utf-8")
    result = analyze_human(bad_human)
    assert result["status"] == "invalid" and "direct identifier" in result["errors"][0]

    window_template = ROOT / "ml" / "curve" / "exploratory_prediction_windows_template.csv"
    fields = next(csv.reader(window_template.open(encoding="utf-8-sig")))
    windows = folder / "windows.csv"
    with windows.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader()
        writer.writerow({"participant_id": "UNIT_P1", "site_id": "UNIT_SITE", "split": "exploratory_temporal_test", "metric": "systo", "measurement_condition": "morning_rest", "horizon_days": 1,
                         "history_start": "2026-01-01T08:00:00+08:00", "history_end": "2026-01-10T08:00:00+08:00", "origin_time": "2026-01-10T08:00:00+08:00", "target_time": "2026-01-11T08:00:00+08:00",
                         "status": "forecasted", "actual": 130, "predicted": 128, "lower": 120, "upper": 136, "refusal_reason": ""})
        writer.writerow({"participant_id": "UNIT_P1", "site_id": "UNIT_SITE", "split": "other_split", "metric": "systo", "measurement_condition": "evening_rest", "horizon_days": 1,
                         "history_start": "2026-01-01T20:00:00+08:00", "history_end": "2026-01-10T20:00:00+08:00", "origin_time": "2026-01-10T20:00:00+08:00", "target_time": "2026-01-11T20:00:00+08:00",
                         "status": "refused", "actual": "", "predicted": "", "lower": "", "upper": "", "refusal_reason": "NO_STABLE_MODEL"})
    result = analyze_curve(ROOT / "ml" / "curve" / "external_dataset_template.csv", windows)
    assert result["status"] == "invalid"
    assert result["participant_overlap_across_splits"] == 1
    assert result["micro"]["refusal_rate"] == 0.5
    assert result["micro"]["coverage"] == 1.0
    assert result["refusal_reason_distribution"] == {"NO_STABLE_MODEL": 1}

print("real-world evaluation pending gates, identifier rejection, temporal isolation and refusal preservation: PASS")
