# -*- coding: utf-8 -*-
"""统一疾病风险预测CLI，Node只传白名单特征。"""
import json
import sys
from pathlib import Path

import joblib
import pandas as pd
from functools import lru_cache

ROOT = Path(__file__).parent


@lru_cache(maxsize=8)
def _load_model(path):
    return joblib.load(path)


@lru_cache(maxsize=8)
def _load_metadata(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def preload_models():
    models_dir = ROOT / 'models'
    if not models_dir.exists(): return {'models': 0, 'metadata': 0}
    metadata = list(models_dir.glob('*_model_metadata.json'))
    models = list(models_dir.glob('*_calibrated.joblib'))
    for path in metadata: _load_metadata(str(path))
    for path in models: _load_model(str(path))
    return {'models': len(models), 'metadata': len(metadata)}


def emit(payload):
    sys.stdout.buffer.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))


def predict(request):
    try:
        req = request if isinstance(request, dict) else {}
        disease = str(req.get('disease') or '')
        meta_path = ROOT / 'models' / f'{disease}_model_metadata.json'
        model_path = ROOT / 'models' / f'{disease}_calibrated.joblib'
        if not meta_path.exists() or not model_path.exists():
            return {'success': False, 'error': 'model_unavailable', 'disease': disease}
        meta = _load_metadata(str(meta_path))
        values = req.get('features') or {}
        missing = [f for f in meta['features'] if values.get(f) is None]
        row = {f: values.get(f) for f in meta['features']}
        X = pd.DataFrame([row], columns=meta['features'])
        model = _load_model(str(model_path))
        probability = float(model.predict_proba(X)[0, 1])
        level = 'low' if probability < 0.05 else ('moderate' if probability < 0.15 else 'higher')
        return {
            'success': True, 'disease': disease, 'risk_probability': round(probability, 4),
            'risk_percent': round(probability * 100, 2), 'risk_level': level,
            'model': meta['model'], 'model_version': 'w1w2-v1',
            'missing_features': missing, 'confidence': 'medium' if len(missing) < 5 else 'low',
            'horizon_years': 2, 'disclaimer': meta['disclaimer'],
        }
    except Exception as exc:
        return {'success': False, 'error': 'prediction_failed', 'detail': type(exc).__name__}


def main():
    try:
        request = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    except Exception:
        request = {}
    emit(predict(request))


if __name__ == '__main__':
    main()
