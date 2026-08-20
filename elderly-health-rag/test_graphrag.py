# -*- coding: utf-8 -*-
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent
def main():
    build = subprocess.run([sys.executable, str(ROOT/'graphrag_index.py'), 'build'], capture_output=True, check=True)
    report = json.loads(build.stdout.decode('utf-8'))
    assert report['chunks'] >= 9 and report['entities'] >= 20 and report['relationships'] >= 30
    query = subprocess.run([sys.executable, str(ROOT/'graphrag_index.py')], input=json.dumps({'question':'血压连续偏高怎么办','disease':'hypertension'}, ensure_ascii=False).encode('utf-8'), capture_output=True, check=True)
    result = json.loads(query.stdout.decode('utf-8'))
    assert result['results'] and all(x.get('citation') and x.get('evidence_level') for x in result['results'])
    assert result['graph_mode'] == 'local_hybrid'
    print('GraphRAG tests: PASS', report)
if __name__ == '__main__': main()
