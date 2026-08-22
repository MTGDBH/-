# -*- coding: utf-8 -*-
"""Personal health trend analysis (curve.v2).

The tool separates observations, robust historical trend and a short
probabilistic forecast. It is a health-management aid, not a diagnosis.
"""
import json
import sys
from datetime import datetime

import numpy as np

from curve_models import MODELS, huber_fit, huber_predict, robust_local_smooth
from curve_utils import MEDICAL_BOUNDS

MIN_TREND_DAYS = 7
FORECAST_GATES = {7: (21, 28), 14: (42, 56), 30: (84, 90)}

METRIC_POLICIES = {
    'systo': {'forecast': True, 'aggregate': 'median', 'label': '收缩压'},
    'diasto': {'forecast': True, 'aggregate': 'median', 'label': '舒张压'},
    'pulse': {'forecast': True, 'aggregate': 'median', 'condition': 'resting', 'label': '静息心率'},
    'weight': {'forecast': True, 'aggregate': 'median', 'label': '体重'},
    'glucose': {'forecast': True, 'aggregate': 'median', 'condition_required': True, 'label': '血糖'},
    'health_score': {'forecast': False, 'aggregate': 'median', 'label': '综合健康分'},
    'steps': {'forecast': False, 'behavior': True, 'aggregate': 'sum', 'label': '步数'},
    'sleep': {'forecast': False, 'behavior': True, 'aggregate': 'median', 'label': '睡眠'},
    'spo2': {'forecast': False, 'anomaly_only': True, 'label': '血氧'},
    'temp': {'forecast': False, 'anomaly_only': True, 'label': '体温'},
    'resp': {'forecast': False, 'anomaly_only': True, 'label': '呼吸频率'},
}
FORECASTABLE_METRICS = {k for k, v in METRIC_POLICIES.items() if v.get('forecast')}


def _timestamp(value):
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or '').strip()
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    return float(datetime.fromisoformat(text).timestamp())


def _rows(points):
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
        rows.append({
            't': t,
            'v': v,
            'condition': str(point.get('condition') or 'unknown').strip().lower() or 'unknown',
            'source': point.get('source'),
            'id': point.get('id', index),
            'raw_index': index,
        })
    rows.sort(key=lambda row: row['t'])
    return rows


def _dedup(rows):
    out = []
    for row in rows:
        if out and abs(out[-1]['t'] - row['t']) < 1e-6:
            out[-1]['v'] = float(np.mean([out[-1]['v'], row['v']]))
            out[-1]['raw_indexes'].append(row['raw_index'])
        else:
            item = dict(row)
            item['raw_indexes'] = [row['raw_index']]
            out.append(item)
    return out


def _daily(rows, method='median'):
    if not rows:
        return []
    groups = {}
    for row in rows:
        day = int(np.floor(row['t'] / 86400.0))
        groups.setdefault(day, []).append(row)
    out = []
    for day, values in sorted(groups.items()):
        vals = np.asarray([v['v'] for v in values], dtype=float)
        value = float(np.sum(vals)) if method == 'sum' else float(np.median(vals))
        out.append({
            't': float(day * 86400 + 43200),
            'v': value,
            'raw_indexes': [i for v in values for i in v.get('raw_indexes', [v.get('raw_index')])],
        })
    return out


def _clean(rows, metric):
    if not rows:
        return [], []
    values = np.asarray([r['v'] for r in rows], dtype=float)
    mask = np.ones(len(values), dtype=bool)
    bounds = MEDICAL_BOUNDS.get(metric)
    if bounds:
        mask &= (values >= bounds[0]) & (values <= bounds[1])
    valid = values[mask]
    if len(valid) >= 5:
        med = float(np.median(valid))
        mad = 1.4826 * float(np.median(np.abs(valid - med)))
        if mad > 1e-9:
            mask &= np.abs(values - med) <= 4.0 * mad
    return [row for i, row in enumerate(rows) if mask[i]], [i for i, keep in enumerate(mask) if not keep]


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


