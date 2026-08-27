# -*- coding: utf-8 -*-
"""Structural tests only; this file does not create or claim real-person data."""
import json
import hashlib
import tempfile
from datetime import datetime
from pathlib import Path

import pandas as pd

from evaluate_external_longitudinal import render_markdown
from freeze_external_split import freeze, validate_freeze
from leakage_safe_split import build_manifest, validate_manifest
from participant_bootstrap import participant_bootstrap
from render_external_quality_dashboard import render as render_quality_dashboard
from subgroup_fairness import subgroup_report
from validate_external_dataset import SCHEMA, parse_ts, validate
from validate_external_preregistration import validate_preregistration


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
assert bootstrap['metrics']['mae_delta_vs_last_value']['upper'] is not None
fairness = subgroup_report(window_fixture, minimum_participants=2)
assert set(fairness['dimensions']) == {'age_group', 'sex', 'region', 'device_id', 'baseline_condition'}

empty_report = {'data_class': 'real_longitudinal_candidate', 'sections': {
    name: {'status': 'not_collected'} for name in
    ('synthetic_dry_run', 'internal_validation', 'temporal_test', 'external_site_test')
}}
rendered = render_markdown(empty_report)
assert 'NA' in rendered and 'not_collected' in rendered and '未证明优势' in rendered
empty_quality = validate(Path(__file__).resolve().parent / 'external_dataset_template.csv')
assert empty_quality['quality_dashboard']['status'] == 'not_collected'
assert '单位异常' in render_quality_dashboard(empty_quality)
prereg = json.loads((Path(__file__).resolve().parent / 'external_validation_preregistration.template.json').read_text(encoding='utf-8'))
assert validate_preregistration(prereg)['valid'] is True
assert validate_preregistration(prereg, require_frozen=True)['valid'] is False
frozen_prereg = json.loads(json.dumps(prereg))
frozen_prereg.update({'status': 'registered_frozen', 'registered_at': '2026-08-27T00:00:00Z',
                      'registered_by': 'unit-test-role', 'registry_or_archive_uri': 'urn:unit-test-only',
                      'external_results_unseen_at_freeze': True})
frozen_prereg['population']['external_site_ids'] = ['site_external']
frozen_prereg['approvals'].update({role: 'unit-test-role' for role in
                                   ('principal_investigator', 'statistician', 'clinical_reviewer', 'data_controller')})
assert validate_preregistration(frozen_prereg, require_frozen=True)['valid'] is True
with tempfile.TemporaryDirectory() as folder:
    folder = Path(folder)
    dataset_path = folder / 'identifier-only.bin'
    dataset_path.write_bytes(b'identifier-only-unit-test')
    prereg_path = folder / 'prereg.json'
    prereg_path.write_text(json.dumps(frozen_prereg, ensure_ascii=False), encoding='utf-8')
    manifest_path = folder / 'manifest.json'
    manifest_for_freeze = {**manifest,
                           'dataset_sha256': hashlib.sha256(dataset_path.read_bytes()).hexdigest(),
                           'preregistration_sha256': hashlib.sha256(prereg_path.read_bytes()).hexdigest()}
    manifest_path.write_text(json.dumps(manifest_for_freeze, ensure_ascii=False), encoding='utf-8')
    freeze_result = freeze(manifest_path, prereg_path, folder / 'freeze', 'unit-test-role')
    assert validate_freeze(Path(freeze_result['record']), manifest_path, prereg_path, dataset_path)['valid'] is True
print('external validation pipeline structural regression: PASS')
