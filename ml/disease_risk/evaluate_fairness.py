# -*- coding: utf-8 -*-
"""多疾病风险模型的分组性能、校准和缺失数据评估。"""
import json
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, roc_auc_score

ROOT = Path(__file__).parent
GROUPS = {
    'age_65_74': lambda d: (d['age'] >= 65) & (d['age'] < 75),
    'age_75_plus': lambda d: d['age'] >= 75,
    'female': lambda d: d['gender'] == 0,
    'male': lambda d: d['gender'] == 1,
    'missing_core_bp': lambda d: d[['systo', 'diasto']].isna().any(axis=1),
}

def safe_auc(y, p):
    return round(float(roc_auc_score(y, p)), 4) if len(set(y)) > 1 else None

def calibration_bins(y, p, bins=10):
    edges = np.linspace(0, 1, bins + 1); rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p >= lo) & ((p < hi) if hi < 1 else (p <= hi))
        if not mask.any(): continue
        rows.append({'bin': f'{lo:.1f}-{hi:.1f}', 'n': int(mask.sum()), 'predicted': round(float(p[mask].mean()), 4), 'observed': round(float(y[mask].mean()), 4)})
    return rows

def main():
    reports = []
    datasets = ROOT / 'datasets'; models = ROOT / 'models'
    for csv_path in sorted(datasets.glob('*_incidence_w1w2.csv')):
        disease = csv_path.stem.replace('_incidence_w1w2', '')
        meta_path, model_path = models / f'{disease}_model_metadata.json', models / f'{disease}_calibrated.joblib'
        if not meta_path.exists() or not model_path.exists(): continue
        meta = json.loads(meta_path.read_text(encoding='utf-8')); df = pd.read_csv(csv_path)
        features = meta['features']; y = df['y'].astype(int).to_numpy(); model = joblib.load(model_path)
        p = model.predict_proba(df[features])[:, 1]
        groups = []
        for name, fn in GROUPS.items():
            mask = fn(df).fillna(False).to_numpy()
            if mask.sum() < 30: continue
            gy, gp = y[mask], p[mask]
            groups.append({'group': name, 'n': int(mask.sum()), 'positive': int(gy.sum()), 'positive_rate': round(float(gy.mean()), 4), 'roc_auc': safe_auc(gy, gp), 'brier': round(float(brier_score_loss(gy, gp)), 5), 'predicted_mean': round(float(gp.mean()), 5)})
        reports.append({'disease': disease, 'n': len(df), 'overall': {'positive_rate': round(float(y.mean()), 4), 'roc_auc': safe_auc(y, p), 'brier': round(float(brier_score_loss(y, p)), 5), 'calibration_bins': calibration_bins(y, p)}, 'groups': groups, 'limitations': ['这是同一队列内的分组审计，不是外部验证；小组样本量不足时不报告。', '年龄和性别差异不代表因果关系。']})
    out = {'models': reports, 'generated_at': pd.Timestamp.now('UTC').isoformat()}
    (ROOT.parent.parent / 'reports' / 'risk-fairness-evaluation-2026-08-20.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