def _backtest(x, y):
    """Rolling-origin 1/3/7-day validation; selected model is used to forecast."""
    candidates = ['last_value', 'median', 'linear', 'huber', 'damped', 'state_space_local_linear']
    scale = float(np.median(np.abs(np.diff(y)))) if len(y) > 1 else 0.0
    if scale < 1e-6:
        scale = float(np.std(y))
    scale = max(scale, abs(float(np.median(y))) * 0.01, 1e-6)
    scores, all_residuals, all_residual_leads = {}, {}, {}
    start = max(8, int(np.ceil(len(y) * 0.45)))
    for name in candidates:
        by_horizon, residuals, residual_leads = {}, [], []
        for horizon in (1, 3, 7):
            actual, predicted = [], []
            folds = 0
            for end in range(start, len(y)):
                origin = float(x[end - 1])
                indexes = np.where((x[end:] > origin) & (x[end:] <= origin + float(horizon) + 1e-9))[0] + end
                if len(indexes) == 0:
                    continue
                try:
                    target_x = x[indexes]
                    _, pred = _fit_predict(name, x[:end], y[:end], target_x)
                    if len(pred) == len(indexes) and np.all(np.isfinite(pred)):
                        folds += 1
                        actual.extend(y[indexes].tolist())
                        predicted.extend(pred.tolist())
                        if horizon == 7:
                            residuals.extend((y[indexes] - pred).astype(float).tolist())
                            residual_leads.extend((target_x - origin).astype(float).tolist())
                except Exception:
                    continue
            if actual:
                by_horizon[str(horizon)] = _metrics(actual, predicted, scale)
                by_horizon[str(horizon)]['origin_folds'] = folds
        if by_horizon:
            primary = by_horizon.get('7') or by_horizon.get('3') or by_horizon.get('1')
            scores[name] = {
                **primary,
                'folds': sum(int(value.get('origin_folds') or 0) for value in by_horizon.values()),
                'horizons': by_horizon,
            }
            all_residuals[name] = residuals
            all_residual_leads[name] = residual_leads
    if not scores:
        return None
    selected = min(scores, key=lambda name: (scores[name]['mase'], abs(scores[name].get('bias') or 0)))
    return {
        'method': 'rolling_origin_multi_horizon',
        'selected': selected,
        'scores': scores,
        'folds': scores[selected]['folds'],
        'residuals': [round(float(value), 5) for value in all_residuals.get(selected, [])],
        'residual_lead_days': [round(float(value), 3) for value in all_residual_leads.get(selected, [])],
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


def _forecast_reason(metric, n, span, requested, policy, fluct, model, condition_coverage):
    reasons = []
    if not policy.get('forecast'):
        reasons.append('行为指标只提供滚动趋势，不做精确未来数值外推' if policy.get('behavior') else '该指标以异常检测和复测为主，不默认外推')
    if n < 7:
        reasons.append(f'有效日不足（{n}/7）')
    if span < 14:
        reasons.append(f'时间跨度不足（{span:.1f}/14天）')
    if policy.get('condition_required') and condition_coverage < 1:
        reasons.append('测量条件为 unknown，空腹/餐后数据不能混合预测')
    if policy.get('condition'):
        reasons.append(f'需要明确标记为 {policy["condition"]} 的数据')
    if model is None:
        reasons.append('滚动回测没有得到稳定模型')
    if fluct == 'high':
        reasons.append('近期波动过高，预测区间会失去管理意义')
    if policy.get('forecast') and requested >= 30 and (n < 84 or span < 90):
        reasons.append('30天周级预测需要至少84个有效日且覆盖90天')
    return '；'.join(reasons) or '当前数据暂不满足预测条件'


def analyze(metric, unit, points, forecast_days=7, condition_group=None):
    requested = int(max(7, min(30, int(forecast_days or 7))))
    policy = METRIC_POLICIES.get(metric, {})
    raw_rows = _rows(points)
    if condition_group:
        raw_rows = [row for row in raw_rows if row['condition'] == condition_group]
    deduped = _dedup(raw_rows)
    condition_coverage = sum(row['condition'] != 'unknown' for row in deduped) / max(len(deduped), 1)
    aggregate = _daily(deduped, policy.get('aggregate', 'median')) if policy.get('aggregate') else deduped
    clean_rows, removed = _clean(aggregate, metric)
    raw_count = len(raw_rows)
    if len(clean_rows) < MIN_TREND_DAYS:
        return {
            'success': True, 'status': 'insufficient_data', 'schema_version': 'curve.v2', 'metric': metric, 'unit': unit,
            'data_points': len(clean_rows), 'raw_points': raw_count,
            'removed_outliers': len(removed), 'abnormal_spike': bool(removed),
            'long_term_trend': 'stable', 'recent_trend': 'stable', 'trend_strength': 'weak',
            'eligibility': {'trend': False, 'forecast': False, 'reason': f'有效日不足（{len(clean_rows)}/7）'},
            'forecast': {'available': False, 'days': 0, 'horizon_days': 0, 'reason': f'有效日不足（{len(clean_rows)}/7）', 'curve': {'timestamps': [], 'predicted': [], 'lower': [], 'upper': []}},
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
    removed_days = {aggregate[index]['t'] for index in removed if index < len(aggregate)}
    raw_outlier_indices = [
        index for index, row in enumerate(deduped)
        if any(abs(np.floor(row['t'] / 86400.0) - np.floor(value / 86400.0)) < 1e-9 for value in removed_days)
    ]
    backtest = _backtest(x, y) if len(y) >= 8 else None
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
    available = bool(
        metric in FORECASTABLE_METRICS and horizon > 0 and selected and score and fluct != 'high' and
        (float(score.get('mase')) if score.get('mase') is not None else 99) <= 5.0 and
        float(score.get('interval_q80') or 0) <= max(abs(float(np.median(y))) * 0.20, 1.0) and
        (not policy.get('condition_required') or condition_coverage >= 1.0) and
        (not policy.get('condition') or condition_group == policy.get('condition'))
    )
    if metric in FORECASTABLE_METRICS and requested >= 30 and horizon and horizon < requested:
        reason = f'当前数据最多支持未来{horizon}天；30天需要至少84个有效日且覆盖90天'
    elif not available:
        reason = _forecast_reason(metric, len(y), span, requested, policy, fluct, selected, condition_coverage)
        if score and (float(score.get('mase') or 99) > 5.0 or float(score.get('interval_q80') or 0) > max(abs(float(np.median(y))) * 0.20, 1.0)):
            reason = f'{reason}；滚动回测误差或预测区间过宽'
    else:
        reason = None
    forecast = {
        'available': available, 'days': horizon if available else 0, 'horizon_days': horizon if available else 0,
        'granularity': 'weekly' if horizon == 30 else 'daily', 'estimated_value': None, 'model': selected,
        'reason': reason, 'note': '模型估计范围，不代表真实未来，也不是医学诊断', 'coverage_target': 0.80,
        'calibration_status': 'not_available', 'curve': {'timestamps': [], 'predicted': [], 'lower': [], 'upper': []},
    }
    if available:
        steps = np.array([7, 14, 21, 28, 30], dtype=float) if horizon == 30 else np.arange(1, horizon + 1, dtype=float)
        target_x = x[-1] + steps
        _, prediction = _fit_predict(selected, x, y, target_x)
        prediction = np.asarray(prediction, dtype=float)
        residuals = np.asarray(backtest.get('residuals') or [], dtype=float)
        if len(residuals) < 4:
            residuals = y - model_fitted
        q = float(np.quantile(np.abs(residuals), 0.80)) if len(residuals) else max(abs(float(np.median(y))) * 0.02, 0.1)
        q = max(q, abs(float(np.median(y))) * 0.01, 1e-6)
        margin = q * np.sqrt(1.0 + steps / max(len(y), 1))
        if bounds:
            prediction = np.clip(prediction, bounds[0], bounds[1])
            lower = np.clip(prediction - margin, bounds[0], bounds[1])
            upper = np.clip(prediction + margin, bounds[0], bounds[1])
        else:
            lower, upper = prediction - margin, prediction + margin
        future_ts = clean_rows[-1]['t'] + steps * 86400.0
        forecast['estimated_value'] = round(float(prediction[-1]), 2)
        forecast['calibration_status'] = 'rolling_residual_conformal'
        forecast['interval_method'] = '80_percent_conformal_residual'
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
        'latest_value': round(latest, 2), 'previous_value': round(previous, 2), 'change': round(change, 2),
        'change_percent': round(change / previous * 100, 2) if abs(previous) > 1e-9 else 0,
        'long_term_trend': long_dir, 'recent_trend': 'rising' if recent_slope > 0 else ('falling' if recent_slope < 0 else 'stable'),
        'trend_strength': strength, 'fluctuation': fluct, 'abnormal_spike': bool(raw_outlier_indices),
        'model': selected or 'robust_local_trend', 'model_score': score, 'backtest': backtest,
        'metric_policy': policy, 'measurement_condition_coverage': round(condition_coverage, 3),
        'confidence_level': confidence_level, 'baseline': baseline, 'forecast': forecast,
        'eligibility': {
            'trend': len(y) >= MIN_TREND_DAYS, 'forecast': available, 'reason': reason,
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
