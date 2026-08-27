# -*- coding: utf-8 -*-
"""Real-data longitudinal evaluation with participant and site isolation.

This script never fabricates records.  It requires a validated CSV and a
pre-registered split manifest produced by leakage_safe_split.py.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from curve_utils import canonical_measurement_group, local_day
from health_curve import analyze
from freeze_external_split import validate_freeze
from leakage_safe_split import validate_manifest
from participant_bootstrap import aggregate_contributions, participant_bootstrap
from subgroup_fairness import macro_summary, subgroup_report
from validate_external_dataset import SCHEMA, validate
from validate_external_preregistration import validate_preregistration

ROOT = Path(__file__).resolve().parents[2]
SECTION_MAP = {'validation': 'internal_validation', 'temporal_test': 'temporal_test',
               'external_site_test': 'external_site_test'}


def _points(frame):
    points = []
    for _, row in frame.iterrows():
        points.append({
            't': str(row['timestamp']), 'v': float(row['value']), 'id': int(row['_row_id']),
            'condition': str(row['condition']), 'posture': str(row['posture']),
            'device_source': str(row['device_id']), 'source': str(row['measurement_source']),
            'repeat_status': str(row['repeat_flag']),
        })
    return points


def _condition_group(row):
    payload = row.to_dict()
    payload['device_source'] = payload.get('device_id')
    payload['repeat_status'] = payload.get('repeat_flag')
    return canonical_measurement_group(str(row['metric']), payload)


def _window_metrics(actual, predicted, lower, upper, history, boundary):
    actual, predicted = np.asarray(actual), np.asarray(predicted)
    lower, upper = np.asarray(lower), np.asarray(upper)
    errors = actual - predicted
    history = np.asarray(history, dtype=float)
    scale = float(np.mean(np.abs(np.diff(history)))) if len(history) > 1 else 0.0
    scale = max(scale, abs(float(np.median(history))) * 0.01, 1e-6)
    event_count = detected = 0
    if boundary:
        low, high = map(float, boundary)
        low_events, high_events = actual < low, actual > high
        event_count = int(np.sum(low_events | high_events))
        detected = int(np.sum(low_events & (lower <= low)) + np.sum(high_events & (upper >= high)))
    return {
        'n': len(actual), 'sum_abs_error': float(np.sum(np.abs(errors))),
        'sum_sq_error': float(np.sum(errors ** 2)), 'sum_error': float(np.sum(errors)),
        'scale_denominator': float(scale * len(actual)),
        'covered_points': int(np.sum((actual >= lower) & (actual <= upper))),
        'interval_width_sum': float(np.sum(upper - lower)),
        'boundary_event_count': event_count, 'boundary_event_detected': detected,
    }


def _metadata(frame):
    first = frame.iloc[0]
    return {field: first[field] for field in ('participant_id', 'site_id', 'age', 'sex', 'region',
                                               'baseline_conditions', 'device_id', 'measurement_source',
                                               'medication_context')}


def evaluate_series(frame, horizon, min_history=28):
    frame = frame.sort_values('timestamp_parsed').reset_index(drop=True)
    days = sorted(frame['local_day'].unique())
    rows = []
    if len(days) < min_history + 1:
        return rows
    origins = list(range(min_history - 1, len(days) - 1, max(1, horizon)))
    metric, unit = str(frame.iloc[0]['metric']), str(frame.iloc[0]['unit'])
    condition_group = str(frame.iloc[0]['measurement_group'])
    boundary = SCHEMA['metrics'][metric].get('boundary_event')
    for origin_index in origins:
        origin_day = str(days[origin_index])
        origin_date = datetime.fromisoformat(origin_day)
        window_end = (origin_date + timedelta(days=horizon)).date().isoformat()
        history = frame[frame['local_day'] <= origin_day]
        future = frame[(frame['local_day'] > origin_day) & (frame['local_day'] <= window_end)]
        meta = _metadata(frame)
        base = {**meta, 'metric': metric, 'unit': unit, 'measurement_group': condition_group,
                'condition': str(frame.iloc[0]['condition']),
                'horizon': horizon, 'origin_day': origin_day, 'window_end_day': window_end,
                'history_last_day': str(history['local_day'].max()),
                'preprocessing_fit_end': origin_day, 'future_rows_available': int(len(future))}
        eligible_history = history[history['value'].notna() & ~history['quality_flag'].isin(['excluded', 'missing'])]
        result = analyze(metric, unit, _points(eligible_history), forecast_days=horizon, condition_group=condition_group)
        forecast = result.get('forecast', {})
        if not forecast.get('available'):
            rows.append({**base, 'status': 'refused', 'reason_code': forecast.get('reason_code') or 'UNSPECIFIED_REFUSAL',
                         'reason': forecast.get('reason') or 'unspecified refusal', 'n': 0})
            continue
        predicted_by_day = {
            pd.to_datetime(float(ts), unit='s', utc=True).strftime('%Y-%m-%d'): (float(pred), float(lo), float(hi))
            for ts, pred, lo, hi in zip(forecast['curve']['timestamps'], forecast['curve']['predicted'],
                                        forecast['curve']['lower'], forecast['curve']['upper'], strict=True)
        }
        observed_future = future[future['value'].notna() & ~future['quality_flag'].isin(['excluded', 'missing'])]
        daily_truth = observed_future.groupby('local_day')['value'].median().to_dict()
        aligned_days = sorted(set(predicted_by_day) & set(daily_truth))
        if not aligned_days:
            rows.append({**base, 'status': 'forecasted_unscorable', 'reason_code': 'NO_OBSERVED_TARGET',
                         'reason': 'model forecasted but the target window has no eligible observed value', 'n': 0,
                         'model': forecast.get('model')})
            continue
        actual = [float(daily_truth[day]) for day in aligned_days]
        predicted = [predicted_by_day[day][0] for day in aligned_days]
        lower = [predicted_by_day[day][1] for day in aligned_days]
        upper = [predicted_by_day[day][2] for day in aligned_days]
        history_values = eligible_history['value'].astype(float).to_numpy()
        metrics = _window_metrics(actual, predicted, lower, upper, history_values, boundary)
        last_value = np.full(len(actual), history_values[-1])
        rolling_median = np.full(len(actual), np.median(history_values[-min(14, len(history_values)):]))
        model_mae = metrics['sum_abs_error'] / len(actual)
        last_mae = float(np.mean(np.abs(np.asarray(actual) - last_value)))
        median_mae = float(np.mean(np.abs(np.asarray(actual) - rolling_median)))
        rows.append({
            **base, **metrics, 'status': 'forecasted', 'reason_code': None, 'reason': None,
            'model': forecast.get('model'), 'aligned_days': aligned_days,
            'last_value_mae': last_mae, 'rolling_median_mae': median_mae,
            'model_wins_best_baseline': bool(model_mae < min(last_mae, median_mae)),
            'device_id': str(frame.iloc[0]['device_id']),
        })
    return rows


def evaluate_split(df, split_name, horizons, bootstrap_replicates, subgroup_minimum):
    subset = df[df['split'] == split_name]
    window_rows = []
    group_columns = ['participant_id', 'metric', 'measurement_group', 'device_id', 'posture',
                     'repeat_flag', 'medication_context', 'unit']
    for _, group in subset.groupby(group_columns, sort=True):
        for horizon in horizons:
            window_rows.extend(evaluate_series(group, horizon))
    refusal_counts = Counter(row.get('reason_code') for row in window_rows if row['status'] == 'refused')
    attempts = len(window_rows)
    by_site = {site: aggregate_contributions([row for row in window_rows if str(row['site_id']) == str(site)])
               for site in sorted({str(row['site_id']) for row in window_rows})}
    by_metric_horizon = {}
    for metric in sorted({row['metric'] for row in window_rows}):
        by_metric_horizon[metric] = {}
        for horizon in horizons:
            cells = [row for row in window_rows if row['metric'] == metric and row['horizon'] == horizon]
            by_metric_horizon[metric][str(horizon)] = {
                **aggregate_contributions(cells),
                'participants': len({str(row['participant_id']) for row in cells}),
                'participant_bootstrap_ci': participant_bootstrap(cells, bootstrap_replicates),
            }
    return {
        'split': split_name, 'participants': int(subset['participant_id'].nunique()),
        'sites': sorted(map(str, subset['site_id'].unique())),
        'micro': aggregate_contributions(window_rows),
        'participant_macro': macro_summary(window_rows, 'participant_id'),
        'site_macro': macro_summary(window_rows, 'site_id'), 'by_site': by_site,
        'by_metric_horizon': by_metric_horizon,
        'predictability': {
            'attempted_windows': attempts,
            'forecasted_windows': sum(row['status'] == 'forecasted' for row in window_rows),
            'forecasted_unscorable_windows': sum(row['status'] == 'forecasted_unscorable' for row in window_rows),
            'refused_windows': sum(row['status'] == 'refused' for row in window_rows),
            'refusal_reason_distribution': {key: {'count': value, 'fraction_of_attempts': value / attempts if attempts else None}
                                            for key, value in sorted(refusal_counts.items())},
        },
        'participant_bootstrap_ci': participant_bootstrap(window_rows, bootstrap_replicates),
        'subgroup_fairness': subgroup_report(window_rows, subgroup_minimum),
        'windows': window_rows,
    }


def _categorical_tv(reference, target, field):
    ref = reference[field].fillna('<missing>').astype(str).value_counts(normalize=True)
    tgt = target[field].fillna('<missing>').astype(str).value_counts(normalize=True)
    levels = set(ref.index) | set(tgt.index)
    return float(0.5 * sum(abs(float(ref.get(level, 0)) - float(tgt.get(level, 0))) for level in levels))


def drift_report(reference, target):
    numeric = {}
    observed_ref, observed_target = reference[reference['value'].notna()], target[target['value'].notna()]
    for metric in sorted(set(observed_ref['metric']) | set(observed_target['metric'])):
        left = observed_ref[observed_ref['metric'] == metric]['value'].astype(float).to_numpy()
        right = observed_target[observed_target['metric'] == metric]['value'].astype(float).to_numpy()
        if len(left) and len(right):
            iqr = max(float(np.quantile(left, .75) - np.quantile(left, .25)), 1e-9)
            numeric[metric] = {'reference_n': len(left), 'target_n': len(right),
                               'median_shift_in_reference_iqr': float((np.median(right) - np.median(left)) / iqr),
                               'reference_missing_rate': float(1 - len(left) / max(sum(reference['metric'] == metric), 1)),
                               'target_missing_rate': float(1 - len(right) / max(sum(target['metric'] == metric), 1))}
        else:
            numeric[metric] = {'reference_n': len(left), 'target_n': len(right), 'status': 'not_comparable'}
    reference_profiles = reference.drop_duplicates('participant_id')
    target_profiles = target.drop_duplicates('participant_id')
    reference_age = reference_profiles['age'].dropna().astype(float).to_numpy()
    target_age = target_profiles['age'].dropna().astype(float).to_numpy()
    if len(reference_age) and len(target_age):
        age_iqr = max(float(np.quantile(reference_age, .75) - np.quantile(reference_age, .25)), 1e-9)
        numeric['participant_age'] = {'reference_n': len(reference_age), 'target_n': len(target_age),
                                      'median_shift_in_reference_iqr': float((np.median(target_age) - np.median(reference_age)) / age_iqr)}
    categorical_fields = ('condition', 'posture', 'device_id', 'measurement_source', 'repeat_flag',
                          'medication_context', 'sex', 'region', 'baseline_conditions')
    categorical = {}
    for field in categorical_fields:
        participant_level = field in {'sex', 'region', 'baseline_conditions'}
        left_frame, right_frame = (reference_profiles, target_profiles) if participant_level else (reference, target)
        categorical[field] = {'total_variation_distance': _categorical_tv(left_frame, right_frame, field),
                              'unit': 'participant' if participant_level else 'record'}
    reference_devices = set(reference['device_id'].astype(str))
    target_devices = target['device_id'].astype(str)
    unseen_rate = float(np.mean(~target_devices.isin(reference_devices))) if len(target_devices) else None
    condition_check = {
        field: {'missing_rate': float(np.mean(target[field].fillna('').astype(str).str.strip() == '')) if len(target) else None}
        for field in ('condition', 'posture', 'device_id', 'medication_context')
    }
    alerts = []
    for metric, row in numeric.items():
        shift = row.get('median_shift_in_reference_iqr')
        if shift is not None and abs(shift) > 0.5:
            alerts.append({'check': 'numeric_drift', 'field': metric, 'severity': 'review', 'value': shift, 'threshold': 0.5})
    for field, row in categorical.items():
        if row['total_variation_distance'] > 0.20:
            alerts.append({'check': 'categorical_drift', 'field': field, 'severity': 'review',
                           'value': row['total_variation_distance'], 'threshold': 0.20})
    if unseen_rate is not None and unseen_rate > 0.10:
        alerts.append({'check': 'unseen_device', 'field': 'device_id', 'severity': 'review', 'value': unseen_rate, 'threshold': 0.10})
    if condition_check['condition']['missing_rate'] is not None and condition_check['condition']['missing_rate'] > SCHEMA['quality_gates']['maximum_condition_missing_rate']:
        alerts.append({'check': 'measurement_condition_missing', 'field': 'condition', 'severity': 'fail',
                       'value': condition_check['condition']['missing_rate'],
                       'threshold': SCHEMA['quality_gates']['maximum_condition_missing_rate']})
    return {
        'numeric_by_metric': numeric, 'categorical': categorical,
        'device_check': {'reference_devices': sorted(reference_devices), 'target_devices': sorted(set(target_devices)),
                         'unseen_device_row_rate': unseen_rate},
        'measurement_condition_check': condition_check,
        'thresholds': {'numeric_median_shift_iqr': 0.5, 'categorical_total_variation': 0.20,
                       'unseen_device_row_rate': 0.10, 'condition_missing_rate': SCHEMA['quality_gates']['maximum_condition_missing_rate']},
        'alerts': alerts, 'status': 'review_required' if alerts else 'no_threshold_exceeded',
    }


def primary_advantage_analysis(section, preregistration, bootstrap_replicates):
    primary = preregistration['primary_analysis']
    rows = [row for row in section.get('windows', [])
            if row.get('metric') == primary['metric']
            and int(row.get('horizon') or -1) == int(primary['horizon_days'])
            and row.get('condition') == primary['measurement_condition']]
    micro = aggregate_contributions(rows)
    participant_macro = macro_summary(rows, 'participant_id')
    bootstrap = participant_bootstrap(rows, bootstrap_replicates)
    delta_fields = ('mae_delta_vs_last_value', 'mae_delta_vs_rolling_median')
    ci_pass = all(bootstrap['metrics'][field].get('upper') is not None
                  and bootstrap['metrics'][field]['upper'] < 0 for field in delta_fields)
    macro_pass = all(participant_macro.get(field) is not None
                     and participant_macro[field] < 0 for field in delta_fields)
    proven = bool(rows) and ci_pass and macro_pass
    return {
        'definition': primary,
        'eligible_windows': len(rows),
        'participants': len({str(row['participant_id']) for row in rows}),
        'micro': micro,
        'participant_macro': participant_macro,
        'participant_bootstrap_ci': bootstrap,
        'coverage_target': preregistration['intervals']['coverage_target'],
        'coverage_target_met': micro.get('coverage') is not None
                               and micro['coverage'] >= preregistration['intervals']['coverage_target'],
        'superiority_checks': {
            'both_participant_bootstrap_delta_ci_upper_below_zero': ci_pass,
            'both_participant_macro_mae_deltas_below_zero': macro_pass,
        },
        'conclusion': '达到预注册的工程优势判据（仍非临床有效性证明）' if proven else '未证明优势',
    }


def _fmt(value):
    return 'NA' if value is None else f'{value:.4f}'


def render_markdown(report):
    primary = report.get('primary_analysis', {})
    primary_conclusion = primary.get('conclusion', '未证明优势')
    lines = ['# 真实老人纵向曲线外部验证结果', '',
             f"数据类别：`{report['data_class']}`", '',
             f"主要结论：**{primary_conclusion}**。", '',
             '> 本报告只呈现实际输入数据产生的结果；NA 表示尚无可评估数据或事件，不进行填充。', '']
    if primary.get('micro'):
        metric = primary['micro']
        ci_metrics = primary['participant_bootstrap_ci']['metrics']
        last_ci = ci_metrics['mae_delta_vs_last_value']
        median_ci = ci_metrics['mae_delta_vs_rolling_median']
        lines += ['## 预注册主要分析', '',
                  '| 参与者 | 窗口 | MAE | Last-value MAE | ΔMAE vs last (95% CI) | Rolling-median MAE | ΔMAE vs median (95% CI) | Coverage/target |',
                  '|---:|---:|---:|---:|---|---:|---|---|',
                  f"| {primary['participants']} | {primary['eligible_windows']} | {_fmt(metric['mae'])} | {_fmt(metric['last_value_mae'])} | "
                  f"{_fmt(metric['mae_delta_vs_last_value'])} ({_fmt(last_ci['lower'])}, {_fmt(last_ci['upper'])}) | "
                  f"{_fmt(metric['rolling_median_mae'])} | {_fmt(metric['mae_delta_vs_rolling_median'])} "
                  f"({_fmt(median_ci['lower'])}, {_fmt(median_ci['upper'])}) | {_fmt(metric['coverage'])}/{_fmt(primary['coverage_target'])} |", '']
    lines += [
             '| 评测层级 | 状态 | 参与者 | MAE | RMSE | MASE | Coverage | Interval width | Bias | Refusal rate | Baseline win rate | Last-value MAE | Rolling-median MAE | Boundary sensitivity |',
             '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for section_name in ('synthetic_dry_run', 'internal_validation', 'temporal_test', 'external_site_test'):
        section = report['sections'][section_name]
        if section.get('status') != 'completed':
            lines.append(f"| {section_name} | {section.get('status')} | 0 | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA | NA |")
            continue
        metric = section['micro']
        lines.append(f"| {section_name} | completed | {section['participants']} | {_fmt(metric['mae'])} | {_fmt(metric['rmse'])} | {_fmt(metric['mase'])} | {_fmt(metric['coverage'])} | {_fmt(metric['interval_width'])} | {_fmt(metric['bias'])} | {_fmt(metric['refusal_rate'])} | {_fmt(metric['baseline_win_rate'])} | {_fmt(metric['last_value_mae'])} | {_fmt(metric['rolling_median_mae'])} | {_fmt(metric['boundary_event_sensitivity'])} |")
    lines += ['', '## Micro / participant macro / site macro', '',
              '| 真实评测层级 | 聚合方式 | clusters | MAE | RMSE | MASE | coverage | width | bias | refusal | baseline win | boundary sensitivity |',
              '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for section_name in ('internal_validation', 'temporal_test', 'external_site_test'):
        section = report['sections'][section_name]
        if section.get('status') != 'completed':
            continue
        for label, key in [('micro', 'micro'), ('participant macro', 'participant_macro'), ('site macro', 'site_macro')]:
            metric = section[key]
            clusters = section['participants'] if key == 'micro' else metric.get('clusters')
            lines.append(f"| {section_name} | {label} | {clusters} | {_fmt(metric['mae'])} | {_fmt(metric['rmse'])} | {_fmt(metric['mase'])} | {_fmt(metric['coverage'])} | {_fmt(metric['interval_width'])} | {_fmt(metric['bias'])} | {_fmt(metric['refusal_rate'])} | {_fmt(metric['baseline_win_rate'])} | {_fmt(metric['boundary_event_sensitivity'])} |")
    lines += ['', '## 指标 × horizon（论文主结果表）', '',
              '| 评测层级 | metric | horizon | participants | attempted | forecasted | refused | MAE (95% participant-bootstrap CI) | RMSE | MASE | coverage | width | bias | refusal | baseline win | boundary sensitivity |',
              '|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for section_name in ('internal_validation', 'temporal_test', 'external_site_test'):
        section = report['sections'][section_name]
        if section.get('status') != 'completed':
            continue
        for metric_name, horizons in section['by_metric_horizon'].items():
            for horizon, cell in horizons.items():
                ci = cell['participant_bootstrap_ci']['metrics']['mae']
                mae_ci = f"{_fmt(cell['mae'])} ({_fmt(ci['lower'])}, {_fmt(ci['upper'])})"
                lines.append(f"| {section_name} | {metric_name} | {horizon} | {cell['participants']} | {cell['attempts']} | {cell['forecasted_windows']} | {cell['refused_windows']} | {mae_ci} | {_fmt(cell['rmse'])} | {_fmt(cell['mase'])} | {_fmt(cell['coverage'])} | {_fmt(cell['interval_width'])} | {_fmt(cell['bias'])} | {_fmt(cell['refusal_rate'])} | {_fmt(cell['baseline_win_rate'])} | {_fmt(cell['boundary_event_sensitivity'])} |")
    lines += ['', '## 拒绝原因', '']
    for name, section in report['sections'].items():
        if section.get('status') == 'completed':
            lines.append(f"- `{name}`: `{json.dumps(section['predictability']['refusal_reason_distribution'], ensure_ascii=False)}`")
    lines += ['', '## 解释限制', '', '- bootstrap 以 participant_id 为重采样单位，不以记录为独立样本。',
              '- 亚组样本量不足时标记 insufficient_n；不据此宣称临床公平性。',
              '- synthetic dry-run 与真实评测严格分栏；本脚本不会生成 synthetic 数据。']
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('csv', type=Path)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--preregistration', type=Path, required=True)
    parser.add_argument('--freeze-record', type=Path, required=True)
    parser.add_argument('--out-json', type=Path, required=True)
    parser.add_argument('--out-md', type=Path, required=True)
    parser.add_argument('--horizons', default='1,3,7,14')
    parser.add_argument('--bootstrap-replicates', type=int, default=2000)
    parser.add_argument('--subgroup-minimum', type=int, default=10)
    args = parser.parse_args()
    quality = validate(args.csv)
    if not quality['valid']:
        raise SystemExit(f'dataset validation failed: {quality["errors"][:20]}')
    pilot_gate_failures = []
    gates = SCHEMA['quality_gates']
    if quality['participants'] < gates['engineering_pilot_participants']:
        pilot_gate_failures.append(f'participants={quality["participants"]} < {gates["engineering_pilot_participants"]}')
    if quality['sites'] < gates['minimum_sites_for_external_holdout']:
        pilot_gate_failures.append(f'sites={quality["sites"]} < {gates["minimum_sites_for_external_holdout"]}')
    if quality['span_days'] < gates['minimum_span_days']:
        pilot_gate_failures.append(f'span_days={quality["span_days"]} < {gates["minimum_span_days"]}')
    if pilot_gate_failures:
        raise SystemExit(f'engineering pilot gates failed: {pilot_gate_failures}')
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    preregistration_bytes = args.preregistration.read_bytes()
    preregistration = json.loads(preregistration_bytes)
    preregistration_check = validate_preregistration(preregistration, require_frozen=True)
    if not preregistration_check['valid']:
        raise SystemExit(f'preregistration is not frozen: {preregistration_check["errors"]}')
    freeze_check = validate_freeze(args.freeze_record, args.manifest, args.preregistration, args.csv)
    if not freeze_check['valid']:
        raise SystemExit(f'freeze record validation failed: {freeze_check}')
    actual_sha256 = hashlib.sha256(args.csv.read_bytes()).hexdigest()
    if manifest.get('dataset_sha256') != actual_sha256:
        raise SystemExit('split manifest dataset_sha256 does not match the evaluation CSV')
    if manifest.get('dataset_schema_version') != SCHEMA['schema_version']:
        raise SystemExit('split manifest schema version does not match the current validator')
    if manifest.get('preregistration_sha256') != hashlib.sha256(preregistration_bytes).hexdigest():
        raise SystemExit('split manifest preregistration hash does not match the frozen preregistration')
    external_sample_gate = manifest.get('external_sample_size_gate') or {}
    if not external_sample_gate:
        raise SystemExit('split manifest is missing external_sample_size_gate')
    failed_external_sites = sorted(site for site, passed in external_sample_gate.items() if not passed)
    if failed_external_sites:
        raise SystemExit(f'external-site participant minimum failed: {failed_external_sites}')
    df = pd.read_csv(args.csv, dtype={'participant_id': str, 'site_id': str, 'device_id': str})
    manifest_check = validate_manifest(df, manifest)
    if not manifest_check['valid'] or not manifest.get('leakage_check_passed'):
        raise SystemExit(f'split manifest leakage check failed: {manifest_check}')
    df['_row_id'] = np.arange(len(df)); df['timestamp_parsed'] = pd.to_datetime(df['timestamp'], utc=True)
    df['local_day'] = [local_day(value) for value in df['timestamp']]
    df['measurement_group'] = df.apply(_condition_group, axis=1)
    df['split'] = df['participant_id'].map(manifest['assignments'])
    horizons = tuple(int(value) for value in args.horizons.split(',') if int(value) in {1, 3, 7, 14})
    sections = {'synthetic_dry_run': {'status': 'not_run_real_pipeline', 'data_class': 'synthetic_dry_run'}}
    for split_name, section_name in SECTION_MAP.items():
        if not np.any(df['split'] == split_name):
            sections[section_name] = {'status': 'not_collected', 'data_class': section_name}
        else:
            sections[section_name] = {'status': 'completed', 'data_class': section_name,
                                      **evaluate_split(df, split_name, horizons, args.bootstrap_replicates, args.subgroup_minimum)}
    train = df[df['split'] == 'train']
    drift = {section_name: drift_report(train, df[df['split'] == split_name])
             for split_name, section_name in SECTION_MAP.items() if np.any(df['split'] == split_name)}
    all_windows = [row for section in sections.values() if section.get('status') == 'completed' for row in section['windows']]
    leakage_violations = [row for row in all_windows if row['preprocessing_fit_end'] > row['origin_day'] or row['history_last_day'] > row['origin_day']]
    if leakage_violations:
        raise RuntimeError(f'future leakage audit failed: {leakage_violations[:3]}')
    external_section = sections['external_site_test']
    primary_analysis = (primary_advantage_analysis(external_section, preregistration, args.bootstrap_replicates)
                        if external_section.get('status') == 'completed'
                        else {'definition': preregistration['primary_analysis'], 'eligible_windows': 0,
                              'participants': 0, 'conclusion': '未证明优势',
                              'reason': 'external_site_test is not collected or not scorable'})
    report = {
        'schema_version': 'curve-real-longitudinal-evaluation.v1', 'data_class': 'real_longitudinal_candidate',
        'source': str(args.csv.resolve()), 'manifest': str(args.manifest.resolve()),
        'dataset_quality': quality, 'split_validation': manifest_check,
        'preregistration_validation': preregistration_check, 'freeze_validation': freeze_check,
        'leakage_audit': {'passed': True, 'unit': 'participant_id', 'fold_preprocessing': 'origin-and-earlier only',
                          'violations': 0, 'external_sites': manifest['external_sites']},
        'sections': sections, 'drift_checks': drift, 'primary_analysis': primary_analysis,
        'clinical_effectiveness_claim': 'not established; requires protocol review and adequate real external-site sample size',
    }
    args.out_json.parent.mkdir(parents=True, exist_ok=True); args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    args.out_md.write_text(render_markdown(report), encoding='utf-8')
    print(json.dumps({'json': str(args.out_json.resolve()), 'markdown': str(args.out_md.resolve()),
                      'leakage_audit': report['leakage_audit']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
