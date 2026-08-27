# -*- coding: utf-8 -*-
"""Horizon-specific rolling-origin selection for personal health curves."""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np

from curve_models import MODEL_SPECS, MODELS
from curve_utils import FoldLocalPipeline

SUPPORTED_HORIZONS = (1, 3, 7, 14)
DEFAULT_CANDIDATES = tuple(MODEL_SPECS)
BASELINES = ('last_value', 'rolling_median')


def finite_sample_quantile(scores, coverage=0.80):
    """Conformal order statistic using ceil((n+1)*coverage), never interpolation.

    Returning ``q=None`` is deliberate: for too few scores the requested
    marginal coverage cannot be represented by a finite order statistic.
    """
    values = np.sort(np.abs(np.asarray(scores, dtype=float)))
    values = values[np.isfinite(values)]
    n = int(len(values))
    rank = int(np.ceil((n + 1) * float(coverage)))
    if n == 0 or rank > n:
        return {'q': None, 'n': n, 'rank': rank, 'coverage_target': coverage,
                'finite_sample_valid': False}
    return {
        'q': float(values[rank - 1]), 'n': n, 'rank': rank,
        'coverage_target': coverage, 'finite_sample_valid': True,
        'empirical_coverage': float(np.mean(values <= values[rank - 1])),
    }


def conformal_candidates(horizon_results, step, coverage=0.80, block_size=2):
    """Build leakage-safe interval candidates from completed calibration folds."""
    bucket = min(value for value in SUPPORTED_HORIZONS if value >= step)
    specific_rows = horizon_results.get(str(bucket), {}).get('calibration_fold_audit', [])
    pooled_rows = []
    for horizon_text, result in horizon_results.items():
        for row in result.get('calibration_fold_audit', []):
            pooled_rows.append({**row, 'lead_days': int(horizon_text)})

    def package(name, scores, multiplier=1.0, extra=None):
        quantile = finite_sample_quantile(scores, coverage)
        q = quantile['q'] * multiplier if quantile['q'] is not None else None
        return {'method': name, **quantile, 'q': q, 'scale_multiplier': multiplier, **(extra or {})}

    candidates = {
        'horizon_specific': package('horizon_specific', [row['error'] for row in specific_rows]),
        'pooled': package('pooled', [row['error'] for row in pooled_rows]),
        'lead_time_scaled_pooled': package(
            'lead_time_scaled_pooled',
            [float(row['error']) / np.sqrt(max(row['lead_days'], 1)) for row in pooled_rows],
            np.sqrt(max(step, 1)),
        ),
    }
    ordered = sorted(pooled_rows, key=lambda row: (row.get('target_day', ''), row.get('origin_day', ''), row['lead_days']))
    block_scores = []
    for start in range(0, len(ordered) - block_size + 1, block_size):
        block = ordered[start:start + block_size]
        block_scores.append(max(abs(float(row['error'])) for row in block))
    candidates['block_conformal'] = package(
        'block_conformal', block_scores, extra={'block_size': block_size, 'raw_residual_n': len(ordered)}
    )
    return candidates


def select_post_change_segment(clean_rows, meta, enabled=True, min_points=7):
    """Use the latest persistent shifted state when enough post-change data exist."""
    result = {'used': False, 'reason': None, 'start_date': clean_rows[0]['local_day'] if clean_rows else None}
    if not enabled or not clean_rows:
        result['reason'] = 'change-point stable-segment selection disabled' if not enabled else 'no clean observations'
        return clean_rows, result
    indexes = sorted(int(value) for value in meta.get('change_points', []) if 0 <= int(value) < len(clean_rows))
    if not indexes:
        result['reason'] = 'no persistent level change detected'
        return clean_rows, result
    # The cleaning pipeline marks a persistent run; its first index is the new-state boundary.
    start = indexes[0]
    candidate = clean_rows[start:]
    if len(candidate) < min_points:
        result['reason'] = f'post-change segment has only {len(candidate)} valid days (<{min_points})'
        return clean_rows, result
    result.update({
        'used': True,
        'reason': 'persistent level shift detected; older state excluded from model fitting',
        'start_date': candidate[0]['local_day'],
    })
    return candidate, result


