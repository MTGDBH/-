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
        for field in ('file', 'source_url', 'publisher', 'publication_year', 'evidence_level', 'review_status', 'version', 'population', 'limitations', 'retrieved_at'):
            if not source.get(field): errors.append(f'source {source.get("file")} missing {field}')
        if source.get('evidence_level') not in EVIDENCE_LEVELS: errors.append(f'source {source.get("file")} invalid evidence_level')
        if source.get('review_status', '').find('复核') >= 0: warnings.append(f'source pending review: {source.get("file")}')
    # 核心疾病的最低证据覆盖：至少有指南/临床标准、系统综述和关键随机研究。
    # 这是来源治理门槛，不代表这些来源已经获得医生批准。
    registry = load(INPUT / 'evidence_registry.json', [])
    required_diseases = {'hypertension', 'diabetes', 'heart_disease', 'stroke', 'chronic_kidney_disease', 'frailty'}
    registry_types = {}
    for source in registry:
        category = 'guideline' if source.get('document_type') in {'guideline', 'clinical_standard'} else source.get('document_type')
        registry_types.setdefault(source.get('disease'), set()).add(category)
    required_categories = {'guideline', 'systematic_review', 'randomized_controlled_trial'}
    for disease in sorted(required_diseases):
        missing = required_categories - registry_types.get(disease, set())
        if missing: errors.append(f'evidence registry {disease} missing categories: {sorted(missing)}')
    entities = {e.get('id') for e in load(OUTPUT / 'entities.json', [])}
    graph_relations = load(OUTPUT / 'relationships.json', [])
    review_manifest = load(OUTPUT / 'relation_review_manifest.json', {})
    pre_review_manifest = load(OUTPUT / 'medical_pre_review.json', {})
    conflict_manifest = load(OUTPUT / 'evidence_conflicts.json', {})
    if conflict_manifest.get('checked_relationships') not in (None, len(graph_relations)):
        warnings.append('evidence conflict manifest relationship count differs from index')
    review_by_index = {r.get('relation_index'): r for r in review_manifest.get('relations', [])}
    pre_review_by_index = {r.get('relation_index'): r for r in pre_review_manifest.get('relations', [])}
    for relation_index in review_by_index:
        if relation_index not in pre_review_by_index:
            errors.append(f'high-risk relation[{relation_index}] missing AI pre-review result')
    required_opinion_fields = {'evidence_assessment', 'allowed_expression', 'forbidden_expression', 'required_guardrails', 'clinical_confirmation_required', 'decision_label'}
    for relation_index, pre_review in pre_review_by_index.items():
        opinion = pre_review.get('ai_review_opinion') or {}
        missing_opinion = required_opinion_fields - set(opinion)
        if missing_opinion:
            errors.append(f'AI pre-review[{relation_index}] missing opinion fields: {sorted(missing_opinion)}')
        if pre_review.get('ai_pre_review_status') == 'needs_clinician_confirmation' and not opinion.get('clinical_confirmation_required'):
            errors.append(f'AI pre-review[{relation_index}] clinician gate not set')
    centralized_ai_review = review_manifest.get('ai_pre_review', {})
    if centralized_ai_review and centralized_ai_review.get('relations_reviewed') != len(review_by_index):
        errors.append('centralized relation review manifest AI pre-review count mismatch')
    for relation_index, review in review_by_index.items():
        if centralized_ai_review and not review.get('ai_pre_review_status'):
            errors.append(f'centralized relation review[{relation_index}] missing AI pre-review status')
        if review.get('review_status') == 'approved' and review.get('ai_pre_review_status') == 'needs_clinician_confirmation':
            errors.append(f'relation[{relation_index}] has inconsistent approved/clinician-gate status')
    high_risk_types = {
        'urgent_signal', 'emergency_action', 'requires_medical_review',
        'requires_clinician_review', 'do_not_self_adjust_medication',
        'contraindicated_or_caution', 'increases_risk_of',
        'major_preventable_driver', 'managed_by', 'prevention_evidence'
    }
    high_risk_count = 0
    for index, row in enumerate(graph_relations):
        if row.get('strength') == 'high' or row.get('type') in high_risk_types:
            high_risk_count += 1
            review = review_by_index.get(index)
            if not review or review.get('review_status') not in {'pending_medical_review', 'approved', 'rejected'}:
                errors.append(f'high-risk relation[{index}] missing medical review status')
    for row in graph_relations:
        if row.get('source') not in entities or row.get('target') not in entities: errors.append(f'unknown entity in {row}')
        if row.get('evidence') and not any(row['evidence'].startswith(s.get('file', '')) for s in sources): warnings.append(f'evidence source not registered: {row.get("evidence")}')
    report = {'pass': not errors, 'errors': errors, 'warnings': warnings, 'conflicts': conflicts, 'evidence_conflicts': conflict_manifest.get('conflicts', []), 'relations': len(relations), 'indexed_relations': len(graph_relations), 'entities': len(entities), 'sources': len(sources), 'high_risk_relations': high_risk_count, 'review_manifest_statuses': review_manifest.get('statuses', {}), 'medical_pre_review': {'relations_reviewed': len(pre_review_manifest.get('relations', [])), 'counts': pre_review_manifest.get('counts', {}), 'clinical_signoff_required': pre_review_manifest.get('clinical_signoff_required', True)}}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1

if __name__ == '__main__': sys.exit(main())
