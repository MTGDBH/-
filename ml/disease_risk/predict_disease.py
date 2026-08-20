# -*- coding: utf-8 -*-
"""统一疾病风险预测CLI，Node只传白名单特征。"""
import json
import sys
from pathlib import Path

import joblib
import pandas as pd

ROOT = Path(__file__).parent


def main():
    try:
        req = json.loads(sys.stdin.buffer.read().decode('utf-8'))
        disease = str(req.get('disease') or '')
        meta_path = ROOT / 'models' / f'{disease}_model_metadata.json'
        model_path = ROOT / 'models' / f'{disease}_calibrated.joblib'
        if not meta_path.exists() or not model_path.exists():
            print(json.dumps({'success': False, 'error': 'model_unavailable', 'disease': disease}, ensure_ascii=False))
            return
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        values = req.get('features') or {}
        missing = [f for f in meta['features'] if values.get(f) is None]
        row = {f: values.get(f) for f in meta['features']}
        X = pd.DataFrame([row], columns=meta['features'])
        model = joblib.load(model_path)
        probability = float(model.predict_proba(X)[0, 1])
        level = 'low' if probability < 0.05 else ('moderate' if probability < 0.15 else 'higher')
        print(json.dumps({
            'success': True, 'disease': disease, 'risk_probability': round(probability, 4),
            'risk_percent': round(probability * 100, 2), 'risk_level': level,
            'model': meta['model'], 'model_version': 'w1w2-v1',
            'missing_features': missing, 'confidence': 'medium' if len(missing) < 5 else 'low',
            'horizon_years': 2, 'disclaimer': meta['disclaimer'],
        }, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'success': False, 'error': 'prediction_failed', 'detail': type(exc).__name__}, ensure_ascii=False))


if __name__ == '__main__':
    main()
