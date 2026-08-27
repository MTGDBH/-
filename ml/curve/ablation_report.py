# -*- coding: utf-8 -*-
"""Generate the required curve-model ablation report under strict time splits.

Without --csv this is an engineering dry-run only.  Synthetic results are
deliberately labelled and must never be cited as clinical effectiveness.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from temporal_validation import run, synthetic

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_JSON = ROOT / 'ml' / 'reports' / 'curve-ablation-latest.json'
DEFAULT_MD = ROOT / 'reports' / 'curve-ablation-latest.md'


VARIANTS = {
    'reference': ({}, 'horizon_specific_split_conformal'),
    'no_anomaly_handling': ({'anomaly_handling': False}, 'horizon_specific_split_conformal'),
    'no_change_point': ({'change_point': False}, 'horizon_specific_split_conformal'),
    'no_damping': ({'damping': False}, 'horizon_specific_split_conformal'),
    'no_refusal': ({'refusal': False}, 'horizon_specific_split_conformal'),
    'interval_gaussian_residual': ({}, 'gaussian_residual'),
    'interval_pooled_conformal': ({}, 'pooled_split_conformal'),
    'candidates_baselines_ets': ({'candidate_names': ['last_value', 'rolling_median', 'ets_damped_trend']}, 'horizon_specific_split_conformal'),
    'candidates_baselines_kalman': ({'candidate_names': ['last_value', 'rolling_median', 'kalman_local_level', 'kalman_local_linear']}, 'horizon_specific_split_conformal'),
    'candidates_baselines_quantile': ({'candidate_names': ['last_value', 'rolling_median', 'robust_quantile_trend']}, 'horizon_specific_split_conformal'),
    'candidates_baselines_only': ({'candidate_names': ['last_value', 'rolling_median']}, 'horizon_specific_split_conformal'),
}


def participant_split(df):
    ids = sorted(str(value) for value in df['participant_id'].dropna().unique())
    if len(ids) < 2:
        return [], ids
    cut = max(1, min(len(ids) - 1, int(np.floor(len(ids) * 0.34))))
    return ids[:cut], ids[cut:]


def _mean_metric(results, key, field):
    weighted = [(row[key].get(field), row[key].get('n', 0)) for row in results if row.get(key, {}).get(field) is not None]
    total = sum(weight for _, weight in weighted)
    return float(sum(value * weight for value, weight in weighted) / total) if total else None


def terminal_evaluation(df, horizon, options, interval_method, test_ids):
    results = []
    for participant_id in test_ids:
        participant = df[df['participant_id'].astype(str) == participant_id]
        participant = participant.copy()
        participant['_condition_group'] = participant['condition'].fillna('unknown').astype(str) if 'condition' in participant else 'unknown'
        for (_, _), group in participant.groupby(['metric', '_condition_group']):
            if len(group) < 28 + horizon:
                continue
            # One terminal origin per elder prevents overlapping windows from dominating.
            result = run(group, min_history=len(group) - horizon, horizon=horizon,
                         selection_options=options, interval_method=interval_method)
            results.append(result)
    attempts = sum(row['attempts'] for row in results)
    forecasted = sum(row['forecasted_windows'] for row in results)
    refused = sum(row['refused_windows'] for row in results)
    return {
        'attempts': attempts, 'forecasted_windows': forecasted, 'refused_windows': refused,
        'refusal_rate': refused / attempts if attempts else None,
        'curve': {field: _mean_metric(results, 'curve_v2', field) for field in ('mae', 'rmse', 'mase', 'coverage_80', 'interval_width')},
        'last_value': {field: _mean_metric(results, 'last_value_baseline', field) for field in ('mae', 'rmse', 'mase')},
        'rolling_median': {field: _mean_metric(results, 'rolling_median_baseline', field) for field in ('mae', 'rmse', 'mase')},
    }


def generate(df, data_class, source):
    development_ids, test_ids = participant_split(df)
    variants = {}
    for name, (options, interval_method) in VARIANTS.items():
        variants[name] = {
            str(horizon): terminal_evaluation(df, horizon, options, interval_method, test_ids)
            for horizon in (1, 3, 7, 14)
        }
    return {
        'schema_version': 'curve-ablation.v1', 'data_class': data_class, 'source': source,
        'split': {'method': 'participant-disjoint deterministic holdout', 'development_participants': development_ids,
                  'test_participants': test_ids, 'overlap': sorted(set(development_ids) & set(test_ids))},
        'evaluation': 'strict terminal rolling-origin; one non-overlapping terminal window per elder and horizon',
        'score_formula': 'prediction_error + 0.50*calibration_error + 0.35*instability_penalty + complexity_penalty',
        'variants': variants,
        'clinical_claim_allowed': False,
        'limitations': [
            'Synthetic dry-runs verify code paths only and cannot establish clinical effectiveness.' if data_class.startswith('test_') else 'External candidate results require provenance review and independent clinical interpretation.',
            'Refused windows are reported separately and are not removed from the refusal denominator.',
            'Model fitting and preprocessing use only observations available before each origin.',
        ],
    }


def markdown(report):
    lines = [
        '# 个体健康曲线消融报告', '', f"数据类别：`{report['data_class']}`", '',
        '> 本报告不构成临床有效性证据。合成数据仅用于工程干跑。', '',
        f"独立老人切分：development={report['split']['development_participants']}；test={report['split']['test_participants']}；overlap={report['split']['overlap']}", '',
        '| 变体 | horizon | MAE | 80%覆盖率 | 平均区间宽度 | 拒绝率 | last_value MAE | rolling_median MAE |',
        '|---|---:|---:|---:|---:|---:|---:|---:|',
    ]
    for name, horizons in report['variants'].items():
        for horizon, row in horizons.items():
            fmt = lambda value: 'NA' if value is None else f'{value:.4f}'
            lines.append(f"| {name} | {horizon} | {fmt(row['curve']['mae'])} | {fmt(row['curve']['coverage_80'])} | {fmt(row['curve']['interval_width'])} | {fmt(row['refusal_rate'])} | {fmt(row['last_value']['mae'])} | {fmt(row['rolling_median']['mae'])} |")
    lines += ['', '评分公式：`prediction_error + 0.50×calibration_error + 0.35×instability_penalty + complexity_penalty`。', '',
              '验收时必须换入有来源的真实纵向数据，并保持老人独立、严格时间外推和双基线对照。']
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv')
    parser.add_argument('--out-json', default=str(DEFAULT_JSON))
    parser.add_argument('--out-md', default=str(DEFAULT_MD))
    args = parser.parse_args()
    if args.csv:
        df = pd.read_csv(args.csv)
        required = {'participant_id', 'timestamp', 'metric', 'value'}
        missing = sorted(required - set(df.columns))
        if missing:
            raise SystemExit(f'missing required columns: {missing}')
        data_class, source = 'research_external_candidate', str(Path(args.csv).resolve())
    else:
        df, data_class, source = synthetic(), 'test_synthetic_dry_run', 'generated:curve-temporal-validation.synthetic.v1'
    report = generate(df, data_class, source)
    out_json, out_md = Path(args.out_json), Path(args.out_md)
    out_json.parent.mkdir(parents=True, exist_ok=True); out_md.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    out_md.write_text(markdown(report), encoding='utf-8')
    print(json.dumps({'data_class': data_class, 'json': str(out_json), 'markdown': str(out_md)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
