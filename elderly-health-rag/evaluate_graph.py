# -*- coding: utf-8 -*-
"""GraphRAG 回归评估：检索必须命中正确疾病证据，且用户上下文必须改变行动建议。"""
import json, os, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).parent

CASES = [
    ('hypertension', '血压偏高怎么办', {'latest': {'bp': {'value': 150, 'value2': 95}}}, 'high'),
    ('hypertension', '血压正常怎么办', {'latest': {'bp': {'value': 124, 'value2': 79}}}, 'normal'),
    ('diabetes', '血糖怎么复测', {'latest': {'glucose': {'value': 7.2}}}, 'high'),
    ('stroke', '突然单侧无力怎么办', {}, 'urgent'),
]

def main():
    passed = 0
    for disease, question, context, expected in CASES:
        payload = json.dumps({'question': question, 'disease': disease, 'context': context}, ensure_ascii=False).encode('utf-8')
        raw = subprocess.run([sys.executable, str(ROOT/'graphrag_index.py')], input=payload, capture_output=True, check=True, env={**os.environ, 'PYTHONIOENCODING': 'utf-8'}).stdout
        result = json.loads(raw.decode('utf-8'))
        assert result['results'], (disease, 'no evidence')
        assert result['recommendations'], (disease, 'no recommendation')
        assert result['recommendations'][0]['priority'] == expected, (disease, result['recommendations'])
        assert all(x.get('evidence') for x in result['recommendations'])
        passed += 1
    print(f'GraphRAG evaluation: {passed}/{len(CASES)} PASS')

if __name__ == '__main__': main()
