# -*- coding: utf-8 -*-
"""Participant-disjoint, site-held-out split manifests for curve validation."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

from validate_external_dataset import SCHEMA, validate
from validate_external_preregistration import validate_preregistration

SPLITS = ('train', 'validation', 'temporal_test', 'external_site_test')


def _rank(participant_id, salt):
    return hashlib.sha256(f'{salt}|{participant_id}'.encode('utf-8')).hexdigest()


def build_manifest(df, external_sites, salt='curve.external.v2'):
    external_sites = sorted(set(str(value) for value in external_sites))
    if not external_sites:
        raise ValueError('at least one external site must be pre-specified')
    participant_site_counts = df.groupby('participant_id')['site_id'].nunique()
    bad = sorted(str(value) for value in participant_site_counts[participant_site_counts != 1].index)
    if bad:
        raise ValueError(f'participants assigned to multiple sites: {bad[:20]}')
    participant_site = df.groupby('participant_id')['site_id'].first().astype(str).to_dict()
    sites = sorted(set(participant_site.values()))
    missing_sites = sorted(set(external_sites) - set(sites))
    if missing_sites:
        raise ValueError(f'external sites not found: {missing_sites}')
    if set(external_sites) == set(sites):
        raise ValueError('at least one non-external site is required for development')
    assignments = {}
    by_site = defaultdict(list)
    for participant_id, site_id in participant_site.items():
        by_site[site_id].append(str(participant_id))
    for site_id, participant_ids in sorted(by_site.items()):
        ordered = sorted(participant_ids, key=lambda value: _rank(value, salt))
        if site_id in external_sites:
            for participant_id in ordered:
                assignments[participant_id] = 'external_site_test'
            continue
        n = len(ordered)
        n_validation = max(1, int(round(n * 0.15))) if n >= 3 else 0
        n_temporal = max(1, int(round(n * 0.15))) if n >= 3 else 0
        n_train = n - n_validation - n_temporal
        if n_train < 1:
            n_train, n_validation, n_temporal = n, 0, 0
        for index, participant_id in enumerate(ordered):
            split = 'train' if index < n_train else ('validation' if index < n_train + n_validation else 'temporal_test')
            assignments[participant_id] = split
    participants_by_split = {split: sorted(pid for pid, value in assignments.items() if value == split) for split in SPLITS}
    overlaps = {}
    for index, left in enumerate(SPLITS):
        for right in SPLITS[index + 1:]:
            overlap = sorted(set(participants_by_split[left]) & set(participants_by_split[right]))
            if overlap:
                overlaps[f'{left}__{right}'] = overlap
    external_participants = set(participants_by_split['external_site_test'])
    external_site_counts = {site: sum(participant_site_id == site for participant_site_id in participant_site.values())
                            for site in external_sites}
    external_site_completeness = {
        site: sorted(pid for pid, participant_site_id in participant_site.items() if participant_site_id == site) ==
              sorted(pid for pid in external_participants if participant_site[pid] == site)
        for site in external_sites
    }
    return {
        'schema_version': 'curve-split-manifest.v1', 'salt': salt,
        'strategy': 'site-held-out plus participant-disjoint deterministic hash split within development sites',
        'external_sites': external_sites, 'assignments': assignments,
        'participants_by_split': participants_by_split,
        'counts': dict(sorted(Counter(assignments.values()).items())),
        'external_site_participant_counts': external_site_counts,
        'external_sample_size_gate': {site: count >= SCHEMA['quality_gates']['minimum_external_site_participants']
                                      for site, count in external_site_counts.items()},
        'overlaps': overlaps, 'external_site_completeness': external_site_completeness,
        'leakage_check_passed': not overlaps and all(external_site_completeness.values()),
    }


def validate_manifest(df, manifest):
    assignments = manifest.get('assignments', {})
    data_participants = set(df['participant_id'].astype(str))
    manifest_participants = set(assignments)
    missing = sorted(data_participants - manifest_participants)
    extra = sorted(manifest_participants - data_participants)
    participant_sites = df.groupby('participant_id')['site_id'].agg(lambda values: sorted(set(map(str, values)))).to_dict()
    site_leaks = {str(pid): sites for pid, sites in participant_sites.items() if len(sites) != 1}
    external_sites = set(map(str, manifest.get('external_sites', [])))
    external_wrong = sorted(str(pid) for pid, sites in participant_sites.items()
                            if ((sites[0] in external_sites) != (assignments.get(str(pid)) == 'external_site_test')))
    invalid_split_values = {str(pid): value for pid, value in assignments.items() if value not in SPLITS}
    supplied_by_split = {split: list(map(str, manifest.get('participants_by_split', {}).get(split, []))) for split in SPLITS}
    supplied_memberships = defaultdict(list)
    for split, participant_ids in supplied_by_split.items():
        for participant_id in participant_ids:
            supplied_memberships[participant_id].append(split)
    supplied_overlaps = {pid: splits for pid, splits in supplied_memberships.items() if len(set(splits)) > 1}
    expected_by_split = {split: sorted(str(pid) for pid, value in assignments.items() if value == split) for split in SPLITS}
    participants_by_split_mismatch = {
        split: {'expected': expected_by_split[split], 'supplied': sorted(supplied_by_split[split])}
        for split in SPLITS if expected_by_split[split] != sorted(supplied_by_split[split])
    }
    valid = not any((missing, extra, site_leaks, external_wrong, invalid_split_values,
                     supplied_overlaps, participants_by_split_mismatch))
    return {'valid': valid,
            'missing_participants': missing, 'extra_participants': extra,
            'multi_site_participants': site_leaks, 'external_site_assignment_errors': external_wrong,
            'invalid_split_values': invalid_split_values, 'participants_in_multiple_splits': supplied_overlaps,
            'participants_by_split_mismatch': participants_by_split_mismatch}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('csv', type=Path)
    parser.add_argument('--external-site', action='append', required=True,
                        help='Pre-specified site_id to hold out in full; repeat for multiple sites')
    parser.add_argument('--salt', default='curve.external.v2')
    parser.add_argument('--preregistration', type=Path, required=True,
                        help='Study-team preregistration with external_site_ids fixed before results')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    quality = validate(args.csv)
    if not quality['valid']:
        raise SystemExit(f'dataset validation failed: {quality["errors"][:10]}')
    df = pd.read_csv(args.csv, dtype={'participant_id': str, 'site_id': str})
    prereg_bytes = args.preregistration.read_bytes()
    prereg = json.loads(prereg_bytes)
    prereg_check = validate_preregistration(prereg, require_frozen=False)
    if not prereg_check['valid']:
        raise SystemExit(f'preregistration validation failed: {prereg_check["errors"]}')
    registered_sites = sorted(map(str, prereg.get('population', {}).get('external_site_ids') or []))
    requested_sites = sorted(set(map(str, args.external_site)))
    if registered_sites != requested_sites:
        raise SystemExit(f'external sites must match preregistration: preregistration={registered_sites}, requested={requested_sites}')
    manifest = build_manifest(df, args.external_site, args.salt)
    manifest['dataset_sha256'] = hashlib.sha256(args.csv.read_bytes()).hexdigest()
    manifest['dataset_schema_version'] = SCHEMA['schema_version']
    manifest['preregistration_sha256'] = hashlib.sha256(prereg_bytes).hexdigest()
    manifest['validation'] = validate_manifest(df, manifest)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.out.resolve()), 'counts': manifest['counts'],
                      'leakage_check_passed': manifest['leakage_check_passed']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
