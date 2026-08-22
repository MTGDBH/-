"""Validate real longitudinal data and create participant-disjoint split manifests."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent
SCHEMA = json.loads((ROOT / "longitudinal_dataset_schema.json").read_text(encoding="utf-8"))


def stable_fraction(value: str) -> float:
    digest = hashlib.sha256(str(value).encode("utf-8")).hexdigest()
    return int(digest[:12], 16) / float(16 ** 12)


def validate(frame: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    required = set(SCHEMA["required_columns"])
    missing_columns = sorted(required - set(frame.columns))
    forbidden = sorted(set(column.lower() for column in frame.columns) & set(SCHEMA["forbidden_direct_identifier_columns"]))
    errors, warnings = [], []
    if missing_columns:
        errors.append(f"missing required columns: {missing_columns}")
        return {"valid": False, "errors": errors, "warnings": warnings}, pd.DataFrame()
    if forbidden:
        errors.append(f"direct identifier columns are forbidden: {forbidden}")
    data = frame.copy()
    data["timestamp"] = pd.to_datetime(data["timestamp"], utc=True, errors="coerce")
    data["value"] = pd.to_numeric(data["value"], errors="coerce")
    invalid_timestamp = int(data.timestamp.isna().sum())
    invalid_value = int(data.value.isna().sum())
    if invalid_timestamp:
        errors.append(f"invalid timestamps: {invalid_timestamp}")
    if invalid_value:
        errors.append(f"invalid numeric values: {invalid_value}")
    invalid_sources = sorted(set(data.source.dropna().astype(str)) - set(SCHEMA["allowed_sources"]))
    if invalid_sources:
        errors.append(f"unsupported or synthetic sources: {invalid_sources}")
    invalid_quality = sorted(set(data.quality_status.dropna().astype(str)) - set(SCHEMA["allowed_quality_status"]))
    if invalid_quality:
        errors.append(f"invalid quality_status: {invalid_quality}")
    duplicate_count = int(data.duplicated(["participant_id", "measurement_id"]).sum())
    if duplicate_count:
        warnings.append(f"duplicate participant_id/measurement_id rows: {duplicate_count}")

    valid_rows = data[data.timestamp.notna() & data.value.notna() & data.quality_status.ne("excluded")].copy()
    spans = valid_rows.groupby("participant_id").timestamp.agg(lambda values: (values.max() - values.min()).days + 1)
    participant_sites = valid_rows.groupby("participant_id").site_id.nunique()
    if (participant_sites > 1).any():
        warnings.append("some participants appear at multiple sites; split assignment follows participant and external site has priority")
    site_participants = valid_rows.groupby("site_id").participant_id.nunique().sort_values(ascending=False)
    gates = SCHEMA["gates"]
    external_candidates = site_participants[site_participants >= gates["minimum_external_site_participants"]]
    external_site = str(external_candidates.index[-1]) if len(external_candidates) >= 2 else None

    participant_table = valid_rows.groupby("participant_id", as_index=False).agg(
        site_id=("site_id", "first"), region_id=("region_id", "first"),
        first_timestamp=("timestamp", "min"), last_timestamp=("timestamp", "max"),
        rows=("value", "size"), metrics=("metric", "nunique"),
    )
    participant_table["span_days"] = (participant_table.last_timestamp - participant_table.first_timestamp).dt.days + 1
    participant_table["split"] = ""
    if external_site:
        participant_table.loc[participant_table.site_id.astype(str) == external_site, "split"] = "external"
    development = participant_table.split.eq("")
    fractions = participant_table["participant_id"].map(stable_fraction)
    participant_table.loc[development & (fractions < 0.70), "split"] = "train"
    participant_table.loc[development & (fractions >= 0.70) & (fractions < 0.85), "split"] = "validation"
    participant_table.loc[development & (fractions >= 0.85), "split"] = "test"

    participants = int(valid_rows.participant_id.nunique())
    median_span = float(spans.median()) if len(spans) else 0.0
    participants_90d = int((spans >= gates["target_days_per_participant"]).sum())
    split_sets = {name: set(participant_table.loc[participant_table.split == name, "participant_id"].astype(str)) for name in ("train", "validation", "test", "external")}
    overlap = sum(len(split_sets[a] & split_sets[b]) for i, a in enumerate(split_sets) for b in list(split_sets)[i + 1:])
    readiness = {
        "engineering_pilot": participants >= gates["engineering_pilot_participants"] and participants_90d >= gates["engineering_pilot_participants"],
        "model_development_minimum": participants >= gates["model_development_min_participants"] and participants_90d >= gates["model_development_min_participants"],
        "model_development_target": participants >= gates["model_development_target_participants"] and participants_90d >= gates["model_development_target_participants"],
        "external_holdout": external_site is not None and len(split_sets["external"]) >= gates["minimum_external_site_participants"],
    }
    report = {
        "schema_version": SCHEMA["schema_version"], "valid": not errors, "errors": errors, "warnings": warnings,
        "rows": int(len(frame)), "valid_rows": int(len(valid_rows)), "participants": participants,
        "sites": int(valid_rows.site_id.nunique()), "regions": int(valid_rows.region_id.nunique()),
        "median_span_days": round(median_span, 2), "participants_with_90_days": participants_90d,
        "metric_counts": {str(k): int(v) for k, v in valid_rows.groupby("metric").size().items()},
        "source_counts": {str(k): int(v) for k, v in valid_rows.groupby("source").size().items()},
        "quality_counts": {str(k): int(v) for k, v in data.groupby("quality_status").size().items()},
        "external_site": external_site,
        "split_participants": {name: len(values) for name, values in split_sets.items()},
        "participant_overlap": int(overlap), "readiness": readiness,
        "gates": gates,
    }
    if overlap:
        report["valid"] = False
        report["errors"].append(f"participant overlap across splits: {overlap}")
    return report, participant_table


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv")
    parser.add_argument("--out", default=None)
    parser.add_argument("--split-out", default=None)
    args = parser.parse_args()
    source = Path(args.csv)
    frame = pd.read_csv(source)
    report, manifest = validate(frame)
    out = Path(args.out) if args.out else source.with_suffix(".quality.json")
    split_out = Path(args.split_out) if args.split_out else source.with_suffix(".splits.csv")
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not manifest.empty:
        manifest.to_csv(split_out, index=False)
    print(json.dumps({"valid": report["valid"], "report": str(out), "split_manifest": str(split_out)}, ensure_ascii=False))
    raise SystemExit(0 if report["valid"] else 2)


if __name__ == "__main__":
    main()
