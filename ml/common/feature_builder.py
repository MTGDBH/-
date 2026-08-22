"""Leakage-safe rolling features for device/manual longitudinal measurements."""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import numpy as np
import pandas as pd


DEFAULT_WINDOWS = (1, 3, 7, 14, 30, 90)


def _slope(days: np.ndarray, values: np.ndarray) -> float:
    if len(values) < 2 or float(np.ptp(days)) <= 0:
        return 0.0
    return float(np.polyfit(days, values, 1)[0])


def build_window_features(
    records: pd.DataFrame | Iterable[dict[str, Any]],
    *,
    as_of: str | pd.Timestamp | None = None,
    windows: tuple[int, ...] = DEFAULT_WINDOWS,
) -> pd.DataFrame:
    """Create one feature row per participant using observations at/before ``as_of``.

    Required columns are participant_id, timestamp, metric and value. The
    function never forward-fills future records and therefore can be reused in
    rolling-origin validation without leaking the target window.
    """
    frame = records.copy() if isinstance(records, pd.DataFrame) else pd.DataFrame(records)
    required = {"participant_id", "timestamp", "metric", "value"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"missing required columns: {missing}")
    frame = frame.copy()
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True, errors="coerce")
    frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
    frame = frame.dropna(subset=["participant_id", "timestamp", "metric", "value"])
    cutoff = pd.Timestamp(as_of) if as_of is not None else frame["timestamp"].max()
    if cutoff.tzinfo is None:
        cutoff = cutoff.tz_localize("UTC")
    else:
        cutoff = cutoff.tz_convert("UTC")
    frame = frame[frame["timestamp"] <= cutoff]
    output: list[dict[str, Any]] = []
    for participant_id, group in frame.groupby("participant_id", sort=True):
        row: dict[str, Any] = {"participant_id": participant_id, "as_of": cutoff.isoformat()}
        for metric, series in group.groupby("metric", sort=True):
            series = series.sort_values("timestamp")
            row[f"{metric}__last"] = float(series.iloc[-1]["value"])
            row[f"{metric}__days_since_last"] = float((cutoff - series.iloc[-1]["timestamp"]).total_seconds() / 86400.0)
            for window in windows:
                start = cutoff - pd.Timedelta(days=int(window))
                sample = series[series["timestamp"] > start]
                prefix = f"{metric}__w{window}"
                row[f"{prefix}__count"] = int(len(sample))
                if sample.empty:
                    for name in ("mean", "median", "std", "min", "max", "slope", "missing_rate"):
                        row[f"{prefix}__{name}"] = np.nan
                    continue
                values = sample["value"].to_numpy(dtype=float)
                days = (sample["timestamp"] - sample["timestamp"].min()).dt.total_seconds().to_numpy() / 86400.0
                unique_days = sample["timestamp"].dt.floor("D").nunique()
                row[f"{prefix}__mean"] = float(np.mean(values))
                row[f"{prefix}__median"] = float(np.median(values))
                row[f"{prefix}__std"] = float(np.std(values))
                row[f"{prefix}__min"] = float(np.min(values))
                row[f"{prefix}__max"] = float(np.max(values))
                row[f"{prefix}__slope"] = _slope(days, values)
                row[f"{prefix}__missing_rate"] = float(max(0.0, 1.0 - unique_days / max(int(window), 1)))
        output.append(row)
    return pd.DataFrame(output).sort_values("participant_id").reset_index(drop=True)
