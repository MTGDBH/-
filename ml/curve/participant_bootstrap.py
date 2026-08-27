# -*- coding: utf-8 -*-
"""Participant-cluster bootstrap for longitudinal forecast metrics."""
from __future__ import annotations

from collections import defaultdict

import numpy as np

METRIC_FIELDS = ('mae', 'rmse', 'mase', 'coverage', 'interval_width', 'bias',
                 'refusal_rate', 'baseline_win_rate', 'boundary_event_sensitivity',
                 'last_value_mae', 'rolling_median_mae',
                 'mae_delta_vs_last_value', 'mae_delta_vs_rolling_median')


def aggregate_contributions(rows):
    attempts = len(rows)
    forecasted = [row for row in rows if row.get('status') == 'forecasted']
    refused = sum(row.get('status') == 'refused' for row in rows)
    unscorable = sum(row.get('status') == 'forecasted_unscorable' for row in rows)
    n = sum(int(row.get('n') or 0) for row in forecasted)
    abs_sum = sum(float(row.get('sum_abs_error') or 0) for row in forecasted)
    sq_sum = sum(float(row.get('sum_sq_error') or 0) for row in forecasted)
    error_sum = sum(float(row.get('sum_error') or 0) for row in forecasted)
    scale_sum = sum(float(row.get('scale_denominator') or 0) for row in forecasted)
    covered = sum(int(row.get('covered_points') or 0) for row in forecasted)
    width_sum = sum(float(row.get('interval_width_sum') or 0) for row in forecasted)
    comparable = [row for row in forecasted if row.get('model_wins_best_baseline') is not None]
    baseline_points = sum(int(row.get('n') or 0) for row in comparable)
    events = sum(int(row.get('boundary_event_count') or 0) for row in forecasted)
    detected = sum(int(row.get('boundary_event_detected') or 0) for row in forecasted)
    last_value_mae = sum(float(row.get('last_value_mae') or 0) * int(row.get('n') or 0) for row in comparable) / baseline_points if baseline_points else None
    rolling_median_mae = sum(float(row.get('rolling_median_mae') or 0) * int(row.get('n') or 0) for row in comparable) / baseline_points if baseline_points else None
    mae = abs_sum / n if n else None
    return {
        'attempts': attempts, 'forecasted_windows': len(forecasted), 'refused_windows': refused,
        'unscorable_forecast_windows': unscorable, 'forecast_points': n,
        'mae': mae,
        'rmse': float(np.sqrt(sq_sum / n)) if n else None,
        'mase': abs_sum / scale_sum if scale_sum > 0 else None,
        'coverage': covered / n if n else None,
        'interval_width': width_sum / n if n else None,
        'bias': error_sum / n if n else None,
        'refusal_rate': refused / attempts if attempts else None,
        'baseline_win_rate': sum(bool(row['model_wins_best_baseline']) for row in comparable) / len(comparable) if comparable else None,
        'last_value_mae': last_value_mae,
        'rolling_median_mae': rolling_median_mae,
        'mae_delta_vs_last_value': mae - last_value_mae if mae is not None and last_value_mae is not None else None,
        'mae_delta_vs_rolling_median': mae - rolling_median_mae if mae is not None and rolling_median_mae is not None else None,
        'boundary_event_sensitivity': detected / events if events else None,
        'boundary_events': events, 'baseline_comparable_windows': len(comparable),
    }


def participant_bootstrap(rows, replicates=2000, confidence=0.95, seed=20260827):
    by_participant = defaultdict(list)
    for row in rows:
        by_participant[str(row['participant_id'])].append(row)
    participants = sorted(by_participant)
    estimate = aggregate_contributions(rows)
    result = {'cluster_unit': 'participant_id', 'participants': len(participants),
              'replicates': int(replicates), 'confidence': float(confidence), 'metrics': {}}
    if len(participants) < 2 or replicates < 1:
        result['status'] = 'insufficient_participants'
        for field in METRIC_FIELDS:
            result['metrics'][field] = {'estimate': estimate.get(field), 'lower': None, 'upper': None}
        return result
    rng = np.random.default_rng(seed)
    draws = {field: [] for field in METRIC_FIELDS}
    for _ in range(int(replicates)):
        sampled = rng.choice(participants, size=len(participants), replace=True)
        sample_rows = [row for participant_id in sampled for row in by_participant[participant_id]]
        values = aggregate_contributions(sample_rows)
        for field in METRIC_FIELDS:
            if values.get(field) is not None and np.isfinite(values[field]):
                draws[field].append(float(values[field]))
    alpha = (1.0 - confidence) / 2.0
    for field in METRIC_FIELDS:
        values = draws[field]
        result['metrics'][field] = {
            'estimate': estimate.get(field),
            'lower': float(np.quantile(values, alpha)) if values else None,
            'upper': float(np.quantile(values, 1.0 - alpha)) if values else None,
            'valid_replicates': len(values),
        }
    result['status'] = 'ok'
    return result