def _seasonal_reliability(x, y, period=7):
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    if len(y) < 28 or x[-1] - x[0] < 27:
        return {'reliable': False, 'reason': 'requires >=28 points spanning >=28 days'}
    day_index = np.rint(x).astype(int)
    coverage = len(np.unique(day_index)) / max(day_index[-1] - day_index[0] + 1, 1)
    lookup = {int(day): float(value) for day, value in zip(day_index, y)}
    pairs = [(lookup[day], lookup[day - period]) for day in day_index if day - period in lookup]
    if coverage < 0.80 or len(pairs) < 14:
        return {'reliable': False, 'reason': 'calendar coverage or repeated weekly pairs are insufficient', 'coverage': coverage, 'pairs': len(pairs)}
    current, lagged = np.asarray([p[0] for p in pairs]), np.asarray([p[1] for p in pairs])
    seasonal_mae = float(np.mean(np.abs(current - lagged)))
    level_mae = float(np.mean(np.abs(current - np.median(y))))
    correlation = float(np.corrcoef(current, lagged)[0, 1]) if np.std(current) > 1e-9 and np.std(lagged) > 1e-9 else 0.0
    reliable = correlation >= 0.35 and seasonal_mae <= 0.90 * max(level_mae, 1e-9)
    return {
        'reliable': bool(reliable), 'coverage': round(coverage, 4), 'pairs': len(pairs),
        'lag7_correlation': round(correlation, 4), 'seasonal_mae': round(seasonal_mae, 4),
        'level_mae': round(level_mae, 4),
        'reason': None if reliable else 'weekly lag does not reliably beat a level forecast',
    }


def _seasonal_predict(x, y, target):
    days = np.rint(np.asarray(x, dtype=float)).astype(int)
    lookup = {int(day): float(value) for day, value in zip(days, y)}
    weekday = {}
    for day, value in zip(days, y):
        weekday.setdefault(int(day % 7), []).append(float(value))
    out = []
    for value in np.rint(np.asarray(target, dtype=float)).astype(int):
        out.append(lookup.get(value - 7, float(np.median(weekday.get(int(value % 7), y)))))
    return np.asarray(out, dtype=float)


def _population_predict(prior, x, y, target):
    required = {'level', 'slope', 'as_of_day', 'metric', 'unit', 'condition_group', 'version'}
    if not isinstance(prior, dict) or not required <= set(prior):
        raise ValueError('population prior must be versioned and include level/slope/as_of_day/metric/unit/condition_group')
    level, slope, as_of = float(prior['level']), float(prior['slope']), float(prior['as_of_day'])
    personal_residual = float(np.median(y - (level + slope * (np.asarray(x) - as_of))))
    shrinkage = min(1.0, len(y) / 28.0)
    correction = shrinkage * personal_residual
    return level + slope * (np.asarray(target, dtype=float) - as_of) + correction


def fit_predict(name, x, y, target, population_prior=None):
    target = np.atleast_1d(np.asarray(target, dtype=float))
    if name == 'last_value':
        return np.full(len(target), float(y[-1]))
    if name == 'rolling_median':
        return np.full(len(target), float(np.median(y[-min(14, len(y)):])))
    if name == 'seasonal_naive':
        reliability = _seasonal_reliability(x, y)
        if not reliability['reliable']:
            raise ValueError(reliability['reason'])
        return _seasonal_predict(x, y, target)
    if name == 'population_prior_residual':
        return _population_predict(population_prior, x, y, target)
    fit, predict = MODELS[name]
    return np.asarray(predict(fit(np.asarray(x), np.asarray(y)), target), dtype=float)


def _scale(y):
    scale = float(np.median(np.abs(np.diff(y)))) if len(y) > 1 else 0.0
    if scale < 1e-6:
        scale = float(np.std(y))
    return max(scale, abs(float(np.median(y))) * 0.01, 1e-6)


def _clean_fold(train_rows, metric, aggregate, anomaly_handling, change_point):
    pipeline = FoldLocalPipeline(metric, aggregate).fit(train_rows)
    clean, meta = pipeline.transform(train_rows)
    if not anomaly_handling:
        daily = pipeline._daily(train_rows)
        bounds = __import__('curve_utils').MEDICAL_BOUNDS.get(metric)
        clean = [row for row in daily if not bounds or bounds[0] <= row['v'] <= bounds[1]]
        meta = {**meta, 'spikes': [], 'removed_indices': meta.get('measurement_errors', [])}
    return (*select_post_change_segment(clean, meta, enabled=change_point), meta, pipeline)


