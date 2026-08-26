# -*- coding: utf-8 -*-
"""GraphRAG 高风险关系的可审计 AI 预审核。

这不是医生签字，也不把关系改成 clinical approved。脚本只执行可复核的
证据完整性与安全规则，并为每条关系生成：
  - ai_pre_review_status: eligible_for_demo | needs_clinician_confirmation | reject_until_fixed
  - ai_pre_review_reasons
  - evidence_checks

所有关系原有的 review_status 会保留为 pending_medical_review，避免把自动检查
冒充临床批准。
"""
import json
from datetime import date
from pathlib import Path
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent
OUTPUT = ROOT / 'output'
INDEX_VERSION = '2026-08-26.v9'

SAFE_EDUCATION_TYPES = {
    'measured_by', 'monitoring_signal', 'has_risk_factor', 'has_nonmodifiable_factor',
    'shares_risk_factor_with', 'associated_with', 'predictive_factor_in_older_adults',
    'supportive_evidence', 'prevention_evidence', 'managed_by', 'coexists_with',
}
CLINICIAN_TYPES = {
    'urgent_signal', 'emergency_action', 'requires_medical_review',
    'requires_clinician_review', 'do_not_self_adjust_medication',
    'contraindicated_or_caution', 'threshold_contextualized_by',
    'requires_remeasurement', 'increases_risk_of', 'major_preventable_driver',
    'may_lead_to', 'complicates', 'differential_from', 'trend_signal_for',
}
GOOD_LEVELS = {'authoritative_guidance', 'professional_guideline', 'clinical_standard', 'systematic_review', 'randomized_trial'}
WEAK_LEVELS = {'public_guidance', 'professional_statement', 'observational_study'}


def load(path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding='utf-8'))


def source_key(evidence):
    return str(evidence or '').split('#', 1)[0]


def ai_review_opinion(relation, source):
    """生成逐条可审计的意见文本；不写入 clinical approved。"""
    relation_type = relation.get('type')
    source_level = relation.get('evidence_level')
    base = {
        'evidence_assessment': '来源元数据完整，证据片段可定位；该判断仅支持健康教育/风险解释，不等于个体诊断。',
        'allowed_expression': '使用“可能、相关、需要结合连续记录/医生评估”等保守表述。',
        'forbidden_expression': '不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。',
        'required_guardrails': ['保留证据 ID、来源 URL、版本和适用人群', '显示不替代医生诊断免责声明'],
        'clinical_confirmation_required': False,
    }
    if source_level in {'public_guidance', 'professional_statement', 'observational_study'}:
        base['evidence_assessment'] = '方向与来源摘要一致，但当前证据等级或摘要化程度不足以单独支持个体医疗决定。'
        base['required_guardrails'].append('优先补充指南或系统综述，并保留需临床确认状态')
    if relation_type in {'increases_risk_of', 'major_preventable_driver', 'may_lead_to', 'complicates'}:
        base.update({
            'allowed_expression': '可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。',
            'forbidden_expression': '不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。',
            'clinical_confirmation_required': True,
        })
    elif relation_type in {'urgent_signal', 'emergency_action'}:
        base.update({
            'allowed_expression': '出现明确危险信号时，立即停止等待模型并联系急救/医务人员。',
            'forbidden_expression': '不得建议继续观察、等待预测结果或自行处理替代急救。',
            'required_guardrails': ['优先急症提示', '不输出药物剂量', '保留联系家属/急救行动确认'],
            'clinical_confirmation_required': True,
        })
    elif relation_type in {'requires_clinician_review', 'requires_medical_review'}:
        base.update({
            'allowed_expression': '提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。',
            'forbidden_expression': '不得由系统替医生决定用药、诊断或复查结果。',
            'required_guardrails': ['行动需要确认', '记录复核状态和执行时间'],
            'clinical_confirmation_required': True,
        })
    elif relation_type == 'requires_remeasurement':
        base.update({
            'allowed_expression': '建议在相同或可比条件下按医生安排复测，并比较日期、趋势和测量条件。',
            'forbidden_expression': '不得把一次异常直接写成慢性病诊断或个人治疗目标。',
            'required_guardrails': ['记录复测时间', '缺少条件时降低可信度'],
            'clinical_confirmation_required': True,
        })
    elif relation_type == 'do_not_self_adjust_medication':
        base.update({
            'allowed_expression': '明确提醒不要自行加减药，出现不适时联系医生或药师。',
            'forbidden_expression': '不得给出剂量、换药、停药或服药时间调整方案。',
            'required_guardrails': ['用药相关行动必须二次确认', '保存审计记录'],
            'clinical_confirmation_required': True,
        })
    elif relation_type == 'managed_by':
        base['allowed_expression'] = '可作为生活方式或监测方向，具体目标结合年龄、虚弱、共病和医生意见。'
    elif relation_type in {'measured_by', 'monitoring_signal'}:
        base['allowed_expression'] = '可作为观察和复测指标，但单个读数不等于诊断。'
    elif relation_type in {'has_risk_factor', 'has_nonmodifiable_factor', 'coexists_with'}:
        base['allowed_expression'] = '可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。'
    base['decision_label'] = 'AI预审：允许演示/健康教育' if relation.get('ai_pre_review_status') == 'eligible_for_demo_education' else 'AI预审：保留并要求临床确认'
    return base


