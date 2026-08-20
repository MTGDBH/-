# -*- coding: utf-8 -*-
"""从CHARLS纵向数据构建Wave1→Wave2疾病新发预测数据集。

只使用基线(Wave1)特征，排除基线已患病者，并以Wave2疾病状态作为结局。
禁止把演示用户数据写入训练集。
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

DISEASES = {
    'hypertension': 'hibpe',
    'diabetes': 'diabe',
    'heart_disease': 'hearte',
    'stroke': 'stroke',
}

FEATURES = [
    'age', 'gender', 'edu', 'systo', 'diasto', 'pulse', 'bmi', 'mwaist',
    'lgrip', 'rgrip', 'bl_glu', 'bl_hbalc', 'bl_cho', 'bl_ua', 'sleep',
    'smokev', 'smoken', 'drinkev', 'drinkl', 'exercise', 'totmet', 'srh',
    'cesd10', 'total_cognition', 'adlab_c', 'iadl', 'chronic', 'diabe',
    'hearte', 'stroke', 'dyslipe', 'lunge',
]

BOUNDS = {
    'age': (40, 110), 'systo': (50, 250), 'diasto': (30, 150), 'pulse': (20, 220),
    'bmi': (10, 70), 'mwaist': (30, 200), 'lgrip': (0, 100), 'rgrip': (0, 100),
    'bl_glu': (20, 600), 'bl_hbalc': (2, 20), 'bl_cho': (30, 1000), 'bl_ua': (50, 1200),
    'sleep': (0, 24), 'cesd10': (0, 30), 'total_cognition': (0, 30), 'iadl': (0, 10),
}


def clean_numeric(frame):
    out = frame.copy()
    for col in out.columns:
        out[col] = pd.to_numeric(out[col], errors='coerce')
        if col in BOUNDS:
            lo, hi = BOUNDS[col]
            out.loc[(out[col] < lo) | (out[col] > hi), col] = np.nan
    return out


def build(raw_path, out_dir, disease):
    target = DISEASES[disease]
    usecols = sorted(set(['ID', 'wave', target] + FEATURES))
    df = pd.read_csv(raw_path, usecols=usecols, low_memory=False)
    w1 = df[df['wave'] == 1].set_index('ID')
    w2 = df[df['wave'] == 2].set_index('ID')
    ids = w1.index.intersection(w2.index)
    base = w1.loc[ids]
    follow = w2.loc[ids, target]
    base_target = pd.to_numeric(base[target], errors='coerce')
    follow = pd.to_numeric(follow, errors='coerce')
    keep = base_target.eq(0) & follow.isin([0, 1])
    result = clean_numeric(base.loc[keep, FEATURES])
    # 不把整列缺失的变量送进模型（例如某些波次未采集的尿酸字段）。
    # 这样模型元数据会明确记录可用特征，在线预测也不会假装该变量存在。
    usable_features = [c for c in FEATURES if not result[c].isna().all()]
    result = result[usable_features]
    result.insert(0, 'ID', result.index.astype(str))
    result['y'] = follow.loc[keep].astype(int).to_numpy()
    result = result.reset_index(drop=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / f'{disease}_incidence_w1w2.csv'
    result.to_csv(csv_path, index=False)
    meta = {
        'disease': disease, 'target_column': target, 'source': str(raw_path),
        'wave_train': 1, 'wave_outcome': 2, 'n_total': int(len(result)),
        'n_positive': int(result['y'].sum()), 'positive_rate': float(result['y'].mean()),
        'features': usable_features, 'definition': f'Wave1 {target}=0 and Wave2 {target}=1',
        'missing_rate': {k: round(float(v), 4) for k, v in result[usable_features].isna().mean().items()},
    }
    (out_dir / f'{disease}_dataset_report.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=r'D:\大创数据2\CHARLS.csv')
    ap.add_argument('--out', default=str(Path(__file__).parent / 'datasets'))
    ap.add_argument('--disease', choices=list(DISEASES) + ['all'], default='all')
    args = ap.parse_args()
    source = Path(args.source)
    out = Path(args.out)
    diseases = DISEASES if args.disease == 'all' else {args.disease: DISEASES[args.disease]}
    reports = [build(source, out, d) for d in diseases]
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
