# -*- coding: utf-8 -*-
"""Descriptive subgroup performance summaries; no unsupported fairness claim."""
from __future__ import annotations

from collections import defaultdict

import numpy as np

from participant_bootstrap import METRIC_FIELDS, aggregate_contributions


def age_band(age):
    try:
        age = int(float(age))
    except Exception:
        return 'unknown'
    if age < 70:
        return '60-69'
    if age < 80:
        return '70-79'
    if age < 90:
        return '80-89'
    return '90+'


def macro_summary(rows, cluster_field):
    clusters = defaultdict(list)
    for row in rows:
        clusters[str(row.get(cluster_field, 'unknown'))].append(row)
    summaries = [aggregate_contributions(values) for values in clusters.values()]
    result = {'clusters': len(summaries)}
    for field in METRIC_FIELDS:
        values = [float(summary[field]) for summary in summaries if summary.get(field) is not None]
        result[field] = float(np.mean(values)) if values else None
    return result


def _group_rows(rows, field):
    groups = defaultdict(list)
    for row in rows:
        if field == 'age_group':
            values = [age_band(row.get('age'))]
        elif field == 'baseline_condition':
            raw = str(row.get('baseline_conditions') or 'unknown')
            values = [value.strip() for value in raw.split('|') if value.strip()] or ['unknown']
        else:
            values = [str(row.get(field) or 'unknown')]
        for value in values:
            groups[value].append(row)
    return groups


def subgroup_report(rows, minimum_participants=10):
    dimensions = ('age_group', 'sex', 'region', 'device_id', 'baseline_condition')
    report = {'minimum_participants_for_interpretation': int(minimum_participants), 'dimensions': {}}
    for dimension in dimensions:
        group_output = {}
        for label, group_rows in sorted(_group_rows(rows, dimension).items()):
            participants = len({str(row['participant_id']) for row in group_rows})
            summary = aggregate_contributions(group_rows)
            group_output[label] = {**summary, 'participants': participants,
                                   'interpretation_status': 'reportable' if participants >= minimum_participants else 'insufficient_n'}
        gaps = {}
        for field in ('mae', 'coverage', 'interval_width', 'bias', 'refusal_rate', 'baseline_win_rate', 'boundary_event_sensitivity'):
            values = [(label, row[field]) for label, row in group_output.items()
                      if row.get(field) is not None and row['participants'] >= minimum_participants]
            gaps[field] = {
                'absolute_range': max(value for _, value in values) - min(value for _, value in values) if len(values) >= 2 else None,
                'highest_group': max(values, key=lambda item: item[1])[0] if len(values) >= 2 else None,
                'lowest_group': min(values, key=lambda item: item[1])[0] if len(values) >= 2 else None,
            }
        report['dimensions'][dimension] = {'groups': group_output, 'descriptive_gaps': gaps}
    report['claim'] = 'descriptive subgroup audit only; clinical fairness requires adequate pre-specified subgroup sample sizes'
    return report

