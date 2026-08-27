# -*- coding: utf-8 -*-
"""Structural tests only; this file does not create or claim real-person data."""
from datetime import datetime

import pandas as pd

from evaluate_external_longitudinal import render_markdown
from leakage_safe_split import build_manifest, validate_manifest
from participant_bootstrap import participant_bootstrap
from subgroup_fairness import subgroup_report
from validate_external_dataset import SCHEMA, parse_ts


required = {
    'participant_id', 'site_id', 'timestamp', 'metric', 'value', 'unit', 'condition',
    'posture', 'device_id', 'measurement_source', 'repeat_flag', 'medication_context',
    'missing_reason', 'quality_flag',
}
assert required <= set(SCHEMA['required_columns'])
assert {'age', 'sex', 'region', 'baseline_conditions'} <= set(SCHEMA['required_columns'])
assert parse_ts('2026-01-01T08:00:00+08:00').utcoffset() is not None
try:
    parse_ts('2026-01-01T08:00:00')
    raise AssertionError('timezone-naive timestamp should be rejected')
except ValueError:
    pass

# Identifier-only unit fixture: no health measurements and no real-data claim.
split_fixture = pd.DataFrame([
    {'participant_id': f'unit_{site}_{index}', 'site_id': site}
    for site, count in [('site_dev_a', 6), ('site_dev_b', 6), ('site_external', 4)]
    for index in range(count)
])
manifest = build_manifest(split_fixture, ['site_external'], salt='unit-test-only')
assert manifest['leakage_check_passed'] is True
assert not manifest['overlaps']
assert all(manifest['assignments'][pid] == 'external_site_test'
           for pid in split_fixture.loc[split_fixture.site_id == 'site_external', 'participant_id'])
assert validate_manifest(split_fixture, manifest)['valid'] is True

window_fixture = [
    {'participant_id': 'unit_p1', 'site_id': 's1', 'status': 'forecasted', 'n': 2,
     'sum_abs_error': 2., 'sum_sq_error': 2., 'sum_error': 0., 'scale_denominator': 2.,
     'covered_points': 2, 'interval_width_sum': 4., 'model_wins_best_baseline': True,
     'boundary_event_count': 1, 'boundary_event_detected': 1, 'last_value_mae': 2.,
     'rolling_median_mae': 2.5, 'age': 70, 'sex': 'female', 'region': 'r1',
     'device_id': 'd1', 'baseline_conditions': 'hypertension'},
    {'participant_id': 'unit_p2', 'site_id': 's2', 'status': 'refused', 'n': 0,
     'reason_code': 'NO_STABLE_MODEL', 'age': 82, 'sex': 'male', 'region': 'r2',
     'device_id': 'd2', 'baseline_conditions': 'none'},
]
bootstrap = participant_bootstrap(window_fixture, replicates=50, seed=1)
assert bootstrap['cluster_unit'] == 'participant_id' and bootstrap['participants'] == 2
assert bootstrap['metrics']['refusal_rate']['lower'] is not None
fairness = subgroup_report(window_fixture, minimum_participants=2)
assert set(fairness['dimensions']) == {'age_group', 'sex', 'region', 'device_id', 'baseline_condition'}

empty_report = {'data_class': 'real_longitudinal_candidate', 'sections': {
    name: {'status': 'not_collected'} for name in
    ('synthetic_dry_run', 'internal_validation', 'temporal_test', 'external_site_test')
}}
rendered = render_markdown(empty_report)
assert 'NA' in rendered and 'not_collected' in rendered
print('external validation pipeline structural regression: PASS')
