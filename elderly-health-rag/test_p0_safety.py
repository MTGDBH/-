# -*- coding: utf-8 -*-
"""GraphRAG P0 safety contracts: uncertainty, authorization, gates, paths and sources."""
from __future__ import annotations

import graphrag_index as graph


def query(question, disease=None, context=None, **options):
    graph._QUERY_CONTEXT = context or {}
    return graph.query(question, disease, options.pop('top_k', 8), options)


def main():
    graph.build()

    strong = query('血压连续偏高怎么复测', 'hypertension',
                   {'latest': {'bp': {'value': 150, 'value2': 92}}}, audience='elderly')
    assert strong['results']
    assert strong['uncertainty']['level'] != 'high'
    assert strong['confidence']['basis'] == 'inverse_of_uncertainty'

    missing = query('血压连续偏高怎么复测', 'hypertension', {}, audience='elderly')
    assert missing['uncertainty']['level'] in {'medium', 'high'}
    assert '缺少用户近期指标' in missing['uncertainty']['reasons']
    empty = query('完全无关词xyzq', 'not_a_disease', {'latest': {'bp': {'value': 120}}}, audience='elderly')
    assert empty['results'] == [] and empty['uncertainty']['level'] == 'high'
    conflict_uncertainty, _ = graph.assess_uncertainty(strong['results'], {'latest': {'bp': {'value': 150}}}, [{'kind': 'test_conflict'}])
    assert conflict_uncertainty['level'] == 'high'

    question = '营养 肌力 活动 跌倒 认知 情绪 多重用药'
    elderly = query(question, audience='elderly', enable_hidden_relationships=True)
    caregiver = query(question, audience='caregiver', research_preview=True)
    authorized_preview = query(question, audience='elderly', research_preview=True, research_preview_authorized=True)
    doctor = query(question, audience='doctor')
    assert elderly['relationship_candidates'] == []
    assert caregiver['relationship_candidates'] == []
    assert authorized_preview['relationship_candidates']
    assert doctor['relationship_candidates']
    assert all(row.get('review_status') == 'pending_medical_review' and row.get('usage_status') == 'research_preview_active' and row.get('not_for_actions') is True for row in doctor['relationship_candidates'])

    pending_high_risk = {'type': 'managed_by', 'strength': 'high', 'review_status': 'pending_medical_review'}
    gate = graph.relationship_gate(pending_high_risk, 'elderly', source_state='approved')
    assert not gate['ordinary_action_allowed'] and not gate['diagnostic_or_medication_allowed']
    assert gate['review_status'] == 'blocked'
    assert not graph.is_clinician_approved({'review_status': 'approved', 'reviewer_name_or_id': 'user-1', 'reviewed_at': '2026-08-26T00:00:00Z'})
    assert graph.is_clinician_approved({'review_status': 'approved', 'reviewer_name_or_id': 'doctor-1', 'reviewer_role': 'clinician', 'reviewed_at': '2026-08-26T00:00:00Z'})
    gated_action = graph.apply_action_gates([{'priority': 'normal', 'action': '调整治疗', 'evidence': 'pending-edge'}], {'pending-edge': gate})[0]
    assert gated_action['gate_status'] == 'blocked_pending_clinician_review'
    assert gated_action['action_type'] == 'contact_doctor' and gated_action['requires_confirmation'] is True
    assert '调整治疗' not in gated_action['action']
    assert all(row.get('gate_status') != 'allowed' or row.get('action_type') not in {'prescribe_medication', 'adjust_medication', 'diagnose'} for row in strong['recommendations'])

    assert strong['graph_paths']
    for path in strong['graph_paths']:
        assert path['hop_count'] == len(path['edges'])
        assert len(path['nodes']) == path['hop_count'] + 1
        assert path['hop'] == path['hop_count']

    flagged = query('最近血压应该怎么复测', 'hypertension', {}, audience='elderly', source_gate='flag_legacy_pending', source_review_penalty=1)
    strict = query('最近血压应该怎么复测', 'hypertension', {}, audience='elderly', source_gate='exclude_legacy_pending')
    assert flagged['retrieval_trace']['source_review_penalty'] == 1
    assert flagged['retrieval_trace']['flagged_legacy_pending_results'] >= 1
    assert any(row.get('source_review_required') for row in flagged['results'])
    assert strict['retrieval_trace']['excluded_legacy_pending_chunks'] >= 1
    assert all(row.get('source_review_state') != 'legacy_pending' for row in strict['results'])

    print({'passed': True, 'paths_checked': len(strong['graph_paths']), 'doctor_candidates': len(doctor['relationship_candidates']),
           'flagged_legacy_results': flagged['retrieval_trace']['flagged_legacy_pending_results'],
           'strict_excluded': strict['retrieval_trace']['excluded_legacy_pending_chunks']})


if __name__ == '__main__':
    main()
