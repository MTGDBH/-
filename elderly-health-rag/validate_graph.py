# -*- coding: utf-8 -*-
"""GraphRAG 知识层 schema/来源/关系一致性检查。"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).parent
INPUT = ROOT / 'input'
OUTPUT = ROOT / 'output'
ALLOWED_TYPES = {
    'has_risk_factor', 'has_nonmodifiable_factor', 'measured_by', 'monitoring_signal',
    'coexists_with', 'increases_risk_of', 'major_preventable_driver', 'managed_by',
    'prevention_evidence', 'supportive_evidence', 'urgent_signal', 'contextual_factor',
    'predictive_factor_in_older_adults', 'may_improve', 'complicates', 'shares_risk_factor_with',
    'may_lead_to', 'differential_from', 'associated_with', 'threshold_contextualized_by',
    'trend_signal_for', 'modifiable_by', 'amplifies_risk_with', 'protective_against',
    'recommended_for', 'not_sufficient_alone_for', 'requires_clinician_review',
    'contraindicated_or_caution', 'emergency_action', 'requires_remeasurement',
    'requires_medical_review', 'do_not_self_adjust_medication', 'reduces_risk_or_supports_control',
    'cardiovascular_context_factor',
}
EVIDENCE_LEVELS = {'authoritative_guidance', 'professional_guideline', 'professional_statement', 'clinical_standard', 'systematic_review', 'randomized_trial', 'observational_study', 'public_guidance'}

def load(path, fallback):
    if not path.exists(): return fallback
    return json.loads(path.read_text(encoding='utf-8'))

def main():
    relations = load(INPUT / 'relations.json', [])
    errors, warnings = [], []
    conflicts = []
    # 同一有向边出现互相矛盾的语义时，不能静默进入建议层；先登记供医学审核。
    contradiction_pairs = {
        frozenset({'increases_risk_of', 'protective_against'}),
        frozenset({'managed_by', 'contraindicated_or_caution'}),
        frozenset({'recommended_for', 'not_sufficient_alone_for'}),
    }
    by_pair = {}
    for index, row in enumerate(relations):
        for field in ('source', 'target', 'type', 'evidence', 'strength'):
            if not row.get(field): errors.append(f'relation[{index}] missing {field}')
        if row.get('type') not in ALLOWED_TYPES: errors.append(f'relation[{index}] unknown type {row.get("type")}')
        if row.get('strength') not in {'high', 'moderate', 'low'}: errors.append(f'relation[{index}] invalid strength')
        if row.get('evidence_level') and row['evidence_level'] not in EVIDENCE_LEVELS: errors.append(f'relation[{index}] invalid evidence_level')
        if row.get('type') in {'associated_with', 'predictive_factor_in_older_adults'} and row.get('causal_status') == 'causal': errors.append(f'relation[{index}] observational relation marked causal')
        pair = (row.get('source'), row.get('target'))
        by_pair.setdefault(pair, []).append(row)
    for pair, rows in by_pair.items():
        types = {r.get('type') for r in rows}
        for combo in contradiction_pairs:
            if combo.issubset(types):
                conflicts.append({'source': pair[0], 'target': pair[1], 'types': sorted(combo), 'relation_count': len(rows)})
                warnings.append(f'conflicting relations require medical review: {pair[0]} -> {pair[1]} ({sorted(combo)})')
    manifest = load(OUTPUT / 'source_manifest.json', {})
    sources = manifest.get('sources', manifest if isinstance(manifest, list) else [])
    for source in sources:
        for field in ('file', 'source_url', 'publisher', 'publication_year', 'evidence_level', 'review_status'):
            if not source.get(field): errors.append(f'source {source.get("file")} missing {field}')
        if source.get('evidence_level') not in EVIDENCE_LEVELS: errors.append(f'source {source.get("file")} invalid evidence_level')
        if source.get('review_status', '').find('复核') >= 0: warnings.append(f'source pending review: {source.get("file")}')
    entities = {e.get('id') for e in load(OUTPUT / 'entities.json', [])}
    graph_relations = load(OUTPUT / 'relationships.json', [])
    for row in graph_relations:
        if row.get('source') not in entities or row.get('target') not in entities: errors.append(f'unknown entity in {row}')
        if row.get('evidence') and not any(row['evidence'].startswith(s.get('file', '')) for s in sources): warnings.append(f'evidence source not registered: {row.get("evidence")}')
    report = {'pass': not errors, 'errors': errors, 'warnings': warnings, 'conflicts': conflicts, 'relations': len(relations), 'indexed_relations': len(graph_relations), 'entities': len(entities), 'sources': len(sources)}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1

if __name__ == '__main__': sys.exit(main())
