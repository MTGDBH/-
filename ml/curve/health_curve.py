# -*- coding: utf-8 -*-
"""Personal health trend analysis (curve.v2).

The tool separates observations, robust historical trend and a short
probabilistic forecast. It is a health-management aid, not a diagnosis.
"""
import json
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

from curve_models import MODELS, huber_fit, huber_predict, robust_local_smooth
from curve_utils import (
    MEDICAL_BOUNDS, FoldLocalPipeline, canonical_measurement_group,
    condition_is_forecast_ready, local_day,
)

MIN_TREND_DAYS = 7
FORECAST_GATES = {7: (21, 28), 14: (42, 56), 30: (84, 90)}

METRIC_POLICIES = {
    'systo': {'forecast': True, 'aggregate': 'median', 'label': '收缩压', 'measurement_strategy': {'strict_group_fields': ['posture', 'measurement_period', 'device_source', 'repeat_status']}},
    'diasto': {'forecast': True, 'aggregate': 'median', 'label': '舒张压', 'measurement_strategy': {'strict_group_fields': ['posture', 'measurement_period', 'device_source', 'repeat_status']}},
    'pulse': {'forecast': True, 'aggregate': 'median', 'condition': 'resting', 'label': '静息心率', 'measurement_strategy': {'allowed_groups': ['pulse:resting']}},
    'weight': {'forecast': True, 'aggregate': 'median', 'label': '体重', 'measurement_strategy': {'allowed_groups': ['weight:morning_similar_clothing']}},
    'glucose': {'forecast': True, 'aggregate': 'median', 'condition_required': True, 'label': '血糖', 'measurement_strategy': {'allowed_groups': ['glucose:fasting', 'glucose:postprandial_2h', 'glucose:random']}},
    'health_score': {'forecast': False, 'aggregate': 'median', 'label': '综合健康分'},
    'steps': {'forecast': False, 'behavior': True, 'aggregate': 'sum', 'label': '步数'},
    'sleep': {'forecast': False, 'behavior': True, 'aggregate': 'median', 'label': '睡眠'},
    'spo2': {'forecast': False, 'anomaly_only': True, 'label': '血氧'},
    'temp': {'forecast': False, 'anomaly_only': True, 'label': '体温'},
    'resp': {'forecast': False, 'anomaly_only': True, 'label': '呼吸频率'},
    'pulse_pressure': {'forecast': False, 'behavior': True, 'aggregate': 'median', 'label': '脉压'},
}
FORECASTABLE_METRICS = {k for k, v in METRIC_POLICIES.items() if v.get('forecast')}


def _timestamp(value):
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or '').strip()
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return float(parsed.timestamp())


def _rows(points, metric):
    rows = []
    for index, point in enumerate(points or []):
        if not isinstance(point, dict):
            continue
        try:
            t = _timestamp(point.get('t'))
            v = float(point.get('v'))
        except (TypeError, ValueError, OverflowError):
            continue
        if not np.isfinite(t) or not np.isfinite(v):
            continue
        row = {
            't': t,
            'v': v,
            'condition': str(point.get('condition') or 'unknown').strip().lower() or 'unknown',
            'source': point.get('source'),
            'id': point.get('id', index),
            'raw_index': index,
            'raw_indexes': [index],
            'timezone': point.get('timezone'),
            'posture': point.get('posture'),
            'measurement_period': point.get('measurement_period'),
            'device_source': point.get('device_source'),
            'repeat_status': point.get('repeat_status'),
            'resting': point.get('resting'),
            'clothing_condition': point.get('clothing_condition'),
        }
        try:
            row['local_day'] = local_day(point.get('t'), point.get('timezone'))
        except (TypeError, ValueError, OverflowError):
            continue
        row['measurement_group'] = canonical_measurement_group(metric, row)
        rows.append(row)
    rows.sort(key=lambda row: row['t'])
    return rows