def review_one(index, relation, source_by_file):
    reasons = []
    checks = {}
    evidence = relation.get('evidence')
    source = source_by_file.get(source_key(evidence))
    checks['required_relation_fields'] = all(relation.get(k) not in (None, '') for k in ('source', 'target', 'type', 'strength', 'evidence', 'evidence_level'))
    checks['source_registered'] = source is not None
    checks['source_metadata_complete'] = bool(source and all(source.get(k) not in (None, '') for k in ('source_url', 'publisher', 'publication_year', 'version', 'population', 'limitations', 'retrieved_at')))
    checks['evidence_level_supported'] = relation.get('evidence_level') in GOOD_LEVELS | WEAK_LEVELS
    checks['older_adult_scope_present'] = bool(source and ('older' in str(source.get('population', '')).lower() or '老年' in str(source.get('population', ''))))
    checks['evidence_id_traceable'] = bool(evidence and '#' in str(evidence))
    checks['source_freshness_recorded'] = bool(source and source.get('retrieved_at'))

    if not checks['required_relation_fields']:
        reasons.append('关系缺少必填字段')
    if not checks['source_registered']:
        reasons.append(f'证据来源未登记: {source_key(evidence)}')
    if not checks['source_metadata_complete']:
        reasons.append('来源缺少版本/适用人群/限制/URL等治理字段')
    if not checks['evidence_level_supported']:
        reasons.append('证据等级未纳入治理字典')
    if not checks['evidence_id_traceable']:
        reasons.append('证据缺少章节或可定位片段')
    if relation.get('type') in {'associated_with', 'predictive_factor_in_older_adults'} and relation.get('causal_status') == 'causal':
        reasons.append('统计关联被错误标记为因果')
    if relation.get('type') in CLINICIAN_TYPES:
        reasons.append('涉及急症、阈值、复测、用药或疾病因果，需要临床人员确认')
    if relation.get('type') in {'increases_risk_of', 'major_preventable_driver', 'may_lead_to', 'complicates'}:
        reasons.append('涉及疾病风险/并发症方向，不能仅凭自动规则批准')
    if relation.get('evidence_level') in WEAK_LEVELS:
        reasons.append('证据等级较弱，建议补充指南或系统综述')
    if not checks['older_adult_scope_present']:
        reasons.append('来源适用人群未明确覆盖老年人，需确认外推边界')

    if any('缺少' in x or '错误' in x or '未登记' in x for x in reasons):
        status = 'reject_until_fixed'
    elif relation.get('type') in CLINICIAN_TYPES or relation.get('type') in {'increases_risk_of', 'major_preventable_driver', 'may_lead_to', 'complicates'} or not checks['older_adult_scope_present']:
        status = 'needs_clinician_confirmation'
    else:
        status = 'eligible_for_demo_education'
        reasons.append('证据字段完整，可用于演示/健康教育；不等于临床批准')
    result = {
        'relation_index': index,
        'source': relation.get('source'),
        'target': relation.get('target'),
        'type': relation.get('type'),
        'strength': relation.get('strength'),
        'evidence': evidence,
        'evidence_level': relation.get('evidence_level'),
        'existing_review_status': relation.get('review_status', 'pending_medical_review'),
        'ai_pre_review_status': status,
        'ai_pre_review_reasons': reasons,
        'evidence_checks': checks,
        'review_boundary': 'AI预审核不是医生签字；老人端临床使用仍需授权审核人确认',
    }
    result['ai_review_opinion'] = ai_review_opinion(result, source)
    return result


