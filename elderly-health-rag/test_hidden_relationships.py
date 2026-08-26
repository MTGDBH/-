# -*- coding: utf-8 -*-
"""隐藏关系只能作为医生待审核线索，老人端不得看到。"""
import json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent

def query(audience, enabled=False):
    payload = json.dumps({'question': '营养 肌力 活动 跌倒 认知 情绪 多重用药', 'options': {'top_k': 8, 'max_hops': 2, 'audience': audience, 'enable_hidden_relationships': enabled}}, ensure_ascii=False).encode('utf-8')
    out = subprocess.run([sys.executable, str(ROOT / 'graphrag_index.py')], input=payload, capture_output=True, check=True,
        env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'}).stdout
    return json.loads(out.decode('utf-8'))

manifest = json.loads((ROOT / 'output' / 'hidden_relationship_candidates.json').read_text(encoding='utf-8'))
assert manifest['candidate_count'] > 0
assert all(len(row.get('path', [])) == 2 for row in manifest['candidates'])
assert all(row.get('inference_status') == 'candidate_for_clinician_review' for row in manifest['candidates'])
elderly_disabled, elderly, doctor = query('elderly'), query('elderly', True), query('doctor', True)
assert elderly_disabled.get('relationship_candidates') == []
assert elderly.get('relationship_candidates') == [], 'legacy enable flag must not bypass authorization'
assert doctor.get('relationship_candidates')
assert all(len(row.get('node_labels', [])) == 3 and row.get('review_status') == 'pending_medical_review' and row.get('usage_status') == 'research_preview_active' for row in doctor['relationship_candidates'])
print(json.dumps({'passed': True, 'candidate_count': manifest['candidate_count'], 'doctor_visible': len(doctor['relationship_candidates']), 'elderly_research_preview_visible': 0, 'disabled_visible': 0}, ensure_ascii=False))
