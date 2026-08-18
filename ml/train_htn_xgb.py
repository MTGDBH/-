# -*- coding: utf-8 -*-
"""
Phase 1.5: CHARLS 高血压新发预测 XGBoost 基线建模（可重复执行）

任务: Wave1(2011) 特征 → Wave2(2013) 两年高血压新发预测（二分类）
主数据集:   ml/data/htn_incidence/hypertension_incidence_w1w2.csv        (n=10619, pos=494, 4.65%)
敏感性数据: ml/data/htn_incidence/hypertension_incidence_w1w2_sensitivity.csv (n=7968, pos=252, 3.16%)

流程:
  1) 数据检查（ID 去重 / inf / 缺失率 / 特征清单）
  2) 独立 test set 20%（stratify, random_state=42），仅用于最终评估
  3) 训练集内部 StratifiedKFold(5) 交叉验证（baseline 参数，不做调参）
  4) 全量训练集训练最终模型，XGBoost 原生 NaN 缺失处理（不做全局填充）
  5) 输出: gain importance + permutation importance (top15)
  6) 严格敏感性分析: 同参数同流程在 sensitivity 数据集上独立训练验证（不合并）
  7) 保存模型(JSON) + 元数据 + 报告；最终验证模型可重载且预测一致

运行: 在项目根目录执行  python ml/train_htn_xgb.py
       （推荐使用受管 venv: <venv>/Scripts/python.exe ml/train_htn_xgb.py）
"""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.inspection import permutation_importance
from sklearn.metrics import (average_precision_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import StratifiedKFold, train_test_split

# ============ 路径 ============
PROJECT_ROOT = Path(__file__).resolve().parent.parent
MAIN_CSV = PROJECT_ROOT / 'ml' / 'data' / 'htn_incidence' / 'hypertension_incidence_w1w2.csv'
SENS_CSV = PROJECT_ROOT / 'ml' / 'data' / 'htn_incidence' / 'hypertension_incidence_w1w2_sensitivity.csv'
MODEL_DIR = PROJECT_ROOT / 'ml' / 'models' / 'htn_xgb'
REPORT_DIR = PROJECT_ROOT / 'ml' / 'reports' / 'htn_xgb'
MODEL_DIR.mkdir(parents=True, exist_ok=True)
REPORT_DIR.mkdir(parents=True, exist_ok=True)

# ============ 配置 ============
EXCLUDE_COLS = {'ID', 'wave1', 'y_htn_incidence'}   # 非特征列
RANDOM_STATE = 42
TEST_SIZE = 0.2
N_FOLDS = 5
THRESHOLD = 0.5  # 仅工程默认阈值，非医学最优阈值；后续单独做 threshold optimization

BASE_PARAMS = {
    'objective': 'binary:logistic',
    'eval_metric': 'auc',
    'random_state': RANDOM_STATE,
    'n_estimators': 300,
    'learning_rate': 0.05,
    'max_depth': 3,
    'subsample': 0.8,
    'colsample_bytree': 0.8,
    'tree_method': 'hist',
}


# ============ 工具函数 ============
def load_dataset(csv_path):
    """读取数据集并做基础检查，返回 (X, y, feature_names)"""
    df = pd.read_csv(csv_path)
    assert not df['ID'].duplicated().any(), f'{csv_path.name}: ID 重复!'
    assert set(df['y_htn_incidence'].unique()) <= {0, 1}, 'Y 应为 0/1'
    features = [c for c in df.columns if c not in EXCLUDE_COLS]
    X = df[features]
    y = df['y_htn_incidence'].astype(int)

    # 泄漏防护断言
    forbidden = {'hibpe', 'hibpe_1', 'wave', 'systo1', 'systo2', 'systo3', 'diasto1', 'diasto2', 'diasto3'}
    overlap = set(features) & forbidden
    assert not overlap, f'X 中出现禁止特征: {overlap}'

    # inf 检查（inf 会被 XGBoost 当作缺失，需显式转 NaN 或报告）
    for c in features:
        s = X[c]
        if s.dtype.kind in 'fi':
            inf_n = int(np.isinf(s).sum())
            if inf_n:
                print(f'  ⚠️ 特征 {c} 含 {inf_n} 个 inf → 转 NaN')
                X[c] = s.replace([np.inf, -np.inf], np.nan)
    return X, y, features


def compute_metrics(y_true, prob, threshold=THRESHOLD):
    """完整评估指标集（threshold 仅用于 confusion matrix 与 precision/recall/f1/specificity）"""
    pred = (prob >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred).ravel()
    return {
        'roc_auc': float(roc_auc_score(y_true, prob)),
        'pr_auc_ap': float(average_precision_score(y_true, prob)),
        'precision': float(precision_score(y_true, pred, zero_division=0)),
        'recall': float(recall_score(y_true, pred)),
        'f1': float(f1_score(y_true, pred, zero_division=0)),
        'specificity': float(tn / (tn + fp)) if (tn + fp) else 0.0,
        'confusion_matrix': {'tn': int(tn), 'fp': int(fp), 'fn': int(fn), 'tp': int(tp)},
        'threshold_used': threshold,
    }


def run_cv(X, y, features):
    """StratifiedKFold 交叉验证；scale_pos_weight 按每折训练集计算（不泄漏）"""
    skf = StratifiedKFold(n_splits=N_FOLDS, shuffle=True, random_state=RANDOM_STATE)
    rows = []
    params_used = None
    for fold, (tr_idx, va_idx) in enumerate(skf.split(X, y)):
        X_tr, X_va = X.iloc[tr_idx], X.iloc[va_idx]
        y_tr, y_va = y.iloc[tr_idx], y.iloc[va_idx]
        spw = float((y_tr == 0).sum() / (y_tr == 1).sum())
        params_used = {**BASE_PARAMS, 'scale_pos_weight': round(spw, 4)}
        model = xgb.XGBClassifier(**params_used)
        model.fit(X_tr, y_tr)          # XGBoost 原生 NaN 处理，不做填充
        prob = model.predict_proba(X_va)[:, 1]
        rows.append({
            'fold': fold + 1,
            'n_train': int(len(X_tr)),
            'n_pos_train': int(y_tr.sum()),
            'n_neg_train': int((y_tr == 0).sum()),
            'scale_pos_weight': params_used['scale_pos_weight'],
            'roc_auc': float(roc_auc_score(y_va, prob)),
            'pr_auc_ap': float(average_precision_score(y_va, prob)),
        })
    cv_df = pd.DataFrame(rows)
    return cv_df, params_used


def train_final(X_tr, y_tr, params):
    model = xgb.XGBClassifier(**params)
    model.fit(X_tr, y_tr)
    return model


def gain_importance(model, features):
    score_map = model.get_booster().get_score(importance_type='gain')
    df = pd.DataFrame({
        'feature': features,
        'gain': [score_map.get(f, 0.0) for f in features],
    }).sort_values('gain', ascending=False).reset_index(drop=True)
    # 归一化为 0-100 便于展示
    if df['gain'].max() > 0:
        df['gain_normalized'] = (df['gain'] / df['gain'].max() * 100).round(2)
    return df


def main():
    t0 = time.time()
    print('=' * 60)
    print('Phase 1.5: XGBoost 高血压新发预测基线建模')
    print('=' * 60)

    # ---------- 1. 数据 ----------
    print('\n[1] 加载主数据集')
    X, y, features = load_dataset(MAIN_CSV)
    print(f'  主数据集: {X.shape} | 特征数: {len(features)} | Y=1: {int(y.sum())} ({y.mean()*100:.2f}%)')
    miss = X.isna().mean()
    print('  缺失率 >30% 的特征:', {c: f'{v*100:.0f}%' for c, v in miss.items() if v > 0.3})

    # ---------- 2. 数据划分 ----------
    print('\n[2] 划分 test set (20%, stratify, random_state=42)')
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=TEST_SIZE,
                                              stratify=y, random_state=RANDOM_STATE)
    print(f'  训练集: {X_tr.shape} | pos: {int(y_tr.sum())} ({y_tr.mean()*100:.2f}%) | '
          f'test: {X_te.shape} | pos: {int(y_te.sum())} ({y_te.mean()*100:.2f}%)')

    # ---------- 3. 5-fold CV ----------
    print('\n[3] StratifiedKFold(5) 交叉验证')
    cv_df, final_params = run_cv(X_tr, y_tr, features)
    print(cv_df.to_string(index=False))
    print(f'  CV AUC: {cv_df.roc_auc.mean():.4f} ± {cv_df.roc_auc.std():.4f}')
    print(f'  CV PR-AUC: {cv_df.pr_auc_ap.mean():.4f} ± {cv_df.pr_auc_ap.std():.4f}')
    cv_df.to_csv(REPORT_DIR / 'cv_results.csv', index=False, encoding='utf-8-sig')

    # ---------- 4. 最终模型（全量训练集）+ test 评估 ----------
    print('\n[4] 训练最终模型 + test 评估')
    final_params = {**BASE_PARAMS, 'scale_pos_weight': round(float((y_tr == 0).sum() / (y_tr == 1).sum()), 4)}
    model = train_final(X_tr, y_tr, final_params)
    test_prob = model.predict_proba(X_te)[:, 1]
    test_metrics = compute_metrics(y_te, test_prob)
    print('  test metrics:', json.dumps(test_metrics, ensure_ascii=False, indent=2))

    # ---------- 5. 特征重要性 ----------
    print('\n[5] 特征重要性')
    gain_df = gain_importance(model, features)
    gain_top = gain_df.head(15).copy()
    gain_top.to_csv(MODEL_DIR / 'feature_importance.csv', index=False, encoding='utf-8-sig')

    perm = permutation_importance(model, X_tr, y_tr, n_repeats=10,
                                  random_state=RANDOM_STATE, scoring='roc_auc')
    perm_df = pd.DataFrame({
        'feature': features,
        'perm_importance_mean': perm.importances_mean,
        'perm_importance_std': perm.importances_std,
    }).sort_values('perm_importance_mean', ascending=False).reset_index(drop=True)
    perm_top = perm_df.head(15).copy()
    perm_top.to_csv(MODEL_DIR / 'permutation_importance.csv', index=False, encoding='utf-8-sig')
    print('  gain top5:', gain_top['feature'].head(5).tolist())
    print('  perm top5:', perm_top['feature'].head(5).tolist())

    # ---------- 6. 保存模型 + 元数据 ----------
    model_path = MODEL_DIR / 'baseline_model.json'
    model.save_model(model_path)
    metadata = {
        'task': 'Wave1→Wave2 两年高血压新发预测 (二分类)',
        'dataset_version': 'htn_incidence_w1w2 v1 (主数据集)',
        'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'xgb_version': xgb.__version__,
        'random_state': RANDOM_STATE,
        'test_split': {'ratio': TEST_SIZE, 'stratify': True, 'random_state': RANDOM_STATE},
        'cv': {'method': 'StratifiedKFold', 'n_splits': N_FOLDS, 'shuffle': True, 'random_state': RANDOM_STATE},
        'params': final_params,
        'feature_names': features,
        'n_features': len(features),
        'n_train': int(len(X_tr)),
        'n_test': int(len(X_te)),
        'n_pos_train': int(y_tr.sum()),
        'n_neg_train': int((y_tr == 0).sum()),
        'n_pos_test': int(y_te.sum()),
        'n_neg_test': int((y_te == 0).sum()),
        'threshold': THRESHOLD,
        'threshold_note': '0.5 仅为工程默认阈值，非医学最优阈值；后续 Phase 单独做 threshold optimization',
        'missing_handling': 'XGBoost 原生 NaN（未做全局均值填充，未使用 test set 统计量）',
        'test_metrics': test_metrics,
        'cv_mean': {'roc_auc': round(float(cv_df.roc_auc.mean()), 4),
                    'pr_auc_ap': round(float(cv_df.pr_auc_ap.mean()), 4),
                    'roc_auc_std': round(float(cv_df.roc_auc.std()), 4),
                    'pr_auc_ap_std': round(float(cv_df.pr_auc_ap.std()), 4)},
        'train_time_sec': round(time.time() - t0, 2),
        'shap': 'skipped (shap 未安装，未新增依赖)',
    }
    with open(MODEL_DIR / 'model_metadata.json', 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    print(f'  模型已保存: {model_path}')

    # ---------- 7. 敏感性分析（独立流程，同参数） ----------
    print('\n[6] 严格敏感性分析（sensitivity 数据集，同参数独立训练）')
    Xs, ys, _feats = load_dataset(SENS_CSV)
    Xs_tr, Xs_te, ys_tr, ys_te = train_test_split(Xs, ys, test_size=TEST_SIZE,
                                                  stratify=ys, random_state=RANDOM_STATE)
    spw_s = round(float((ys_tr == 0).sum() / (ys_tr == 1).sum()), 4)
    sens_params = {**BASE_PARAMS, 'scale_pos_weight': spw_s}
    sens_model = train_final(Xs_tr, ys_tr, sens_params)
    sens_prob = sens_model.predict_proba(Xs_te)[:, 1]
    sens_metrics = compute_metrics(ys_te, sens_prob)
    sens_metrics['n_train'] = int(len(Xs_tr))
    sens_metrics['n_test'] = int(len(Xs_te))
    sens_metrics['n_pos_test'] = int(ys_te.sum())
    sens_metrics['n_neg_test'] = int((ys_te == 0).sum())
    sens_metrics['note'] = 'sensitivity 数据集独立训练/独立评估，未与主数据集合并，未充当 test set'
    with open(REPORT_DIR / 'sensitivity_metrics.json', 'w', encoding='utf-8') as f:
        json.dump(sens_metrics, f, ensure_ascii=False, indent=2)
    print('  sensitivity test:', json.dumps({k: v for k, v in sens_metrics.items() if k != 'note'},
                                            ensure_ascii=False, indent=2))

    with open(REPORT_DIR / 'test_metrics.json', 'w', encoding='utf-8') as f:
        json.dump(test_metrics, f, ensure_ascii=False, indent=2)

    # ---------- 8. 最终验证：模型重载 + 概率一致 ----------
    print('\n[7] 最终验证：模型重载')
    reloaded = xgb.XGBClassifier()
    reloaded.load_model(model_path)
    reloaded_prob = reloaded.predict_proba(X_te)[:, 1]
    identical = np.allclose(test_prob, reloaded_prob, rtol=1e-8, atol=1e-10)
    print(f'  重载后预测与首次一致: {identical}')
    assert identical, '模型重载预测不一致!'
    # 特征顺序验证
    meta_feats = metadata['feature_names']
    assert list(X_te.columns) == meta_feats, '特征顺序与训练时不一致!'
    print('  特征顺序与元数据一致 ✅')

    # ---------- 9. 报告 ----------
    report = f"""# Phase 1.5 XGBoost 基线建模报告

## 数据集
- 主数据集: {MAIN_CSV.name} | n={len(X)}, Y=1={int(y.sum())} ({y.mean()*100:.2f}%)
- test 划分: 20%, stratify, random_state=42（仅用于最终评估）

## 模型参数（baseline，未调参）
```json
{json.dumps(final_params, ensure_ascii=False, indent=2)}
```

## 5-Fold CV（训练集内部）
- ROC-AUC: {cv_df.roc_auc.mean():.4f} ± {cv_df.roc_auc.std():.4f}
- PR-AUC:  {cv_df.pr_auc_ap.mean():.4f} ± {cv_df.pr_auc_ap.std():.4f}
- 逐折明细见 cv_results.csv

## Test 结果（threshold={THRESHOLD}，仅工程默认值）
- ROC-AUC: {test_metrics['roc_auc']:.4f}
- PR-AUC:  {test_metrics['pr_auc_ap']:.4f}
- Precision: {test_metrics['precision']:.4f} | Recall: {test_metrics['recall']:.4f} | F1: {test_metrics['f1']:.4f} | Specificity: {test_metrics['specificity']:.4f}
- Confusion: {json.dumps(test_metrics['confusion_matrix'])}
- 注意: 阳性率仅 {y.mean()*100:.2f}%，Accuracy 不是核心指标；threshold=0.5 非医学最优，后续单独优化

## 特征重要性 Top15
### Gain（见 feature_importance.csv）
{ gain_top.to_string(index=False) }

### Permutation（见 permutation_importance.csv）
{ perm_top.to_string(index=False) }

## 严格敏感性分析（同参数独立训练，不合并数据）
- sensitivity 数据集: n={len(Xs)}, Y=1={int(ys.sum())} ({ys.mean()*100:.2f}%)
- test ROC-AUC: {sens_metrics['roc_auc']:.4f} | test PR-AUC: {sens_metrics['pr_auc_ap']:.4f}
- 对比: 主数据集 test AUC {test_metrics['roc_auc']:.4f} / PR-AUC {test_metrics['pr_auc_ap']:.4f}
- 说明: sensitivity 版为"纯净新发"定义（排除基线血检已检出者），事件更稀，指标通常更低属预期

## 数据泄漏检查
- ✅ ID/wave 未进入模型；Y 仅来自 Wave2；X 仅来自 Wave1
- ✅ hibpe/hibpe_1 不在特征中；test set 未参与训练/调参/任何拟合
- ✅ 缺失处理使用 XGBoost 原生 NaN，无全局填充、无 test 统计量
- ✅ 模型重载预测一致性验证通过

## SHAP
- 未安装 shap（按要求未新增依赖），已跳过；后续阶段如需可安装后补充

## 文件位置
- 模型: {model_path}
- 元数据: {MODEL_DIR / 'model_metadata.json'}
- CV: {REPORT_DIR / 'cv_results.csv'} | Test: {REPORT_DIR / 'test_metrics.json'} | Sensitivity: {REPORT_DIR / 'sensitivity_metrics.json'}
"""
    with open(REPORT_DIR / 'baseline_report.md', 'w', encoding='utf-8') as f:
        f.write(report)
    print(f'\n报告已生成: {REPORT_DIR / "baseline_report.md"}')
    print(f'总耗时: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