def _candidate_metrics(records, complexity):
    errors = np.asarray([row['error'] for row in records], dtype=float)
    normalized = np.asarray([abs(row['error']) / row['scale'] for row in records], dtype=float)
    mase = float(np.mean(normalized))
    prediction_error = mase
    split = max(2, int(np.floor(len(errors) * 0.60)))
    if len(errors) - split >= 2:
        quantile = finite_sample_quantile(errors[:split], 0.80)
        q = quantile['q']
        if q is not None:
            coverage = float(np.mean(np.abs(errors[split:]) <= q))
            width_norm = float(2.0 * q / max(np.median([row['scale'] for row in records]), 1e-9))
            calibration_error = abs(coverage - 0.80) + 0.05 * width_norm
        else:
            coverage, calibration_error = None, 0.25
    else:
        coverage, calibration_error = None, 0.25
    instability = float(np.std(normalized)) + abs(float(np.mean(errors))) / max(float(np.median([row['scale'] for row in records])), 1e-9)
    final_score = prediction_error + 0.50 * calibration_error + 0.35 * instability + float(complexity)
    return {
        'n': len(records), 'origin_folds': len(records), 'mae': round(float(np.mean(np.abs(errors))), 4),
        'mase': round(mase, 4), 'bias': round(float(np.mean(errors)), 4),
        'prediction_error': round(prediction_error, 4), 'calibration_error': round(calibration_error, 4),
        'calibration_coverage': round(coverage, 4) if coverage is not None else None,
        'instability_penalty': round(instability, 4), 'complexity_penalty': round(float(complexity), 4),
        'final_score': round(final_score, 4),
    }


