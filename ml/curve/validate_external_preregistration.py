# -*- coding: utf-8 -*-
"""Validate a study-team preregistration; never claims registration or approval."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


REQUIRED_REPORTING = {
    'micro', 'participant_macro', 'site_macro', 'participant_bootstrap_95_ci',
    'refusal_rate', 'interval_coverage', 'interval_width', 'baseline_win_rate',
    'boundary_sensitivity',
}


def validate_preregistration(payload: dict, require_frozen=False) -> dict:
    errors, warnings = [], []
    primary = payload.get('primary_analysis') or {}
    population = payload.get('population') or {}
    intervals = payload.get('intervals') or {}
    freeze = payload.get('freeze') or {}
    approvals = payload.get('approvals') or {}
    required_primary = {'metric', 'unit', 'measurement_condition', 'horizon_days', 'aggregation',
                        'endpoint', 'split', 'primary_model', 'comparators', 'superiority_rule'}
    missing_primary = sorted(required_primary - set(primary))
    if missing_primary:
        errors.append(f'missing primary_analysis fields: {missing_primary}')
    if int(population.get('minimum_total_participants') or 0) < 100:
        errors.append('minimum_total_participants must be >=100')
    if int(population.get('minimum_followup_days') or 0) < 90:
        errors.append('minimum_followup_days must be >=90')
    if int(population.get('minimum_sites') or 0) < 2:
        errors.append('minimum_sites must be >=2')
    external_sites = population.get('external_site_ids') or []
    if not external_sites:
        warnings.append('external_site_ids is not yet specified')
    if primary.get('split') != 'external_site_test':
        errors.append('primary split must be external_site_test')
    if not {'last_value', 'rolling_median'} <= set(primary.get('comparators') or []):
        errors.append('both last_value and rolling_median comparators are required')
    if '未证明优势' not in str(primary.get('superiority_rule') or ''):
        errors.append('superiority_rule must force the conclusion 未证明优势 when the rule is unmet')
    coverage = intervals.get('coverage_target')
    if coverage is None or not 0 < float(coverage) < 1:
        errors.append('coverage_target must be between 0 and 1')
    if not payload.get('refusal_rules'):
        errors.append('refusal_rules cannot be empty')
    if not payload.get('subgroups'):
        errors.append('subgroups cannot be empty')
    if not payload.get('exclusion_rules'):
        errors.append('exclusion_rules cannot be empty')
    if not payload.get('sample_size_basis'):
        errors.append('sample_size_basis cannot be empty')
    missing_reporting = sorted(REQUIRED_REPORTING - set(payload.get('required_external_reporting') or []))
    if missing_reporting:
        errors.append(f'missing required external reporting: {missing_reporting}')
    if freeze.get('participant_overlap_allowed') is not False:
        errors.append('participant overlap must be explicitly false')
    if require_frozen:
        if payload.get('status') != 'registered_frozen':
            errors.append('status must be registered_frozen')
        for field in ('registered_at', 'registered_by', 'registry_or_archive_uri'):
            if not payload.get(field):
                errors.append(f'{field} is required for a frozen preregistration')
        if payload.get('external_results_unseen_at_freeze') is not True:
            errors.append('external_results_unseen_at_freeze must be attested true by the study team')
        for role in ('principal_investigator', 'statistician', 'clinical_reviewer', 'data_controller'):
            if not approvals.get(role):
                errors.append(f'approvals.{role} is required before freeze')
        if not external_sites:
            errors.append('external_site_ids must be fixed before freeze')
    return {'valid': not errors, 'errors': errors, 'warnings': warnings,
            'status': payload.get('status', 'missing')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('json_file', type=Path)
    parser.add_argument('--require-frozen', action='store_true')
    args = parser.parse_args()
    result = validate_preregistration(json.loads(args.json_file.read_text(encoding='utf-8')), args.require_frozen)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['valid'] else 2)


if __name__ == '__main__':
    main()
