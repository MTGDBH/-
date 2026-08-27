# -*- coding: utf-8 -*-
"""Personal health trend analysis (curve.v2).

The tool separates observations, robust historical trend and a short
probabilistic forecast. It is a health-management aid, not a diagnosis.
"""
import json
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

from curve_models import MODEL_SPECS, huber_fit, huber_predict, robust_local_smooth
from curve_utils import (
    MEDICAL_BOUNDS, FoldLocalPipeline, canonical_measurement_group,
    condition_is_forecast_ready, local_day,
)
from forecast_selection import (
    SUPPORTED_HORIZONS, fit_predict, rolling_origin_select, select_post_change_segment,
)

MIN_TREND_DAYS = 7
FORECAST_GATES = {1: (14, 14), 3: (18, 18), 7: (28, 28), 14: (42, 42)}

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


def _fit_predict(name, x, y, target, population_prior=None):
    """Compatibility wrapper retained for callers of the curve.v2 module."""
    return None, fit_predict(name, x, y, target, population_prior)


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


def _backtest(rows, metric, aggregate='median', **options):
    """Compatibility facade over horizon-specific rolling-origin selection."""
    result = rolling_origin_select(rows, metric, aggregate, **options)
    if not result:
        return None
    primary = result['horizons'].get('7') or result['horizons'].get('3') or result['horizons'].get('1')
    if not primary:
        return result
    selection_targets = [row['target_day'] for row in primary.get('selection_fold_audit', [])]
    calibration_origins = primary.get('calibration_origin_indices', [])
    days = sorted({row['local_day'] for row in rows})
    first_calibration = days[min(calibration_origins)] if calibration_origins else None
    return {
        **result,
        'selected': primary.get('selected'), 'scores': primary.get('scores', {}),
        'folds': (primary.get('scores', {}).get(primary.get('selected'), {}) or {}).get('origin_folds', 0),
        'selection_origin_indices': primary.get('selection_origin_indices', []),
        'calibration_origin_indices': calibration_origins,
        'selection_target_before_calibration': bool(selection_targets and first_calibration and max(selection_targets) < first_calibration),
        'calibration_residuals': primary.get('calibration_residuals', []),
        'calibration_residual_lead_days': [7.0] * len(primary.get('calibration_residuals', [])),
        'selection_fold_audit': primary.get('selection_fold_audit', []),
        'calibration_fold_audit': primary.get('calibration_fold_audit', []),
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


def analyze(metric, unit, points, forecast_days=7, condition_group=None, population_prior=None,
            selection_options=None, interval_method='horizon_specific_split_conformal'):
    requested_raw = int(max(1, min(30, int(forecast_days or 7))))
    requested = max(value for value in SUPPORTED_HORIZONS if value <= min(requested_raw, 14))
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
    requested_selection_options = dict(selection_options or {})
    if not requested_selection_options.get('anomaly_handling', True):
        bounds_for_ablation = MEDICAL_BOUNDS.get(metric)
        clean_rows = [row for row in deduped if not bounds_for_ablation or bounds_for_ablation[0] <= row['v'] <= bounds_for_ablation[1]]
        clean_meta = {**clean_meta, 'spikes': [], 'removed_indices': clean_meta.get('measurement_errors', [])}
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
    selection_options = requested_selection_options
    model_rows, state_segment = select_post_change_segment(
        clean_rows, clean_meta, enabled=selection_options.get('change_point', True))
    x = np.asarray([(row['t'] - clean_rows[0]['t']) / 86400.0 for row in clean_rows], dtype=float)
    y = np.asarray([row['v'] for row in clean_rows], dtype=float)
    model_x = np.asarray([(row['t'] - model_rows[0]['t']) / 86400.0 for row in model_rows], dtype=float)
    model_y = np.asarray([row['v'] for row in model_rows], dtype=float)
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
    population_prior_status = {'enabled': False, 'reason': 'not supplied'}
    if population_prior is not None:
        if not isinstance(population_prior, dict):
            population_prior_status = {'enabled': False, 'reason': 'prior must be an object'}
            population_prior = None
        else:
            expected_group = selected_groups[0] if len(selected_groups) == 1 else None
            mismatches = []
            if population_prior.get('metric') != metric:
                mismatches.append('metric')
            if population_prior.get('unit') != unit:
                mismatches.append('unit')
            if population_prior.get('condition_group') != expected_group:
                mismatches.append('condition_group')
            if not population_prior.get('version'):
                mismatches.append('version')
            for field in ('level', 'slope', 'as_of_day'):
                if population_prior.get(field) is None:
                    mismatches.append(field)
            if mismatches:
                population_prior_status = {'enabled': False, 'reason': f"prior mismatch/missing: {','.join(mismatches)}"}
                population_prior = None
            else:
                population_prior_status = {'enabled': True, 'reason': None, 'version': population_prior['version']}
    selection_options['population_prior'] = population_prior
    backtest = _backtest(raw_rows, metric, policy.get('aggregate', 'median'), **selection_options) if len(y) >= 12 else None
    horizon_results = backtest.get('horizons', {}) if backtest else {}
    horizon_decisions = {}
    for key, value in horizon_results.items():
        horizon_residuals = np.abs(np.asarray(value.get('calibration_residuals') or [], dtype=float))
        horizon_q = float(np.quantile(horizon_residuals, 0.80)) if len(horizon_residuals) else None
        horizon_decisions[key] = {
            'model': value.get('selected'), 'decision': value.get('decision'), 'reason': value.get('reason'),
            'score': value.get('scores', {}).get(value.get('selected')),
            'best_baseline': value.get('best_baseline'), 'calibration_n': int(len(horizon_residuals)),
            'interval_coverage': round(float(np.mean(horizon_residuals <= horizon_q)), 4) if horizon_q is not None else None,
            'mean_interval_width_unbounded': round(2.0 * horizon_q, 4) if horizon_q is not None else None,
        }
    selected = horizon_results.get(str(requested), {}).get('selected')
    score = horizon_results.get(str(requested), {}).get('scores', {}).get(selected) if selected else None
    baseline_values = y[x >= max(x[-1] - 14.0, 0)]
    baseline_values = baseline_values if len(baseline_values) else y
    baseline = {
        'value': round(float(np.median(baseline_values)), 2),
        'lower': round(float(np.quantile(baseline_values, 0.25)), 2),
        'upper': round(float(np.quantile(baseline_values, 0.75)), 2),
        'window_days': 14,
    }
    minimum_points, minimum_span = FORECAST_GATES[requested]
    horizon = requested if len(model_y) >= minimum_points and model_x[-1] >= minimum_span else 0
    requested_result = horizon_results.get(str(requested), {})
    calibration_residuals = np.asarray(requested_result.get('calibration_residuals') or [], dtype=float)
    required_buckets = [value for value in SUPPORTED_HORIZONS if value <= requested]
    all_bucket_ready = all(
        horizon_results.get(str(value), {}).get('selected') and
        len(horizon_results.get(str(value), {}).get('calibration_residuals') or []) >= 4
        for value in required_buckets
    )
    available = bool(
        metric in FORECASTABLE_METRICS and horizon > 0 and selected and score and fluct != 'high' and
        int(score.get('origin_folds') or 0) >= 3 and
        len(calibration_residuals) >= 4 and all_bucket_ready and
        float(np.quantile(np.abs(calibration_residuals), 0.80)) <= max(abs(float(np.median(y))) * 0.20, 1.0) and
        condition_ready
    )
    if metric in FORECASTABLE_METRICS and requested_raw > 14:
        reasons = [_reason('MAXIMUM_HORIZON_14_DAYS', '个体曲线经稳定性约束后最多外推14天；不提供30天精确日值')]
        available = False
    elif not available:
        reasons = _forecast_reasons(metric, len(y), span, requested, policy, fluct, selected, condition_ready, len(calibration_residuals))
        if not all_bucket_ready and metric in FORECASTABLE_METRICS:
            reasons.append(_reason('HORIZON_BUCKET_NOT_READY', '至少一个较短预测窗口缺少稳定优于双基线的模型或独立校准残差'))
        if horizon == 0 and metric in FORECASTABLE_METRICS:
            reasons.append(_reason('FORECAST_GATE_NOT_MET', f'预测门槛未满足：当前{len(y)}个有效日、跨度{span:.1f}天'))
        if requested_result.get('decision') == 'trend_only':
            reasons.append(_reason('BASELINE_NOT_BEATEN', '没有候选模型在该预测窗口稳定优于 last_value/rolling_median'))
        if len(calibration_residuals) >= 4 and float(np.quantile(np.abs(calibration_residuals), 0.80)) > max(abs(float(np.median(y))) * 0.20, 1.0):
            reasons.append(_reason('CALIBRATION_INTERVAL_TOO_WIDE', '独立校准集得到的预测区间过宽'))
    else:
        reasons = []
    reason = _reason_message(reasons)
    primary_reason = reasons[0] if reasons else {'reason_code': None, 'message': None}
    forecast = {
        'available': available, 'days': horizon if available else 0, 'horizon_days': horizon if available else 0,
        'granularity': 'daily', 'estimated_value': None, 'model': selected,
        'reason': reason, 'reason_code': primary_reason['reason_code'], 'message': primary_reason['message'], 'reasons': reasons,
        'note': '模型估计范围，不代表真实未来，也不是医学诊断', 'coverage_target': 0.80,
        'horizon_models': horizon_decisions, 'requested_horizon_days': requested_raw,
        'calibration_status': 'not_available', 'curve': {'timestamps': [], 'predicted': [], 'lower': [], 'upper': []},
        'boundary_hit': False, 'boundary_hit_indices': [], 'unclipped_prediction': [],
        'safety_message': None, 'display_policy': 'unclipped_when_within_bounds_else_clipped_with_warning',
    }
    if available:
        steps = np.arange(1, horizon + 1, dtype=float)
        prediction, margins, point_models = [], [], []
        for step in steps:
            bucket = min(value for value in SUPPORTED_HORIZONS if value >= step)
            bucket_result = horizon_results.get(str(bucket), {})
            model_name = bucket_result.get('selected')
            residuals = np.asarray(bucket_result.get('calibration_residuals') or calibration_residuals, dtype=float)
            pred = fit_predict(model_name, model_x, model_y, np.asarray([model_x[-1] + step]), population_prior)[0]
            q = float(np.quantile(np.abs(residuals), 0.80))
            if interval_method == 'gaussian_residual':
                q = 1.2816 * float(np.std(residuals, ddof=1)) if len(residuals) > 1 else q
            elif interval_method == 'pooled_split_conformal':
                pooled = [residual for item in horizon_results.values() for residual in item.get('calibration_residuals', [])]
                q = float(np.quantile(np.abs(pooled), 0.80)) if pooled else q
            q = max(q, abs(float(np.median(model_y))) * 0.01, 1e-6)
            prediction.append(float(pred)); margins.append(q * np.sqrt(1.0 + step / max(len(model_y), 1))); point_models.append(model_name)
        prediction, margins = np.asarray(prediction), np.asarray(margins)
        unclipped_prediction = prediction.copy()
        if bounds:
            boundary_mask = (unclipped_prediction < bounds[0]) | (unclipped_prediction > bounds[1])
            prediction = np.clip(prediction, bounds[0], bounds[1])
            lower = np.clip(prediction - margins, bounds[0], bounds[1])
            upper = np.clip(prediction + margins, bounds[0], bounds[1])
            forecast['boundary_hit'] = bool(np.any(boundary_mask))
            forecast['boundary_hit_indices'] = np.flatnonzero(boundary_mask).astype(int).tolist()
            if forecast['boundary_hit']:
                forecast['safety_message'] = '模型原始预测超出医学展示边界；已保留原始值并对展示值限界，请复核测量条件和临床状态。'
        else:
            lower, upper = prediction - margins, prediction + margins
        future_ts = clean_rows[-1]['t'] + steps * 86400.0
        forecast['estimated_value'] = round(float(prediction[-1]), 2)
        forecast['calibration_status'] = 'rolling_residual_conformal'
        forecast['interval_method'] = interval_method
        forecast['point_models'] = point_models
        forecast['calibration_coverage'] = horizon_decisions[str(requested)]['interval_coverage']
        forecast['mean_interval_width'] = round(float(np.mean(upper - lower)), 4)
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
        'state_segment': state_segment,
        'latest_value': round(latest, 2), 'previous_value': round(previous, 2), 'change': round(change, 2),
        'change_percent': round(change / previous * 100, 2) if abs(previous) > 1e-9 else 0,
        'long_term_trend': long_dir, 'recent_trend': 'rising' if recent_slope > 0 else ('falling' if recent_slope < 0 else 'stable'),
        'trend_strength': strength, 'fluctuation': fluct, 'abnormal_spike': bool(clean_meta['spikes']),
        'model': selected or 'robust_local_trend', 'model_score': score, 'backtest': backtest,
        'model_specs': MODEL_SPECS, 'horizon_models': horizon_decisions,
        'population_prior': population_prior_status,
        'metric_policy': policy, 'measurement_condition_coverage': round(condition_coverage, 3),
        'measurement_groups': selected_groups, 'available_measurement_groups': all_groups,
        'selected_measurement_group': selected_groups[0] if len(selected_groups) == 1 else None,
        'measurement_condition_ready': condition_ready, 'measurement_condition_complete': condition_complete,
        'confidence_level': confidence_level, 'baseline': baseline, 'forecast': forecast,
        'eligibility': {
            'trend': len(y) >= MIN_TREND_DAYS, 'forecast': available, 'reason': reason,
            'reason_code': primary_reason['reason_code'], 'message': primary_reason['message'], 'reasons': reasons,
            'required_points': minimum_points, 'required_span_days': minimum_span,
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
            results = [analyze(str(item.get('metric') or ''), str(item.get('unit') or ''), item.get('points') or [], req.get('forecast_days', 7), item.get('condition_group'), item.get('population_prior'), req.get('selection_options'), req.get('interval_method', 'horizon_specific_split_conformal')) for item in req['batch']]
            out = {'success': True, 'metric': 'all', 'schema_version': 'curve.v2', 'metrics': results}
        else:
            out = analyze(str(req.get('metric') or ''), str(req.get('unit') or ''), req.get('points') or [], req.get('forecast_days', 7), req.get('condition_group'), req.get('population_prior'), req.get('selection_options'), req.get('interval_method', 'horizon_specific_split_conformal'))
    except Exception as exc:
        out = {'success': False, 'error': f'internal error: {type(exc).__name__}: {exc}'}
    sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False) + '\n').encode('utf-8'))


if __name__ == '__main__':
    main()