def rolling_origin_select(rows, metric, aggregate='median', horizons=SUPPORTED_HORIZONS,
                          candidate_names=None, anomaly_handling=True, change_point=True,
                          damping=True, refusal=True, population_prior=None):
    """Select a separate model for every horizon with a disjoint calibration tail."""
    candidates = list(candidate_names or DEFAULT_CANDIDATES)
    if not damping:
        candidates = [name for name in candidates if name != 'ets_damped_trend']
    if population_prior is None:
        candidates = [name for name in candidates if name != 'population_prior_residual']
    candidates = [name for name in candidates if name in MODEL_SPECS]
    days = sorted({row['local_day'] for row in rows})
    if len(days) < 12:
        return None
    day_to_index = {day: index for index, day in enumerate(days)}
    result = {
        'method': 'horizon_specific_nested_rolling_origin_fold_local', 'score_formula':
        'prediction_error + 0.50*calibration_error + 0.35*instability_penalty + complexity_penalty',
        'horizons': {}, 'model_specs': {name: MODEL_SPECS[name] for name in candidates},
    }
    for horizon in sorted(set(int(value) for value in horizons if int(value) in SUPPORTED_HORIZONS)):
        calibration_start = min(int(np.ceil(len(days) * 0.67)), len(days) - horizon - 4)
        calibration_start = max(calibration_start, 9 + horizon)
        calibration_start = min(calibration_start, len(days) - 2)
        calibration_day = datetime.fromisoformat(days[calibration_start])
        selection_origins = [
            i for i in range(7, calibration_start)
            if datetime.fromisoformat(days[i]) + timedelta(days=horizon) < calibration_day
            and (datetime.fromisoformat(days[i]) + timedelta(days=horizon)).date().isoformat() in day_to_index
        ]
        calibration_origins = [
            i for i in range(calibration_start, len(days) - 1)
            if (datetime.fromisoformat(days[i]) + timedelta(days=horizon)).date().isoformat() in day_to_index
        ]

        def evaluate(name, origins, audit=False):
            records, audits = [], []
            spec = MODEL_SPECS[name]
            for origin_index in origins:
                target_day = (datetime.fromisoformat(days[origin_index]) + timedelta(days=horizon)).date().isoformat()
                train_rows = [row for row in rows if row['local_day'] <= days[origin_index]]
                target_rows = [row for row in rows if row['local_day'] == target_day]
                if not target_rows:
                    continue
                clean_train, segment, meta, pipeline = _clean_fold(train_rows, metric, aggregate, anomaly_handling, change_point)
                clean_target, _ = pipeline.transform(target_rows)
                if len(clean_train) < int(spec['min_points']) or not clean_target or horizon > int(spec['max_horizon_days']):
                    continue
                x = np.asarray([(row['t'] - clean_train[0]['t']) / 86400.0 for row in clean_train])
                y = np.asarray([row['v'] for row in clean_train])
                tx = np.asarray([(clean_target[-1]['t'] - clean_train[0]['t']) / 86400.0])
                try:
                    pred = fit_predict(name, x, y, tx, population_prior)
                except (ValueError, KeyError, np.linalg.LinAlgError, FloatingPointError):
                    continue
                if len(pred) != 1 or not np.isfinite(pred[0]):
                    continue
                error = float(clean_target[-1]['v'] - pred[0])
                record = {'origin_day': days[origin_index], 'target_day': target_day, 'actual': float(clean_target[-1]['v']),
                          'predicted': float(pred[0]), 'error': error, 'scale': _scale(y)}
                records.append(record)
                if audit:
                    audits.append({**record, 'train_last_day': clean_train[-1]['local_day'],
                                   'train_clean_values': [round(float(value), 8) for value in y], 'state_segment': segment,
                                   'fit_parameters': meta.get('fit_parameters')})
            return records, audits

        scores, selection_records = {}, {}
        for name in candidates:
            records, _ = evaluate(name, selection_origins)
            if len(records) >= 3:
                scores[name] = _candidate_metrics(records, MODEL_SPECS[name]['complexity_penalty'])
                selection_records[name] = records
        baseline_names = [name for name in BASELINES if name in scores]
        best_baseline = min(baseline_names, key=lambda name: scores[name]['final_score']) if baseline_names else None
        eligible = []
        for name, score in scores.items():
            if MODEL_SPECS[name]['baseline'] or best_baseline is None:
                continue
            candidate_by_origin = {row['origin_day']: row for row in selection_records[name]}
            common_baselines = {}
            for baseline_name in baseline_names:
                baseline_map = {row['origin_day']: row for row in selection_records[baseline_name]}
                common = sorted(set(candidate_by_origin) & set(baseline_map))
                if common:
                    common_baselines[baseline_name] = (_candidate_metrics([baseline_map[origin] for origin in common], 0.0), baseline_map, common)
            if not common_baselines:
                continue
            candidate_baseline = min(common_baselines, key=lambda value: common_baselines[value][0]['final_score'])
            baseline_common_score, baseline_by_origin, shared_origins = common_baselines[candidate_baseline]
            wins = [abs(candidate_by_origin[origin]['error']) < abs(baseline_by_origin[origin]['error']) for origin in shared_origins]
            win_rate = float(np.mean(wins)) if wins else 0.0
            score['baseline'] = candidate_baseline
            score['baseline_score_on_common_origins'] = baseline_common_score
            score['baseline_improvement'] = round(1.0 - score['mase'] / max(baseline_common_score['mase'], 1e-9), 4)
            score['origin_win_rate'] = round(win_rate, 4)
            if (score['final_score'] <= baseline_common_score['final_score'] * 0.98
                    and score['mase'] <= baseline_common_score['mase'] * 0.98 and win_rate >= 0.55):
                eligible.append(name)
        selected = min(eligible, key=lambda name: scores[name]['final_score']) if eligible else None
        decision = 'forecast' if selected else 'trend_only'
        # A transparent baseline is a valid forecast for a low-instability level
        # series. Requiring a complex model to beat it made simple stable series
        # fail for the wrong reason.
        if selected is None and best_baseline and scores[best_baseline]['instability_penalty'] <= 1.5:
            selected = best_baseline
            decision = 'baseline_forecast'
        elif selected is None and not refusal and scores:
            selected = min(scores, key=lambda name: scores[name]['final_score'])
            decision = 'forced_without_refusal'
        residuals, calibration_audit, selection_audit = ([], [], [])
        if selected:
            calibration_records, calibration_audit = evaluate(selected, calibration_origins, audit=True)
            _, selection_audit = evaluate(selected, selection_origins, audit=True)
            residuals = [row['error'] for row in calibration_records]
        result['horizons'][str(horizon)] = {
            'selected': selected, 'decision': decision,
            'reason': ('stable baseline selected because no complex candidate reliably improved it'
                       if decision == 'baseline_forecast' else None if selected
                       else 'no candidate produced a stable forecast against last_value/rolling_median'),
            'model_not_beat_baseline': bool(not eligible),
            'scores': scores, 'best_baseline': best_baseline,
            'selection_origin_indices': selection_origins, 'calibration_origin_indices': calibration_origins,
            'calibration_residuals': [round(float(value), 6) for value in residuals],
            'selection_fold_audit': selection_audit, 'calibration_fold_audit': calibration_audit,
        }
    return result
