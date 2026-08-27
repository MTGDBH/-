# -*- coding: utf-8 -*-
"""Regression checks for the stability-first curve candidate set."""
from datetime import datetime, timedelta, timezone

import numpy as np

from curve_models import MODEL_SPECS
from forecast_selection import _seasonal_reliability, fit_predict
from health_curve import analyze


required = {'min_points', 'metrics', 'missing', 'measurement_conditions', 'max_horizon_days'}
assert {'last_value', 'rolling_median', 'seasonal_naive', 'ets_damped_trend',
        'kalman_local_level', 'kalman_local_linear', 'robust_quantile_trend',
        'population_prior_residual'} <= set(MODEL_SPECS)
assert all(required <= set(spec) for spec in MODEL_SPECS.values())

start = datetime(2026, 1, 1, 8, tzinfo=timezone.utc)
points = [{'t': (start + timedelta(days=i)).isoformat(), 'v': 120 + 0.7 * i,
           'condition': 'morning_rest'} for i in range(56)]
result = analyze('systo', 'mmHg', points, forecast_days=14)
assert set(result['horizon_models']) == {'1', '3', '7', '14'}
for row in result['backtest']['horizons'].values():
    for score in row['scores'].values():
        assert {'prediction_error', 'calibration_error', 'instability_penalty',
                'complexity_penalty', 'final_score'} <= set(score)
if result['forecast']['available']:
    assert result['forecast']['calibration_coverage'] is not None
    assert result['forecast']['mean_interval_width'] > 0
    assert len(result['forecast']['curve']['lower']) == 14

flat = [{'t': (start + timedelta(days=i)).isoformat(), 'v': 128.0,
         'condition': 'morning_rest'} for i in range(56)]
refused = analyze('systo', 'mmHg', flat, forecast_days=7)
assert refused['forecast']['available'] is False
assert any(reason['reason_code'] == 'BASELINE_NOT_BEATEN' for reason in refused['forecast']['reasons'])

seasonal_x = np.arange(42, dtype=float)
seasonal_y = 100 + 10 * np.sin(2 * np.pi * seasonal_x / 7)
assert _seasonal_reliability(seasonal_x, seasonal_y)['reliable'] is True
assert _seasonal_reliability(np.arange(20), np.arange(20))['reliable'] is False

prior = {'level': 125.0, 'slope': 0.1, 'as_of_day': 0.0, 'metric': 'systo',
         'unit': 'mmHg', 'condition_group': 'bp:legacy:morning_rest', 'version': 'population.v1'}
prior_prediction = fit_predict('population_prior_residual', np.arange(10), 126 + np.arange(10) * 0.1,
                               np.array([11.0]), prior)
assert np.isfinite(prior_prediction).all()

shift = [{'t': (start + timedelta(days=i)).isoformat(), 'v': 120 + (25 if i >= 20 else 0),
          'condition': 'morning_rest'} for i in range(42)]
changed = analyze('systo', 'mmHg', shift, forecast_days=7)
assert changed['change_point'] is True
assert changed['state_segment']['start_date'] is not None

for metric, values in [('steps', [4000 + i * 20 for i in range(42)]),
                       ('sleep', [7 + (i % 3) * .1 for i in range(42)])]:
    behavior = analyze(metric, 'count' if metric == 'steps' else 'hour',
                       [{'t': (start + timedelta(days=i)).isoformat(), 'v': value} for i, value in enumerate(values)], 7)
    assert behavior['forecast']['available'] is False
    assert behavior['metric_policy']['behavior'] is True

print('forecast selection regression: PASS')
