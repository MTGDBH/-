# -*- coding: utf-8 -*-
"""训练多疾病风险基线：Logistic与XGBoost比较，保存校准模型和模型卡。"""
import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from experiment_metadata import build_manifest, new_run_id, write_manifest
from sklearn.calibration import CalibratedClassifierCV
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier


def safe_metric(fn, y, p):
    try:
        return float(fn(y, p))
    except ValueError:
        return None


def train_one(csv_path, out_dir, run_id, data_manifest_id='charls_w1w2_incidence.v2'):
    disease = csv_path.stem.replace('_incidence_w1w2', '')
    df = pd.read_csv(csv_path)
    features = [c for c in df.columns if c not in ('ID', 'y')]
    X, y = df[features], df['y'].astype(int)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    logistic = Pipeline([
        ('imputer', SimpleImputer(strategy='median', add_indicator=True)),
        ('scale', StandardScaler()),
        ('model', LogisticRegression(max_iter=1200, class_weight='balanced', solver='liblinear')),
    ])
    xgb = XGBClassifier(
        objective='binary:logistic', eval_metric='logloss', n_estimators=300,
        learning_rate=0.04, max_depth=2, min_child_weight=3, subsample=0.8,
        colsample_bytree=0.8, tree_method='hist', random_state=42,
        n_jobs=2, scale_pos_weight=1.0,
    )
    xgb_pipe = Pipeline([('imputer', SimpleImputer(strategy='median', add_indicator=True)), ('model', xgb)])
    candidates = {'logistic': logistic, 'xgboost': xgb_pipe}
    scores = {}
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    for name, model in candidates.items():
        fold_scores = []
        for train_idx, valid_idx in cv.split(X_train, y_train):
            fold_model = model
            fold_model.fit(X_train.iloc[train_idx], y_train.iloc[train_idx])
            p_valid = fold_model.predict_proba(X_train.iloc[valid_idx])[:, 1]
            fold_scores.append({
                'roc_auc': safe_metric(roc_auc_score, y_train.iloc[valid_idx], p_valid),
                'pr_auc': safe_metric(average_precision_score, y_train.iloc[valid_idx], p_valid),
            })
        # 仅用训练集内部交叉验证选择候选模型，测试集只用于最终一次性评估。
        model.fit(X_train, y_train)
        p = model.predict_proba(X_test)[:, 1]
        scores[name] = {
            'cv_roc_auc_mean': float(np.nanmean([x['roc_auc'] for x in fold_scores])),
            'cv_pr_auc_mean': float(np.nanmean([x['pr_auc'] for x in fold_scores])),
            'test_roc_auc': safe_metric(roc_auc_score, y_test, p),
            'test_pr_auc': safe_metric(average_precision_score, y_test, p),
            'test_brier': safe_metric(brier_score_loss, y_test, p),
        }
    # 以训练集 CV 的 PR-AUC 优先，AUROC 次之；不使用测试集挑模型。
    best_name = max(scores, key=lambda n: (scores[n]['cv_pr_auc_mean'], scores[n]['cv_roc_auc_mean']))
    base = candidates[best_name]
    calibrated = CalibratedClassifierCV(base, method='sigmoid', cv=3, n_jobs=1)
    calibrated.fit(X_train, y_train)
    p_test = calibrated.predict_proba(X_test)[:, 1]
    metrics = {
        'roc_auc': safe_metric(roc_auc_score, y_test, p_test),
        'pr_auc': safe_metric(average_precision_score, y_test, p_test),
        'brier': safe_metric(brier_score_loss, y_test, p_test),
        'n_test': int(len(y_test)), 'positive_test': int(y_test.sum()),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(calibrated, out_dir / f'{disease}_calibrated.joblib')
    metadata = {
        'disease': disease, 'task': 'Wave1→Wave2 incidence', 'model': best_name,
        'features': features, 'n_total': int(len(df)), 'n_positive': int(y.sum()),
        'positive_rate': float(y.mean()), 'candidate_scores': scores,
        'test_metrics_calibrated': metrics, 'random_state': 42,
        'experiment_run_id': run_id, 'data_manifest_id': data_manifest_id,
        'pipeline': 'multidisease_baseline',
        'dataset_artifact': csv_path.as_posix(),
        'disclaimer': '队列风险筛查模型，不是诊断；需要外部验证后才能用于临床。',
    }
    (out_dir / f'{disease}_model_metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    return metadata


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--datasets', default=str(Path(__file__).parent / 'datasets'))
    ap.add_argument('--out', default=str(Path(__file__).parent / 'models'))
    args = ap.parse_args()
    run_id = new_run_id('risk-multidisease')
    reports = []
    for csv_path in sorted(Path(args.datasets).glob('*_incidence_w1w2.csv')):
        reports.append(train_one(csv_path, Path(args.out), run_id))
    write_manifest(build_manifest(
        run_id=run_id, task='多疾病 Wave1→Wave2 风险筛查',
        data_version='charls_w1w2_incidence.v2', model_version='multidisease-baseline.v2',
        parameters={'test_size': 0.2, 'random_state': 42, 'cv': 'StratifiedKFold(5)', 'selection': 'CV PR-AUC then ROC-AUC'},
        outputs=[str(Path(args.out) / f'{d}_model_metadata.json') for d in ('hypertension','diabetes','heart_disease','stroke')],
        project_root=Path(__file__).resolve().parent.parent
    ), Path(args.out).parent.parent / 'reports' / f'{run_id}.json')
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
