# -*- coding: utf-8 -*-
"""模型交付前的结构化回归：数据定义、模型卡、预测契约。"""
import json, subprocess, sys
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).parent
DISEASES = ['hypertension', 'diabetes', 'heart_disease', 'stroke']
def main():
    for disease in DISEASES:
        data = pd.read_csv(ROOT/'datasets'/f'{disease}_incidence_w1w2.csv')
        meta = json.loads((ROOT/'models'/f'{disease}_model_metadata.json').read_text(encoding='utf-8'))
        assert len(data) > 100 and set(data['y'].unique()) <= {0, 1}
        assert int(data['y'].sum()) == meta['n_positive']
        assert meta['task'] == 'Wave1→Wave2 incidence'
        assert meta['features'] == [c for c in data.columns if c not in ('ID','y')]
        req = {'disease': disease, 'features': {f: None for f in meta['features']}}
        out = subprocess.run([sys.executable, str(ROOT/'predict_disease.py')], input=json.dumps(req).encode(), capture_output=True, check=True)
        result = json.loads(out.stdout.decode('utf-8'))
        assert result['success'] and result['disease'] == disease and 0 <= result['risk_probability'] <= 1
    print('multidisease tests: PASS')
if __name__ == '__main__': main()