def main():
    relations = load(OUTPUT / 'relationships.json', [])
    manifest = load(OUTPUT / 'source_manifest.json', {})
    sources = manifest.get('sources', manifest if isinstance(manifest, list) else [])
    source_by_file = {str(x.get('file')): x for x in sources}
    # 以审核清单为权威范围，避免“高风险类型规则”和审核清单发生漏项。
    review_manifest = load(OUTPUT / 'relation_review_manifest.json', {})
    review_indexes = [x.get('relation_index') for x in review_manifest.get('relations', []) if isinstance(x.get('relation_index'), int)]
    if review_indexes:
        rows = [review_one(i, relations[i], source_by_file) for i in review_indexes if 0 <= i < len(relations)]
    else:
        rows = [review_one(i, row, source_by_file) for i, row in enumerate(relations) if row.get('strength') == 'high' or row.get('type') in CLINICIAN_TYPES]
    counts = {}
    for row in rows:
        counts[row['ai_pre_review_status']] = counts.get(row['ai_pre_review_status'], 0) + 1
    # 将预审核结果回写到既有关系审核清单，形成单一可审计记录；原 review_status
    # 不覆盖，确保 AI 预审不会伪装成医生批准。
    relation_manifest = load(OUTPUT / 'relation_review_manifest.json', {})
    manifest_by_index = {row.get('relation_index'): row for row in relation_manifest.get('relations', [])}
    for row in rows:
        target = manifest_by_index.get(row['relation_index'])
        if target is not None:
            target['ai_pre_review_status'] = row['ai_pre_review_status']
            target['ai_review_opinion'] = row['ai_review_opinion']
            target['ai_reviewed_at'] = str(date.today())
            target['ai_reviewer'] = 'AI evidence-governance pre-review (not a licensed clinician)'
    relation_manifest['ai_pre_review'] = {
        'schema_version': 'medical-pre-review.v1',
        'relations_reviewed': len(rows),
        'counts': counts,
        'clinical_signoff_required': True,
        'policy': 'AI pre-review never changes review_status or writes approved.',
    }
    (OUTPUT / 'relation_review_manifest.json').write_text(json.dumps(relation_manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    report = {
        'schema_version': 'medical-pre-review.v1',
        'index_version': INDEX_VERSION,
        'generated_at': str(date.today()),
        'reviewer': 'AI evidence-governance pre-review (not a licensed clinician)',
        'scope': 'high-strength or safety relations',
        'counts': counts,
        'relations_reviewed': len(rows),
        'clinical_signoff_required': True,
        'policy': 'Never convert pending_medical_review to approved automatically.',
        'relations': rows,
    }
    (OUTPUT / 'medical_pre_review.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = [
        '# GraphRAG 高风险关系 AI 预审核报告',
        '',
        f"索引版本：`{INDEX_VERSION}`；生成日期：`{report['generated_at']}`；审核对象：{len(rows)} 条。",
        '',
        '> 这是一份证据治理预审核，不是医生签字或临床批准。`review_status` 仍保持 `pending_medical_review`。',
        '',
        '## 结果统计',
        '',
    ]
    for key in ('eligible_for_demo_education', 'needs_clinician_confirmation', 'reject_until_fixed'):
        lines.append(f'- `{key}`：{counts.get(key, 0)} 条')
    lines += ['', '## 使用边界', '', '- `eligible_for_demo_education` 只能用于演示、证据展示和健康教育。', '- `needs_clinician_confirmation` 不得在老人端生成确定性医疗结论。', '- `reject_until_fixed` 必须补齐来源或修正关系后才能重新进入审核。', '- 急症、用药、阈值和疾病因果关系始终需要具备资质的临床人员确认。', '', '## 需临床确认的逐条意见', '']
    for row in rows:
        if row['ai_pre_review_status'] != 'needs_clinician_confirmation':
            continue
        opinion = row['ai_review_opinion']
        lines += [
            f"### 关系 {row['relation_index']}：`{row['source']}` —[{row['type']}]→ `{row['target']}`",
            f"- 证据：`{row['evidence']}`（{row['evidence_level']}）",
            f"- 允许表达：{opinion['allowed_expression']}",
            f"- 禁止表达：{opinion['forbidden_expression']}",
            '- 决定：保留 `pending_medical_review`，不得自动转为临床批准。', '',
        ]
    lines += ['逐条机器可读明细见 `output/medical_pre_review.json`。']
    (ROOT.parent / 'reports' / 'medical-pre-review-20260821.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({'index_version': INDEX_VERSION, 'relations_reviewed': len(rows), 'counts': counts, 'clinical_signoff_required': True}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
