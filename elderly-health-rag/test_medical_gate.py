# -*- coding: utf-8 -*-
"""审核准入门槛回归：老人端过滤未确认关系，医生端保留完整审计。"""
import json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent


def query(audience):
    payload = json.dumps({'question': '高血压和脑卒中有什么关系', 'disease': 'hypertension', 'options': {'top_k': 6, 'audience': audience}}, ensure_ascii=False).encode('utf-8')
    out = subprocess.run([sys.executable, str(ROOT / 'graphrag_index.py')], input=payload, capture_output=True, check=True, env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'}).stdout
    return json.loads(out.decode('utf-8'))


def main():
    elderly = query('elderly')
    doctor = query('doctor')
    failures = []
    if elderly.get('medical_gate', {}).get('audience') != 'elderly': failures.append('elderly audience not recorded')
    if elderly.get('retrieval_trace', {}).get('pre_review_count') != 83: failures.append('pre-review count missing')
    for path in elderly.get('graph_paths') or []:
        if path.get('ai_pre_review_status') == 'needs_clinician_confirmation' and path.get('relation') not in {'urgent_signal', 'emergency_action'}:
            failures.append(f"blocked relation leaked to elderly graph path: {path.get('relation')}")
    for edge in elderly.get('graph_context') or []:
        if edge.get('ai_pre_review_status') == 'needs_clinician_confirmation' and edge.get('type') not in {'urgent_signal', 'emergency_action'}:
            failures.append(f"blocked relation leaked to elderly graph context: {edge.get('type')}")
    for result in elderly.get('results') or []:
        for edge in result.get('graph_support') or []:
            if edge.get('ai_pre_review_status') == 'needs_clinician_confirmation' and edge.get('type') not in {'urgent_signal', 'emergency_action'}:
                failures.append(f"blocked relation leaked to elderly result support: {edge.get('type')}")
    if doctor.get('medical_gate', {}).get('blocked_edge_count') != 0: failures.append('doctor audit view unexpectedly blocked edges')
    if not any(path.get('ai_pre_review_status') == 'needs_clinician_confirmation' for path in doctor.get('graph_paths') or []): failures.append('doctor audit view missing pending relation')
    report = {'passed': not failures, 'elderly_blocked_edge_count': elderly.get('medical_gate', {}).get('blocked_edge_count'), 'doctor_blocked_edge_count': doctor.get('medical_gate', {}).get('blocked_edge_count'), 'failures': failures}
    (ROOT.parent / 'reports' / 'medical-gate-regression-20260821.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report['passed'] else 1)


if __name__ == '__main__': main()
