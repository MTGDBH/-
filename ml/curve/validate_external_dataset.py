# -*- coding: utf-8 -*-
"""Validate a real, longitudinal elderly-health candidate dataset.

Validation never upgrades a file to clinical or external evidence.  It checks
structure, provenance labels and eligibility for a separately reviewed run.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import median


ROOT = Path(__file__).resolve().parent
SCHEMA = json.loads((ROOT / 'external_dataset_schema.json').read_text(encoding='utf-8'))


def parse_ts(value: str) -> datetime:
    text = str(value or '').strip()
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('timestamp must include timezone')
    return parsed


def _clean(value):
    return str(value or '').strip()


def _issue(errors, message, limit=200):
    if len(errors) < limit:
        errors.append(message)


def _fraction(numerator, denominator):
    return numerator / denominator if denominator else None


def _distribution(rows, field):
    counts = Counter(str(row.get(field) or '<missing>') for row in rows)
    total = sum(counts.values())
    return {
        key: {'rows': count, 'row_fraction': _fraction(count, total)}
        for key, count in sorted(counts.items())
    }


def validate(path: Path) -> dict:
    errors, warnings, rows = [], [], []
    with path.open('r', encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        fields = list(reader.fieldnames or [])
        missing_columns = sorted(set(SCHEMA['required_columns']) - set(fields))
        if missing_columns:
            return {'valid': False, 'errors': [f'missing required columns: {missing_columns}'], 'warnings': [], 'n_rows': 0,
                    'schema_version': SCHEMA['schema_version'], 'data_class': 'unclassified'}
        for line_no, raw in enumerate(reader, 2):
            participant_id, site_id = _clean(raw['participant_id']), _clean(raw['site_id'])
            metric, unit = _clean(raw['metric']), _clean(raw['unit'])
            condition, posture = _clean(raw['condition']), _clean(raw['posture'])
            device_id, source = _clean(raw['device_id']), _clean(raw['measurement_source'])
            repeat_flag, medication = _clean(raw['repeat_flag']), _clean(raw['medication_context'])
            missing_reason, quality = _clean(raw['missing_reason']), _clean(raw['quality_flag'])
            sex, region, conditions = _clean(raw['sex']), _clean(raw['region']), _clean(raw['baseline_conditions'])
            if not participant_id or not site_id:
                _issue(errors, f'line {line_no}: participant_id and site_id cannot be empty')
            try:
                timestamp = parse_ts(raw['timestamp'])
            except Exception as exc:
                _issue(errors, f'line {line_no}: invalid timestamp ({exc})')
                continue
            if metric not in SCHEMA['metrics']:
                _issue(errors, f'line {line_no}: unsupported metric={metric}')
                continue
            metric_spec = SCHEMA['metrics'][metric]
            if unit != metric_spec['unit']:
                _issue(errors, f'line {line_no}: unit={unit} does not match {metric_spec["unit"]} for metric={metric}')
            if condition not in metric_spec['conditions']:
                _issue(errors, f'line {line_no}: condition={condition or "<empty>"} invalid for metric={metric}')
            if posture not in metric_spec['postures']:
                _issue(errors, f'line {line_no}: posture={posture or "<empty>"} invalid for metric={metric}')
            for field, value in [('measurement_source', source), ('repeat_flag', repeat_flag),
                                 ('medication_context', medication), ('missing_reason', missing_reason),
                                 ('quality_flag', quality), ('sex', sex)]:
                if value not in SCHEMA['allowed_values'][field]:
                    _issue(errors, f'line {line_no}: {field}={value or "<empty>"} is invalid')
            if source == 'synthetic':
                _issue(errors, f'line {line_no}: synthetic source is forbidden in a real-data candidate')
            if not device_id or device_id.lower() == 'unknown':
                _issue(warnings, f'line {line_no}: device_id is missing/unknown')
            value_text = _clean(raw['value'])
            value = None
            if value_text:
                try:
                    value = float(value_text)
                    if not math.isfinite(value):
                        raise ValueError('non-finite')
                except Exception:
                    _issue(errors, f'line {line_no}: value is not a finite number')
                if missing_reason not in {'', 'not_missing'}:
                    _issue(errors, f'line {line_no}: observed value cannot carry missing_reason={missing_reason}')
                if quality == 'missing':
                    _issue(errors, f'line {line_no}: observed value cannot have quality_flag=missing')
            else:
                if missing_reason in {'', 'not_missing'}:
                    _issue(errors, f'line {line_no}: empty value requires a missing_reason')
                if quality != 'missing':
                    _issue(errors, f'line {line_no}: empty value requires quality_flag=missing')
            try:
                age = int(float(_clean(raw['age'])))
                if age < 60 or age > 120:
                    _issue(warnings, f'line {line_no}: age={age} outside expected elderly-study range 60..120')
            except Exception:
                _issue(errors, f'line {line_no}: age must be numeric')
                age = None
            if not region:
                _issue(errors, f'line {line_no}: region cannot be empty')
            if not conditions:
                _issue(errors, f'line {line_no}: baseline_conditions must be none or a pipe-separated list')
            rows.append({
                'line': line_no, 'participant_id': participant_id, 'site_id': site_id, 'timestamp': timestamp,
                'metric': metric, 'value': value, 'unit': unit, 'condition': condition, 'posture': posture,
                'device_id': device_id, 'measurement_source': source, 'repeat_flag': repeat_flag,
                'medication_context': medication, 'missing_reason': missing_reason, 'quality_flag': quality,
                'age': age, 'sex': sex, 'region': region, 'baseline_conditions': conditions,
            })

    if not rows:
        errors.append('dataset is empty')
    participant_sites = defaultdict(set)
    participant_metadata = defaultdict(lambda: defaultdict(set))
    by_series, site_participants = defaultdict(set), defaultdict(set)
    observed_rows = []
    for row in rows:
        participant_sites[row['participant_id']].add(row['site_id'])
        site_participants[row['site_id']].add(row['participant_id'])
        for field in ('age', 'sex', 'region', 'baseline_conditions'):
            participant_metadata[row['participant_id']][field].add(str(row[field]))
        if row['value'] is not None and row['quality_flag'] != 'excluded':
            observed_rows.append(row)
            by_series[(row['participant_id'], row['metric'], row['condition'])].add(row['timestamp'].date())
    for participant_id, sites in participant_sites.items():
        if len(sites) != 1:
            _issue(errors, f'participant_id={participant_id} appears in multiple sites: {sorted(sites)}')
    for participant_id, metadata in participant_metadata.items():
        for field, values in metadata.items():
            if len(values) != 1:
                _issue(errors, f'participant_id={participant_id} has inconsistent {field}: {sorted(values)}')
    duplicate_keys = Counter((row['participant_id'], row['timestamp'], row['metric'], row['condition'], row['device_id'], row['repeat_flag']) for row in rows)
    duplicate_records = []
    for key, count in duplicate_keys.items():
        if count > 1:
            _issue(errors, f'duplicate measurement key: {key} x{count}')
            duplicate_records.append({'participant_id': key[0], 'timestamp': key[1].isoformat(),
                                      'metric': key[2], 'condition': key[3], 'device_id': key[4],
                                      'repeat_flag': key[5], 'count': count})
    participants = sorted(participant_sites)
    sites = sorted(site_participants)
    span_days = ((max(row['timestamp'] for row in rows) - min(row['timestamp'] for row in rows)).total_seconds() / 86400 + 1) if rows else 0
    short_series = [f'{key}:{len(days)} valid days' for key, days in by_series.items()
                    if len(days) < SCHEMA['quality_gates']['minimum_valid_days_for_7d_forecast']]
    missing_rows = [row for row in rows if row['value'] is None]
    condition_missing = sum(not row['condition'] for row in rows)
    device_unknown = sum(not row['device_id'] or row['device_id'].lower() == 'unknown' for row in rows)
    missing_reason_counts = Counter(row['missing_reason'] for row in missing_rows)
    quality_counts = Counter(row['quality_flag'] for row in rows)
    unit_anomalies = [
        {'line': row['line'], 'participant_id': row['participant_id'], 'metric': row['metric'],
         'observed_unit': row['unit'], 'expected_unit': SCHEMA['metrics'][row['metric']]['unit']}
        for row in rows if row['metric'] in SCHEMA['metrics']
        and row['unit'] != SCHEMA['metrics'][row['metric']]['unit']
    ]
    valid_rows = [row for row in rows if row['value'] is not None and row['quality_flag'] == 'valid']
    per_participant = {}
    for participant_id in participants:
        participant_rows = [row for row in rows if row['participant_id'] == participant_id]
        participant_valid = [row for row in valid_rows if row['participant_id'] == participant_id]
        participant_dates = [row['timestamp'] for row in participant_rows]
        per_participant[participant_id] = {
            'site_id': next(iter(participant_sites[participant_id]), None),
            'calendar_span_days': ((max(participant_dates) - min(participant_dates)).total_seconds() / 86400 + 1)
                                  if participant_dates else None,
            'valid_days': len({row['timestamp'].date().isoformat() for row in participant_valid}),
            'valid_days_by_metric': {
                metric: len({row['timestamp'].date().isoformat() for row in participant_valid if row['metric'] == metric})
                for metric in sorted({row['metric'] for row in participant_rows})
            },
            'scheduled_rows': len(participant_rows),
            'missing_schedule_rows': sum(row['value'] is None for row in participant_rows),
            'scheduled_row_missing_rate': _fraction(sum(row['value'] is None for row in participant_rows), len(participant_rows)),
        }
    missing_by_metric_condition = {}
    for key in sorted({(row['metric'], row['condition']) for row in rows}):
        cells = [row for row in rows if (row['metric'], row['condition']) == key]
        missing = sum(row['value'] is None for row in cells)
        missing_by_metric_condition[f'{key[0]}|{key[1] or "<missing>"}'] = {
            'rows': len(cells), 'missing_schedule_rows': missing,
            'scheduled_row_missing_rate': _fraction(missing, len(cells)),
        }
    site_dashboard = {}
    for site in sites:
        site_rows = [row for row in rows if row['site_id'] == site]
        site_valid = [row for row in valid_rows if row['site_id'] == site]
        valid_day_values = [per_participant[pid]['valid_days'] for pid in sorted(site_participants[site])]
        site_missing = sum(row['value'] is None for row in site_rows)
        site_dashboard[site] = {
            'participants': len(site_participants[site]), 'rows': len(site_rows),
            'valid_rows': len(site_valid),
            'valid_days_per_participant': {
                'minimum': min(valid_day_values, default=None),
                'median': float(median(valid_day_values)) if valid_day_values else None,
                'maximum': max(valid_day_values, default=None),
            },
            'scheduled_row_missing_rate': _fraction(site_missing, len(site_rows)),
            'condition_field_missing_rate': _fraction(sum(not row['condition'] for row in site_rows), len(site_rows)),
            'device_distribution': _distribution(site_rows, 'device_id'),
            'metric_distribution': _distribution(site_rows, 'metric'),
        }
    if len(sites) < SCHEMA['quality_gates']['minimum_sites_for_external_holdout']:
        warnings.append(f'sites={len(sites)} < required minimum {SCHEMA["quality_gates"]["minimum_sites_for_external_holdout"]}')
    if len(participants) < SCHEMA['quality_gates']['engineering_pilot_participants']:
        warnings.append(f'participants={len(participants)} < engineering pilot minimum {SCHEMA["quality_gates"]["engineering_pilot_participants"]}')
    if span_days < SCHEMA['quality_gates']['minimum_span_days']:
        warnings.append(f'span_days={span_days:.1f} < minimum {SCHEMA["quality_gates"]["minimum_span_days"]}')
    if short_series:
        warnings.append(f'series below 7-day forecast gate: {len(short_series)}')
    return {
        'valid': not errors, 'errors': errors, 'warnings': warnings, 'schema_version': SCHEMA['schema_version'],
        'data_class': 'internal_validation_candidate', 'n_rows': len(rows), 'observed_rows': len(observed_rows),
        'missing_schedule_rows': len(missing_rows), 'participants': len(participants), 'sites': len(sites),
        'span_days': round(span_days, 2), 'series': len(by_series), 'short_series': short_series[:50],
        'site_summary': {site: {'participants': len(ids), 'rows': sum(row['site_id'] == site for row in rows)} for site, ids in site_participants.items()},
        'missingness': {'row_rate': len(missing_rows) / len(rows) if rows else None,
                        'reason_distribution': dict(sorted(missing_reason_counts.items())),
                        'condition_missing_rate': condition_missing / len(rows) if rows else None,
                        'device_unknown_rate': device_unknown / len(rows) if rows else None},
        'quality_flag_distribution': dict(sorted(quality_counts.items())),
        'quality_dashboard': {
            'status': 'populated' if rows else 'not_collected',
            'definitions': {
                'valid_day': 'distinct timestamp calendar date with >=1 observed row whose quality_flag is valid',
                'missing_rate': 'empty-value planned rows / all supplied planned rows; absent unsupplied schedule rows cannot be inferred',
                'conditional_missing_rate': 'the same planned-row rate stratified by metric and declared measurement condition',
                'duplicate_key': 'participant_id + timestamp + metric + condition + device_id + repeat_flag',
            },
            'per_participant_valid_days': per_participant,
            'overall_scheduled_row_missing_rate': _fraction(len(missing_rows), len(rows)),
            'condition_field_missing_rate': _fraction(condition_missing, len(rows)),
            'missing_rate_by_metric_condition': missing_by_metric_condition,
            'device_distribution': _distribution(rows, 'device_id'),
            'unit_anomalies': {'count': len(unit_anomalies), 'records': unit_anomalies[:200]},
            'duplicates': {'duplicate_keys': len(duplicate_records),
                           'excess_rows': sum(item['count'] - 1 for item in duplicate_records),
                           'records': duplicate_records[:200]},
            'site_differences': site_dashboard,
        },
        'readiness': {
            'participant_isolation_possible': all(len(sites_) == 1 for sites_ in participant_sites.values()),
            'external_site_holdout_possible': len(sites) >= SCHEMA['quality_gates']['minimum_sites_for_external_holdout'],
            'engineering_pilot': len(participants) >= SCHEMA['quality_gates']['engineering_pilot_participants'] and span_days >= SCHEMA['quality_gates']['minimum_span_days'],
            'model_development_minimum': len(participants) >= SCHEMA['quality_gates']['model_development_minimum_participants'] and span_days >= SCHEMA['quality_gates']['minimum_span_days'],
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('csv', type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    result = validate(args.csv)
    result['input'] = str(args.csv.resolve())
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