def _state_space_fit(x, y):
    """Dependency-free robust local-linear state estimate."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if len(y) == 1:
        return np.array([y[0], 0.0, 0.0, 1.0])
    dt = np.diff(x)
    diffs = np.diff(y) / np.maximum(dt, 1e-6)
    slope = float(np.median(diffs[-min(7, len(diffs)):]))
    level = float(y[0])
    noise = max(float(np.median(np.abs(y - np.median(y)))) * 1.4826, 1e-3)
    process = max(float(np.median(np.abs(np.diff(y)))) * 0.05, noise * 0.02)
    for i in range(1, len(y)):
        step = max(float(x[i] - x[i - 1]), 1e-6)
        predicted = level + slope * step
        innovation = float(y[i] - predicted)
        clipped = np.clip(innovation, -3.0 * noise, 3.0 * noise)
        gain = 0.20 if i < len(y) - 7 else 0.32
        level = predicted + gain * clipped
        slope = 0.94 * slope + 0.06 * clipped / step
    return np.array([level, slope, float(x[-1]), noise + process, 0.90])


def _state_space_predict(coef, target):
    target = np.asarray(target, dtype=float)
    level, slope, last_x, _, damping = [float(v) for v in coef]
    out = []
    for value in target:
        h = max(value - last_x, 0.0)
        accumulated = (1.0 - damping ** h) / max(1.0 - damping, 1e-9)
        out.append(level + slope * accumulated)
    return np.asarray(out, dtype=float)


def _fit_predict(name, x, y, target):
    target = np.asarray(target, dtype=float)
    if name == 'last_value':
        return float(y[-1]), np.full(len(target), float(y[-1]))
    if name == 'median':
        return float(np.median(y)), np.full(len(target), float(np.median(y)))
    if name == 'state_space_local_linear':
        coef = _state_space_fit(x, y)
        return coef, _state_space_predict(coef, target)
    fit, predict = MODELS[name]
    coef = fit(x, y)
    return coef, np.asarray(predict(coef, target), dtype=float)


def _metrics(actual, predicted, scale):
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    errors = actual - predicted
    mae = float(np.mean(np.abs(errors))) if len(errors) else None
    rmse = float(np.sqrt(np.mean(errors ** 2))) if len(errors) else None
    bias = float(np.mean(errors)) if len(errors) else None
    denom = max(float(scale), 1e-9)
    interval_q80 = float(np.quantile(np.abs(errors), 0.80)) if len(errors) else None
    interval_coverage = float(np.mean(np.abs(errors) <= interval_q80)) if len(errors) else None
    r2 = None
    if len(actual) > 1:
        r2 = float(1 - np.sum(errors ** 2) / max(np.sum((actual - np.mean(actual)) ** 2), 1e-9))
    return {
        'n': int(len(actual)),
        'mae': round(mae, 4) if mae is not None else None,
        'rmse': round(rmse, 4) if rmse is not None else None,
        'bias': round(bias, 4) if bias is not None else None,
        'mase': round(mae / denom, 4) if mae is not None else None,
        'r2': round(r2, 4) if r2 is not None else None,
        'interval_q80': round(interval_q80, 4) if interval_q80 is not None else None,
        'interval_coverage': round(interval_coverage, 4) if interval_coverage is not None else None,
    }


def _scale(y):
    scale = float(np.median(np.abs(np.diff(y)))) if len(y) > 1 else 0.0
    if scale < 1e-6:
        scale = float(np.std(y))
    return max(scale, abs(float(np.median(y))) * 0.01, 1e-6)


def _backtest(rows, metric, aggregate='median'):
    """Nested rolling validation with fold-local preprocessing.

    Candidate selection uses early origins. Interval calibration uses a later,
    non-overlapping tail whose first origin is after every selection target.
    """
    candidates = ['last_value', 'median', 'linear', 'huber', 'damped', 'state_space_local_linear']
    days = sorted({row['local_day'] for row in rows})
    if len(days) < 12:
        return None
    start = max(7, int(np.ceil(len(days) * 0.40)))
    calibration_start = max(start + 2, int(np.ceil(len(days) * 0.75)))
    calibration_start = min(calibration_start, len(days) - 2)
    calibration_day = datetime.fromisoformat(days[calibration_start])
    selection_origins = [
        index for index in range(start, calibration_start)
        if datetime.fromisoformat(days[index]) + timedelta(days=7) < calibration_day
    ]
    calibration_origins = list(range(calibration_start, len(days) - 1))
    scores = {}

    def run_candidate(name, origins, horizons=(1, 3, 7), audit=False):
        by_horizon, residuals, residual_leads, fold_records = {}, [], [], []
        for horizon in horizons:
            actual, predicted, point_scales, folds = [], [], [], 0
            for origin_index in origins:
                origin_day = datetime.fromisoformat(days[origin_index])
                train_rows = [row for row in rows if row['local_day'] <= days[origin_index]]
                future_rows = [row for row in rows if origin_day < datetime.fromisoformat(row['local_day']) <= origin_day + timedelta(days=horizon)]
                pipeline = FoldLocalPipeline(metric, aggregate).fit(train_rows)
                clean_train, train_meta = pipeline.transform(train_rows)
                clean_future, _ = pipeline.transform(future_rows)
                if len(clean_train) < 5 or not clean_future:
                    continue
                x_train = np.asarray([(row['t'] - clean_train[0]['t']) / 86400.0 for row in clean_train], dtype=float)
                y_train = np.asarray([row['v'] for row in clean_train], dtype=float)
                target_x = np.asarray([(row['t'] - clean_train[0]['t']) / 86400.0 for row in clean_future], dtype=float)
                try:
                    _, pred = _fit_predict(name, x_train, y_train, target_x)
                except Exception:
                    continue
                if len(pred) != len(clean_future) or not np.all(np.isfinite(pred)):
                    continue
                truth = np.asarray([row['v'] for row in clean_future], dtype=float)
                fold_scale = _scale(y_train)
                folds += 1
                actual.extend(truth.tolist()); predicted.extend(pred.tolist())
                point_scales.extend([fold_scale] * len(truth))
                if horizon == 7:
                    residuals.extend((truth - pred).tolist())
                    residual_leads.extend((target_x - x_train[-1]).tolist())
                    if audit:
                        fold_records.append({
                            'origin_day': days[origin_index], 'origin_index': origin_index,
                            'train_last_day': clean_train[-1]['local_day'],
                            'train_clean_values': [round(float(row['v']), 8) for row in clean_train],
                            'fit_parameters': train_meta['fit_parameters'],
                            'target_days': [row['local_day'] for row in clean_future],
                            'predicted': [round(float(value), 8) for value in pred],
                        })
            if actual:
                actual_arr, pred_arr, scales = np.asarray(actual), np.asarray(predicted), np.asarray(point_scales)
                metric_row = _metrics(actual_arr, pred_arr, float(np.median(scales)))
                metric_row.pop('interval_q80', None)
                metric_row.pop('interval_coverage', None)
                metric_row['mase'] = round(float(np.mean(np.abs(actual_arr - pred_arr) / scales)), 4)
                metric_row['origin_folds'] = folds
                by_horizon[str(horizon)] = metric_row
        return by_horizon, residuals, residual_leads, fold_records

    for name in candidates:
        by_horizon, _, _, _ = run_candidate(name, selection_origins)
        if by_horizon:
            primary = by_horizon.get('7') or by_horizon.get('3') or by_horizon.get('1')
            scores[name] = {
                **primary,
                'folds': sum(int(value.get('origin_folds') or 0) for value in by_horizon.values()),
                'horizons': by_horizon,
            }
    if not scores:
        return None
    selected = min(scores, key=lambda name: (scores[name]['mase'], abs(scores[name].get('bias') or 0)))
    _, residuals, residual_leads, calibration_audit = run_candidate(selected, calibration_origins, horizons=(7,), audit=True)
    _, _, _, selection_audit = run_candidate(selected, selection_origins, horizons=(7,), audit=True)
    selection_targets = [day for fold in selection_audit for day in fold['target_days']]
    first_calibration_origin = days[min(calibration_origins)] if calibration_origins else None
    disjoint = bool(selection_targets and first_calibration_origin and max(selection_targets) < first_calibration_origin)
    return {
        'method': 'nested_rolling_origin_fold_local',
        'selected': selected,
        'scores': scores,
        'folds': scores[selected]['folds'],
        'selection_origin_indices': selection_origins,
        'calibration_origin_indices': calibration_origins,
        'selection_target_before_calibration': disjoint,
        'calibration_residuals': [round(float(value), 5) for value in residuals],
        'calibration_residual_lead_days': [round(float(value), 3) for value in residual_leads],
        'selection_fold_audit': selection_audit,
        'calibration_fold_audit': calibration_audit,
    }


def _trend(x, y):
    if len(y) < 2:
        return 'stable', 'weak', 0.0, 'low', np.zeros(len(y))
    coef = huber_fit(x, y)
    fitted = np.asarray(huber_predict(coef, x), dtype=float)
    med = max(abs(float(np.median(y))), 1e-9)
    residual = y - fitted
    cv = float(np.std(residual) / med)
    fluct = 'low' if cv < 0.03 else ('moderate' if cv < 0.10 else 'high')
    recent_n = max(3, int(np.ceil(len(y) * 0.30)))
    recent_coef = huber_fit(x[-recent_n:], y[-recent_n:])
    slope, recent_slope = float(coef[0]), float(recent_coef[0])
    relative = abs(slope) * max(float(x[-1] - x[0]), 1e-6) / med
    threshold = {'low': 0.03, 'moderate': 0.06, 'high': 0.12}[fluct]
    direction = 'stable' if relative < threshold else ('rising' if slope > 0 else 'falling')
    strength = 'weak' if relative < 0.05 else ('moderate' if relative < 0.15 else 'strong')
    return direction, strength, recent_slope, fluct, fitted


def _reason(reason_code, message):
    return {'reason_code': reason_code, 'message': message}


def _forecast_reasons(metric, n, span, requested, policy, fluct, model, condition_ready, calibration_n):
    reasons = []
    if not policy.get('forecast'):
        reasons.append(_reason('METRIC_NOT_FORECASTABLE', '行为指标只提供滚动趋势，不做精确未来数值外推' if policy.get('behavior') else '该指标以异常检测和复测为主，不默认外推'))
    if n < 7:
        reasons.append(_reason('INSUFFICIENT_EFFECTIVE_DAYS', f'有效日不足（{n}/7）'))
    if span < 14:
        reasons.append(_reason('INSUFFICIENT_TIME_SPAN', f'时间跨度不足（{span:.1f}/14天）'))
    if not condition_ready:
        reasons.append(_reason('MEASUREMENT_CONDITION_NOT_READY', '测量条件不完整或不符合该指标的预测策略'))
    if model is None:
        reasons.append(_reason('NO_STABLE_MODEL', '滚动回测没有得到稳定模型'))
    if calibration_n < 4:
        reasons.append(_reason('INSUFFICIENT_CALIBRATION_RESIDUALS', f'独立校准残差不足（{calibration_n}/4）'))
    if fluct == 'high':
        reasons.append(_reason('HIGH_RECENT_VOLATILITY', '近期波动过高，预测区间会失去管理意义'))
    if policy.get('forecast') and requested >= 30 and (n < 84 or span < 90):
        reasons.append(_reason('INSUFFICIENT_30_DAY_HISTORY', '30天周级预测需要至少84个有效日且覆盖90天'))
    return reasons


def _reason_message(reasons):
    return '；'.join(item['message'] for item in reasons) if reasons else None


def analyze(metric, unit, points, forecast_days=7, condition_group=None):
    requested = int(max(7, min(30, int(forecast_days or 7))))
    policy = METRIC_POLICIES.get(metric, {})
    raw_rows = _rows(points, metric)
    all_groups = sorted({row['measurement_group'] for row in raw_rows})
    if condition_group:
        requested_group = str(condition_group).strip().lower()
        raw_rows = [row for row in raw_rows if row['measurement_group'] == requested_group or row['measurement_group'].endswith(f':{requested_group}')]
    selected_groups = sorted({row['measurement_group'] for row in raw_rows})
    strict_condition_metric = metric in {'glucose', 'pulse', 'weight', 'systo', 'diasto'}
    mixed_conditions = strict_condition_metric and len(selected_groups) > 1
    pipeline = FoldLocalPipeline(metric, policy.get('aggregate', 'median'))
    deduped = pipeline._daily(raw_rows)
    condition_ready = bool(selected_groups) and len(selected_groups) == 1 and condition_is_forecast_ready(metric, selected_groups[0])
    condition_complete = condition_ready
    if metric in {'systo', 'diasto'} and len(selected_groups) == 1:
        condition_complete = ':legacy:' not in selected_groups[0] and ':unknown' not in selected_groups[0]
    condition_coverage = sum(condition_is_forecast_ready(metric, row['measurement_group']) for row in raw_rows) / max(len(raw_rows), 1)
    if mixed_conditions:
        refusal = _reason('MIXED_MEASUREMENT_CONDITIONS', f'检测到不同测量条件，必须显式选择 condition_group：{selected_groups}')
        return {
            'success': True, 'status': 'insufficient_data', 'schema_version': 'curve.v2', 'metric': metric, 'unit': unit,
            'data_points': 0, 'raw_points': len(raw_rows), 'removed_outliers': 0, 'abnormal_spike': False,
            'change_point': False, 'change_point_indices': [],
            'measurement_groups': selected_groups, 'selected_measurement_group': None,
            'long_term_trend': 'stable', 'recent_trend': 'stable', 'trend_strength': 'weak',
            'eligibility': {'trend': False, 'forecast': False, 'reason': refusal['message'], 'reason_code': refusal['reason_code'], 'message': refusal['message'], 'reasons': [refusal]},
            'forecast': {'available': False, 'days': 0, 'horizon_days': 0, 'reason': refusal['message'], 'reason_code': refusal['reason_code'], 'message': refusal['message'], 'reasons': [refusal], 'boundary_hit': False, 'unclipped_prediction': [], 'curve': {'timestamps': [], 'predicted': [], 'lower': [], 'upper': []}},
            'curve': {'timestamps': [], 'actual': [], 'fitted': [], 'raw_timestamps': [float(row['t']) for row in deduped], 'raw_actual': [round(float(row['v']), 2) for row in deduped], 'raw_outlier_indices': [], 'raw_ids': [row.get('id', index) for index, row in enumerate(deduped)]},
            'warning': refusal['message'],
        }
    clean_rows, clean_meta = pipeline.fit_transform(raw_rows)
    removed = clean_meta['removed_indices']
    raw_count = len(raw_rows)
    if len(clean_rows) < MIN_TREND_DAYS:
        refusal = _reason('INSUFFICIENT_EFFECTIVE_DAYS', f'有效日不足（{len(clean_rows)}/7）')
        return {
            'success': True, 'status': 'insufficient_data', 'schema_version': 'curve.v2', 'metric': metric, 'unit': unit,
            'data_points': len(clean_rows), 'raw_points': raw_count,
            'removed_outliers': len(removed), 'abnormal_spike': bool(clean_meta['spikes']),
            'measurement_error_indices': clean_meta['measurement_errors'], 'spike_indices': clean_meta['spikes'],
            'change_point': bool(clean_meta['change_points']), 'change_point_indices': clean_meta['change_points'],
            'measurement_groups': selected_groups, 'selected_measurement_group': selected_groups[0] if len(selected_groups) == 1 else None,
            'long_term_trend': 'stable', 'recent_trend': 'stable', 'trend_strength': 'weak',
            'eligibility': {'trend': False, 'forecast': False, 'reason': refusal['message'], 'reason_code': refusal['reason_code'], 'message': refusal['message'], 'reasons': [refusal]},
            'forecast': {'available': False, 'days': 0, 'horizon_days': 0, 'reason': refusal['message'], 'reason_code': refusal['reason_code'], 'message': refusal['message'], 'reasons': [refusal], 'boundary_hit': False, 'unclipped_prediction': [], 'curve': {'timestamps': [], 'predicted': [], 'lower': [], 'upper': []}},
            'curve': {
                'timestamps': [float(row['t']) for row in clean_rows], 'actual': [round(float(row['v']), 2) for row in clean_rows],
                'fitted': [], 'raw_timestamps': [float(row['t']) for row in deduped], 'raw_actual': [round(float(row['v']), 2) for row in deduped],
                'raw_outlier_indices': [], 'raw_ids': [row.get('id', index) for index, row in enumerate(deduped)],
            },
        }
    x = np.asarray([(row['t'] - clean_rows[0]['t']) / 86400.0 for row in clean_rows], dtype=float)
    y = np.asarray([row['v'] for row in clean_rows], dtype=float)
    raw_ts = np.asarray([row['t'] for row in deduped], dtype=float)
    raw_values = np.asarray([row['v'] for row in deduped], dtype=float)
    span = max(float(x[-1]), 0.0)
    long_dir, strength, recent_slope, fluct, model_fitted = _trend(x, y)
    smooth = np.asarray(robust_local_smooth(x, y), dtype=float)
    bounds = MEDICAL_BOUNDS.get(metric)
    if bounds:
        smooth = np.clip(smooth, bounds[0], bounds[1])
        model_fitted = np.clip(model_fitted, bounds[0], bounds[1])
    raw_outlier_indices = list(removed)
    backtest = _backtest(raw_rows, metric, policy.get('aggregate', 'median')) if len(y) >= 12 else None
    selected = backtest.get('selected') if backtest else None
    score = backtest.get('scores', {}).get(selected) if backtest and selected else None
    baseline_values = y[x >= max(x[-1] - 14.0, 0)]
    baseline_values = baseline_values if len(baseline_values) else y
    baseline = {
        'value': round(float(np.median(baseline_values)), 2),
        'lower': round(float(np.quantile(baseline_values, 0.25)), 2),
        'upper': round(float(np.quantile(baseline_values, 0.75)), 2),
        'window_days': 14,
    }
    max_horizon = 0
    if len(y) >= 21 and span >= 28:
        max_horizon = 7
    if len(y) >= 42 and span >= 56:
        max_horizon = 14
    if len(y) >= 84 and span >= 90:
        max_horizon = 30
    horizon = min(requested, max_horizon) if max_horizon else 0
    calibration_residuals = np.asarray(backtest.get('calibration_residuals') or [], dtype=float) if backtest else np.asarray([], dtype=float)
    available = bool(
        metric in FORECASTABLE_METRICS and horizon > 0 and selected and score and fluct != 'high' and
        (float(score.get('mase')) if score.get('mase') is not None else 99) < 1.0 and
        int(score.get('folds') or 0) >= 3 and
        len(calibration_residuals) >= 4 and
        float(np.quantile(np.abs(calibration_residuals), 0.80)) <= max(abs(float(np.median(y))) * 0.20, 1.0) and
        condition_ready
    )
    if metric in FORECASTABLE_METRICS and requested >= 30 and horizon and horizon < requested:
        reasons = [_reason('PARTIAL_HORIZON_ONLY', f'当前数据最多支持未来{horizon}天；30天需要至少84个有效日且覆盖90天')]
    elif not available:
        reasons = _forecast_reasons(metric, len(y), span, requested, policy, fluct, selected, condition_ready, len(calibration_residuals))
        if horizon == 0 and metric in FORECASTABLE_METRICS:
            reasons.append(_reason('FORECAST_GATE_NOT_MET', f'预测门槛未满足：当前{len(y)}个有效日、跨度{span:.1f}天'))
        if score and (float(score.get('mase') or 99) >= 1.0 or int(score.get('folds') or 0) < 3):
            reasons.append(_reason('MODEL_VALIDATION_FAILED', '滚动模型选择集未稳定优于简单基线或验证起点不足'))
        if len(calibration_residuals) >= 4 and float(np.quantile(np.abs(calibration_residuals), 0.80)) > max(abs(float(np.median(y))) * 0.20, 1.0):
            reasons.append(_reason('CALIBRATION_INTERVAL_TOO_WIDE', '独立校准集得到的预测区间过宽'))
    else:
        reasons = []
    reason = _reason_message(reasons)
    primary_reason = reasons[0] if reasons else {'reason_code': None, 'message': None}
    forecast = {
        'available': available, 'days': horizon if available else 0, 'horizon_days': horizon if available else 0,
        'granularity': 'weekly' if horizon == 30 else 'daily', 'estimated_value': None, 'model': selected,
        'reason': reason, 'reason_code': primary_reason['reason_code'], 'message': primary_reason['message'], 'reasons': reasons,
        'note': '模型估计范围，不代表真实未来，也不是医学诊断', 'coverage_target': 0.80,
        'calibration_status': 'not_available', 'curve': {'timestamps': [], 'predicted': [], 'lower': [], 'upper': []},
        'boundary_hit': False, 'boundary_hit_indices': [], 'unclipped_prediction': [],
        'safety_message': None, 'display_policy': 'unclipped_when_within_bounds_else_clipped_with_warning',
    }
    if available:
        steps = np.array([7, 14, 21, 28, 30], dtype=float) if horizon == 30 else np.arange(1, horizon + 1, dtype=float)
        target_x = x[-1] + steps
        _, prediction = _fit_predict(selected, x, y, target_x)
        prediction = np.asarray(prediction, dtype=float)
        unclipped_prediction = prediction.copy()
        residuals = calibration_residuals
        q = float(np.quantile(np.abs(residuals), 0.80))
        q = max(q, abs(float(np.median(y))) * 0.01, 1e-6)
        margin = q * np.sqrt(1.0 + steps / max(len(y), 1))
        if bounds:
            boundary_mask = (unclipped_prediction < bounds[0]) | (unclipped_prediction > bounds[1])
            prediction = np.clip(prediction, bounds[0], bounds[1])
            lower = np.clip(prediction - margin, bounds[0], bounds[1])
            upper = np.clip(prediction + margin, bounds[0], bounds[1])
            forecast['boundary_hit'] = bool(np.any(boundary_mask))
            forecast['boundary_hit_indices'] = np.flatnonzero(boundary_mask).astype(int).tolist()
            if forecast['boundary_hit']:
                forecast['safety_message'] = '模型原始预测超出医学展示边界；已保留原始值并对展示值限界，请复核测量条件和临床状态。'
        else:
            lower, upper = prediction - margin, prediction + margin
        future_ts = clean_rows[-1]['t'] + steps * 86400.0
        forecast['estimated_value'] = round(float(prediction[-1]), 2)
        forecast['calibration_status'] = 'rolling_residual_conformal'
        forecast['interval_method'] = '80_percent_conformal_independent_calibration_tail'
        forecast['unclipped_prediction'] = [round(float(value), 2) for value in unclipped_prediction]
        forecast['curve'] = {
            'timestamps': [float(value) for value in future_ts],
            'predicted': [round(float(value), 2) for value in prediction],
            'lower': [round(float(value), 2) for value in lower],
            'upper': [round(float(value), 2) for value in upper],
        }
    latest = float(raw_values[-1])
    previous = float(raw_values[-2]) if len(raw_values) > 1 else latest
    change = latest - previous
    confidence_level = '充分' if available and len(y) >= 42 and fluct == 'low' else ('一般' if len(y) >= 7 else '不足')
    return {
        'success': True, 'status': 'ok', 'schema_version': 'curve.v2', 'metric': metric, 'unit': unit,
        'data_points': len(y), 'raw_points': raw_count, 'time_span_days': round(span, 1), 'medical_bounds': bounds,
        'removed_outliers': len(removed), 'raw_outlier_indices': raw_outlier_indices,
        'measurement_error_indices': clean_meta['measurement_errors'], 'spike_indices': clean_meta['spikes'],
        'change_point': bool(clean_meta['change_points']), 'change_point_indices': clean_meta['change_points'],
        'latest_value': round(latest, 2), 'previous_value': round(previous, 2), 'change': round(change, 2),
        'change_percent': round(change / previous * 100, 2) if abs(previous) > 1e-9 else 0,
        'long_term_trend': long_dir, 'recent_trend': 'rising' if recent_slope > 0 else ('falling' if recent_slope < 0 else 'stable'),
        'trend_strength': strength, 'fluctuation': fluct, 'abnormal_spike': bool(clean_meta['spikes']),
        'model': selected or 'robust_local_trend', 'model_score': score, 'backtest': backtest,
        'metric_policy': policy, 'measurement_condition_coverage': round(condition_coverage, 3),
        'measurement_groups': selected_groups, 'available_measurement_groups': all_groups,
        'selected_measurement_group': selected_groups[0] if len(selected_groups) == 1 else None,
        'measurement_condition_ready': condition_ready, 'measurement_condition_complete': condition_complete,
        'confidence_level': confidence_level, 'baseline': baseline, 'forecast': forecast,
        'eligibility': {
            'trend': len(y) >= MIN_TREND_DAYS, 'forecast': available, 'reason': reason,
            'reason_code': primary_reason['reason_code'], 'message': primary_reason['message'], 'reasons': reasons,
            'required_points': 21, 'required_span_days': 28,
        },
        'stats': {
            'mean': round(float(np.mean(y)), 2), 'median': round(float(np.median(y)), 2),
            'std': round(float(np.std(y)), 2), 'min': round(float(np.min(y)), 2), 'max': round(float(np.max(y)), 2),
        },
        'curve': {
            'timestamps': [float(value) for value in [row['t'] for row in clean_rows]],
            'actual': [round(float(value), 2) for value in y], 'fitted': [round(float(value), 2) for value in smooth],
            'model_fitted': [round(float(value), 2) for value in model_fitted],
            'raw_timestamps': [float(value) for value in raw_ts], 'raw_actual': [round(float(value), 2) for value in raw_values],
            'raw_outlier_indices': raw_outlier_indices,
            'clean_timestamps': [float(value) for value in [row['t'] for row in clean_rows]],
            'clean_actual': [round(float(value), 2) for value in y],
            'smooth_timestamps': [float(value) for value in [row['t'] for row in clean_rows]],
            'smooth': [round(float(value), 2) for value in smooth],
            'raw_ids': [row.get('id', index) for index, row in enumerate(deduped)],
        },
        'warning': None if available else reason,
    }


def main():
    raw = sys.stdin.buffer.read().decode('utf-8', errors='replace').strip()
    try:
        req = json.loads(raw) if raw else {}
        if isinstance(req.get('batch'), list):
            results = [analyze(str(item.get('metric') or ''), str(item.get('unit') or ''), item.get('points') or [], req.get('forecast_days', 7), item.get('condition_group')) for item in req['batch']]
            out = {'success': True, 'metric': 'all', 'schema_version': 'curve.v2', 'metrics': results}
        else:
            out = analyze(str(req.get('metric') or ''), str(req.get('unit') or ''), req.get('points') or [], req.get('forecast_days', 7), req.get('condition_group'))
    except Exception as exc:
        out = {'success': False, 'error': f'internal error: {type(exc).__name__}: {exc}'}
    sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False) + '\n').encode('utf-8'))


if __name__ == '__main__':
    main()
