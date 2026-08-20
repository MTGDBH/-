# -*- coding: utf-8 -*-
"""
Phase 1.6: XGBoost 基线优化 + 风险概率校准（产品候选评估）

内容:
  1) 特征消融: A 全32 / B 去exercise+totmet / C APP核心12 / D 核心+人口学+慢病史
  2) education 敏感性: edu 1-4 vs 官方 raeduc_c 10级
  3) 缺失处理对照: 原生NaN vs 训练折内median+missing indicator
  4) Threshold 分析: 在校准后的 OOF 概率上选 F1 / Youden J / Recall优先，test 仅最终应用
  5) Calibration: Platt/Sigmoid vs Isotonic（仅用训练集内 OOF 拟合）
  6) 最终模型选择（CV 指标 + APP 可获得性，非仅 AUC）
  7) SHAP 跳过（未安装）

运行: 在项目根目录  python ml/train_htn_xgb_phase16.py
"""
import json
import pickle
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix,
                             f1_score, precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import StratifiedKFold, train_test_split

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / 'ml' / 'data' / 'htn_incidence'
MODEL_DIR = PROJECT_ROOT / 'ml' / 'models' / 'htn_xgb'
REPORT_DIR = PROJECT_ROOT / 'ml' / 'reports' / 'htn_xgb'
MODEL_DIR.mkdir(parents=True, exist_ok=True)
REPORT_DIR.mkdir(parents=True, exist_ok=True)

MAIN_CSV = DATA_DIR / 'hypertension_incidence_w1w2.csv'
EDU10_CSV = DATA_DIR / 'hypertension_incidence_w1w2_edu10.csv'
SENS_CSV = DATA_DIR / 'hypertension_incidence_w1w2_sensitivity.csv'

RANDOM_STATE = 42
TEST_SIZE = 0.2
N_FOLDS = 5
EXCLUDE = {'ID', 'wave1', 'y_htn_incidence'}

BASE_PARAMS = dict(objective='binary:logistic', eval_metric='auc', random_state=RANDOM_STATE,
                   n_estimators=300, learning_rate=0.05, max_depth=2, min_child_weight=3,
                   subsample=0.8, colsample_bytree=0.8, tree_method='hist')
POS_WEIGHT = 1.0  # 保留原始概率尺度，避免 class weight 造成过度自信；类别不平衡由 PR-AUC/阈值处理。

APP_CORE = ['systo', 'diasto', 'pulse', 'bmi', 'mwaist', 'lgrip', 'rgrip',
            'bl_glu', 'bl_hbalc', 'bl_cho', 'bl_ua', 'sleep']
DEMO = ['age', 'gender', 'edu']
DISEASE = ['chronic', 'diabe', 'hearte', 'stroke', 'dyslipe', 'lunge']


def load(csv_path):
    df = pd.read_csv(csv_path)
    df['ID'] = df['ID'].astype(str)
    features = [c for c in df.columns if c not in EXCLUDE]
    return df, features


def run_cv(X, y, collect_oof=False):
    """StratifiedKFold CV；返回 (cv_df, oof_prob 或 None)"""
    skf = StratifiedKFold(n_splits=N_FOLDS, shuffle=True, random_state=RANDOM_STATE)
    rows, oof = [], np.zeros(len(y))
    for fold, (tr, va) in enumerate(skf.split(X, y)):
        Xtr, ytr, Xva = X.iloc[tr], y.iloc[tr], X.iloc[va]
        spw = POS_WEIGHT
        m = xgb.XGBClassifier(**{**BASE_PARAMS, 'scale_pos_weight': spw})
        m.fit(Xtr, ytr)
        p = m.predict_proba(Xva)[:, 1]
        if collect_oof:
            oof[va] = p
        rows.append({'fold': fold + 1, 'roc_auc': roc_auc_score(y.iloc[va], p),
                     'pr_auc': average_precision_score(y.iloc[va], p)})
    return pd.DataFrame(rows), (oof if collect_oof else None)


def train_eval(Xtr, ytr, Xte, yte):
    spw = POS_WEIGHT
    m = xgb.XGBClassifier(**{**BASE_PARAMS, 'scale_pos_weight': spw})
    m.fit(Xtr, ytr)
    p = m.predict_proba(Xte)[:, 1]
    return m, p


def full_metrics(y, p, thr=0.5):
    pred = (p >= thr).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred).ravel()
    return dict(roc_auc=float(roc_auc_score(y, p)), pr_auc=float(average_precision_score(y, p)),
                precision=float(precision_score(y, pred, zero_division=0)),
                recall=float(recall_score(y, pred)), f1=float(f1_score(y, pred, zero_division=0)),
                specificity=float(tn / (tn + fp)) if (tn + fp) else 0.0,
                sensitivity=float(tp / (tp + fn)) if (tp + fn) else 0.0,
                tn=int(tn), fp=int(fp), fn=int(fn), tp=int(tp))


def median_indicator(Xtr, Xapp, cols):
    """训练集拟合中位数 → 应用并加缺失指示列（仅用训练集统计量）"""
    med = Xtr[cols].median()
    Xtr2, Xap2 = Xtr.copy(), Xapp.copy()
    for c in cols:
        if Xtr[c].isna().any():
            Xtr2[c + '_miss'] = Xtr[c].isna().astype(int)
            Xap2[c + '_miss'] = Xapp[c].isna().astype(int)
            Xtr2[c] = Xtr2[c].fillna(med[c])
            Xap2[c] = Xap2[c].fillna(med[c])
    return Xtr2, Xap2


def main():
    t0 = time.time()
    print('=' * 60)
    print('Phase 1.6: XGBoost 基线优化与概率校准')
    print('=' * 60)

    # ---------- 数据 ----------
    df, all_feats = load(MAIN_CSV)
    df_e10, _ = load(EDU10_CSV)
    y = df['y_htn_incidence'].astype(int)
    X_tr, X_te, y_tr, y_te = train_test_split(df[all_feats], y, test_size=TEST_SIZE,
                                              stratify=y, random_state=RANDOM_STATE)
    e_tr = df_e10[all_feats + ['edu10']].iloc[X_tr.index]
    e_te = df_e10[all_feats + ['edu10']].iloc[X_te.index]
    assert list(X_tr.index) == list(e_tr.index)
    print(f'划分: train {len(X_tr)} (pos {int(y_tr.sum())}) / test {len(X_te)} (pos {int(y_te.sum())})')

    FEATURE_SETS = {
        'A_all32': all_feats,
        'B_no_exercise_totmet': [c for c in all_feats if c not in ('exercise', 'totmet')],
        'C_app_core12': APP_CORE,
        'D_core_demo_disease21': APP_CORE + DEMO + DISEASE,
    }

    # ---------- 1. 特征消融 ----------
    print('\n[1] 特征消融实验')
    ablation = []
    for name, feats in FEATURE_SETS.items():
        cv, _ = run_cv(X_tr[feats], y_tr)
        _, p = train_eval(X_tr[feats], y_tr, X_te[feats], y_te)
        row = {'feature_set': name, 'n_features': len(feats),
               'cv_auc': round(float(cv.roc_auc.mean()), 4), 'cv_auc_std': round(float(cv.roc_auc.std()), 4),
               'cv_prauc': round(float(cv.pr_auc.mean()), 4), 'cv_prauc_std': round(float(cv.pr_auc.std()), 4),
               'test_auc': round(float(roc_auc_score(y_te, p)), 4),
               'test_prauc': round(float(average_precision_score(y_te, p)), 4)}
        ablation.append(row)
        print(f"  {name}: n={len(feats)} CV AUC {row['cv_auc']}±{row['cv_auc_std']} "
              f"PR {row['cv_prauc']}±{row['cv_prauc_std']} | test AUC {row['test_auc']} PR {row['test_prauc']}")

    # ---------- 2. education 敏感性 ----------
    print('\n[2] education 敏感性: edu1-4 vs edu10(官方 raeduc_c)')
    f_e4 = all_feats
    f_e10 = [c for c in all_feats if c != 'edu'] + ['edu10']
    cv4, _ = run_cv(X_tr[f_e4], y_tr)
    cv10, _ = run_cv(e_tr[f_e10], y_tr)
    _, p4 = train_eval(X_tr[f_e4], y_tr, X_te[f_e4], y_te)
    _, p10 = train_eval(e_tr[f_e10], y_tr, e_te[f_e10], y_te)
    edu_rows = [
        {'feature_set': 'E_edu4', 'n_features': len(f_e4),
         'cv_auc': round(float(cv4.roc_auc.mean()), 4), 'cv_auc_std': round(float(cv4.roc_auc.std()), 4),
         'cv_prauc': round(float(cv4.pr_auc.mean()), 4), 'cv_prauc_std': round(float(cv4.pr_auc.std()), 4),
         'test_auc': round(float(roc_auc_score(y_te, p4)), 4),
         'test_prauc': round(float(average_precision_score(y_te, p4)), 4)},
        {'feature_set': 'E_edu10_official', 'n_features': len(f_e10),
         'cv_auc': round(float(cv10.roc_auc.mean()), 4), 'cv_auc_std': round(float(cv10.roc_auc.std()), 4),
         'cv_prauc': round(float(cv10.pr_auc.mean()), 4), 'cv_prauc_std': round(float(cv10.pr_auc.std()), 4),
         'test_auc': round(float(roc_auc_score(y_te, p10)), 4),
         'test_prauc': round(float(average_precision_score(y_te, p10)), 4)},
    ]
    for r in edu_rows:
        print(f"  {r['feature_set']}: CV AUC {r['cv_auc']} PR {r['cv_prauc']} | test AUC {r['test_auc']} PR {r['test_prauc']}")
    ablation += edu_rows
    pd.DataFrame(ablation).to_csv(REPORT_DIR / 'ablation_results.csv', index=False, encoding='utf-8-sig')

    # ---------- 3. 缺失处理对照（A 特征集） ----------
    print('\n[3] 缺失处理对照 (A 特征集): native NaN vs median+indicator')
    cv_native, _ = run_cv(X_tr[all_feats], y_tr)
    skf = StratifiedKFold(n_splits=N_FOLDS, shuffle=True, random_state=RANDOM_STATE)
    rows_mi = []
    for fold, (tr, va) in enumerate(skf.split(X_tr, y_tr)):
        Xtr_f, Xva_f = median_indicator(X_tr[all_feats].iloc[tr], X_tr[all_feats].iloc[va], all_feats)
        spw = POS_WEIGHT
        m = xgb.XGBClassifier(**{**BASE_PARAMS, 'scale_pos_weight': spw})
        m.fit(Xtr_f, y_tr.iloc[tr])
        p = m.predict_proba(Xva_f)[:, 1]
        rows_mi.append({'fold': fold + 1, 'roc_auc': roc_auc_score(y_tr.iloc[va], p),
                        'pr_auc': average_precision_score(y_tr.iloc[va], p)})
    cv_mi = pd.DataFrame(rows_mi)
    _, p_native = train_eval(X_tr[all_feats], y_tr, X_te[all_feats], y_te)
    Xtr_full, Xte_full = median_indicator(X_tr[all_feats], X_te[all_feats], all_feats)
    _, p_mi = train_eval(Xtr_full, y_tr, Xte_full, y_te)
    missing_rows = [
        {'strategy': 'native_nan',
         'cv_auc': round(float(cv_native.roc_auc.mean()), 4), 'cv_prauc': round(float(cv_native.pr_auc.mean()), 4),
         'test_auc': round(float(roc_auc_score(y_te, p_native)), 4),
         'test_prauc': round(float(average_precision_score(y_te, p_native)), 4)},
        {'strategy': 'median_indicator',
         'cv_auc': round(float(cv_mi.roc_auc.mean()), 4), 'cv_prauc': round(float(cv_mi.pr_auc.mean()), 4),
         'test_auc': round(float(roc_auc_score(y_te, p_mi)), 4),
         'test_prauc': round(float(average_precision_score(y_te, p_mi)), 4)},
    ]
    pd.DataFrame(missing_rows).to_csv(REPORT_DIR / 'missing_strategy_results.csv', index=False, encoding='utf-8-sig')
    for r in missing_rows:
        print(f"  {r['strategy']}: CV AUC {r['cv_auc']} PR {r['cv_prauc']} | test AUC {r['test_auc']} PR {r['test_prauc']}")

    # ---------- 4. 模型选择（CV 指标 + APP 可获得性） ----------
    print("\n[4] 模型选择")
    sel = pd.DataFrame(ablation).head(4)
    # APP 可获得性: exercise/totmet 在 APP 无对应且缺失 60% → 排除 A/B（含该二者），C/D 保留
    print("\n[4] 模型选择")
    sel = pd.DataFrame(ablation).head(4)
    # APP 可获得性: 当前 APP 采集 12 项核心指标 + 档案(age/gender/edu) + 慢病史问卷；
    # exercise/totmet(活动量)、srh/cesd10/total_cognition(问卷/认知测试) 当前 APP 不可获得 → 排除 A/B
    app_unavailable = {'exercise', 'totmet', 'srh', 'cesd10', 'total_cognition'}
    app_ok = sel[sel['feature_set'].apply(lambda n: not (set(FEATURE_SETS[n]) & app_unavailable))]
    best = app_ok.sort_values(['cv_prauc', 'n_features'], ascending=[False, True]).iloc[0]
    cand_set, cand_feats = best['feature_set'], FEATURE_SETS[best['feature_set']]
    print(f"  候选特征集: {cand_set} ({len(cand_feats)} 特征), CV PR-AUC {best['cv_prauc']}")
    print('  说明: 排除含 exercise/totmet/srh/cesd10/total_cognition 的集合（APP 当前不可获得）; 依据 CV PR-AUC 选择，未使用 test')

    # ---------- 5. Threshold 分析（校准后的 OOF 训练集内部） ----------
    print('\n[5] Threshold 分析 (校准后 OOF 选择)')
    _, oof_raw = run_cv(X_tr[cand_feats], y_tr, collect_oof=True)
    # 阈值必须和 predict_htn.py 使用的校准概率处于同一尺度。
    # 使用 Platt（logistic）校准：保持概率排序，避免 Isotonic 在小样本分箱后
    # 产生大量相同概率，导致外部人群的排序能力和阈值稳定性下降。
    oof_logit_for_threshold = np.log(np.clip(oof_raw, 1e-6, 1 - 1e-6) /
                                     np.clip(1 - oof_raw, 1e-6, 1))
    platt_for_threshold = LogisticRegression(max_iter=1000).fit(
        oof_logit_for_threshold.reshape(-1, 1), y_tr)
    oof_cal = platt_for_threshold.predict_proba(
        oof_logit_for_threshold.reshape(-1, 1))[:, 1]
    grid = np.unique(np.round(oof_cal, 4))

    def _f1(t): return f1_score(y_tr, (oof_cal >= t).astype(int), zero_division=0)
    def _youden(t):
        tn, fp, fn, tp = confusion_matrix(y_tr, (oof_cal >= t).astype(int)).ravel()
        return tp / (tp + fn) + tn / (tn + fp) - 1
    def _spec(t):
        tn, fp, fn, tp = confusion_matrix(y_tr, (oof_cal >= t).astype(int)).ravel()
        return tn / (tn + fp)
    def _recall(t): return recall_score(y_tr, (oof_cal >= t).astype(int), zero_division=0)

    t_f1 = max(grid, key=_f1)
    t_youden = max(grid, key=_youden)
    spec_ok = [t for t in grid if _spec(t) >= 0.60]
    t_recall = max(spec_ok, key=_recall) if spec_ok else 0.5

    _, cand_test_raw = train_eval(X_tr[cand_feats], y_tr, X_te[cand_feats], y_te)
    cand_test_logit = np.log(np.clip(cand_test_raw, 1e-6, 1 - 1e-6) /
                              np.clip(1 - cand_test_raw, 1e-6, 1))
    cand_test_prob = platt_for_threshold.predict_proba(
        cand_test_logit.reshape(-1, 1))[:, 1]
    thr_rows = []
    for name, t in [('threshold_0.5', 0.5), ('F1_max', t_f1), ('Youden_J', t_youden), ('Recall_priority', t_recall)]:
        om = full_metrics(y_tr, oof_cal, t)
        tm = full_metrics(y_te, cand_test_prob, t)
        thr_rows.append({'candidate': name, 'threshold': round(float(t), 4), 'selected_on': 'calibrated_oof(train only)',
                         'oof_precision': om['precision'], 'oof_recall': om['recall'], 'oof_f1': om['f1'],
                         'oof_specificity': om['specificity'], 'oof_sensitivity': om['sensitivity'],
                         'test_precision': tm['precision'], 'test_recall': tm['recall'], 'test_f1': tm['f1'],
                         'test_specificity': tm['specificity'], 'test_sensitivity': tm['sensitivity']})
    print(f"  校准后 OOF 候选: 0.5 / F1={t_f1:.4f} / Youden={t_youden:.4f} / Recall优先={t_recall:.4f}")
    pd.DataFrame(thr_rows).to_csv(REPORT_DIR / 'threshold_analysis.csv', index=False, encoding='utf-8-sig')

    rec_thr = float(t_youden)  # 推荐: Youden J（OOF 选出）
    thr_json = {'recommended_threshold': round(rec_thr, 4),
                 'selection_method': 'Youden J 最大化，在训练集 OOF 的 Platt 校准概率上选择，未使用 test',
                 'probability_scale': 'platt_calibrated',
                 'note': '0.5 仅为工程默认值，非医学最优；线上比较校准后概率',
                'candidates': [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()} for r in thr_rows]}
    with open(MODEL_DIR / 'threshold.json', 'w', encoding='utf-8') as f:
        json.dump(thr_json, f, ensure_ascii=False, indent=2)

    # ---------- 6. Calibration（仅 OOF 拟合） ----------
    print('\n[6] 概率校准 (Platt vs Isotonic, OOF 拟合)')
    oof_logit = np.log(np.clip(oof_raw, 1e-6, 1 - 1e-6) / np.clip(1 - oof_raw, 1e-6, 1))
    platt = LogisticRegression(max_iter=1000).fit(oof_logit.reshape(-1, 1), y_tr)
    iso = IsotonicRegression(out_of_bounds='clip').fit(oof_raw, y_tr)
    test_logit = np.log(np.clip(cand_test_raw, 1e-6, 1 - 1e-6) / np.clip(1 - cand_test_raw, 1e-6, 1))
    # LogisticRegression.predict() 返回类别标签；校准概率必须使用 predict_proba。
    p_platt = platt.predict_proba(test_logit.reshape(-1, 1))[:, 1]
    p_iso = iso.predict(cand_test_raw)
    brier_raw = float(brier_score_loss(y_te, cand_test_raw))
    brier_platt = float(brier_score_loss(y_te, p_platt))
    brier_iso = float(brier_score_loss(y_te, p_iso))
    print(f"  Brier: raw={brier_raw:.4f} platt={brier_platt:.4f} isotonic={brier_iso:.4f}")

    def _curve(p):
        bins, out = np.linspace(0, 1, 11), []
        for i in range(10):
            m_ = (p >= bins[i]) & (p < bins[i + 1])
            if m_.sum() == 0:
                continue
            out.append({'bin_mid': round(float((bins[i] + bins[i + 1]) / 2), 3),
                        'mean_pred': round(float(p[m_].mean()), 4), 'frac_pos': round(float(y_te[m_].mean()), 4)})
        return out

    lr_diag = LogisticRegression(max_iter=1000).fit(test_logit.reshape(-1, 1), y_te)
    calib = {'brier_raw': brier_raw, 'brier_platt': brier_platt, 'brier_isotonic': brier_iso,
             'calibration_slope_raw': round(float(lr_diag.coef_[0][0]), 4),
             'calibration_intercept_raw': round(float(lr_diag.intercept_[0]), 4),
              'calibration_curve_raw': _curve(cand_test_raw),
             'calibration_curve_platt': _curve(p_platt),
             'calibration_curve_isotonic': _curve(p_iso),
             'note': '校准器仅在训练集 OOF 原始概率上拟合; threshold 也在校准后 OOF 概率上选择; slope/intercept 为 test 诊断值'}
    with open(REPORT_DIR / 'calibration_results.json', 'w', encoding='utf-8') as f:
        json.dump(calib, f, ensure_ascii=False, indent=2)
    with open(MODEL_DIR / 'calibrator_platt.pkl', 'wb') as f:
        pickle.dump(platt, f)
    with open(MODEL_DIR / 'calibrator_isotonic.pkl', 'wb') as f:
        pickle.dump(iso, f)

    # ---------- 7. 最终候选模型 ----------
    print('\n[7] 保存最终候选模型')
    spw = POS_WEIGHT
    cand_model = xgb.XGBClassifier(**{**BASE_PARAMS, 'scale_pos_weight': spw})
    cand_model.fit(X_tr[cand_feats], y_tr)
    cand_model.save_model(MODEL_DIR / 'candidate_model.json')
    gain = cand_model.get_booster().get_score(importance_type='gain')
    imp = pd.DataFrame({'feature': cand_feats,
                        'gain': [gain.get(f, 0.0) for f in cand_feats]}).sort_values('gain', ascending=False)
    imp['gain_normalized'] = (imp['gain'] / imp['gain'].max() * 100).round(2)
    imp.to_csv(MODEL_DIR / 'feature_importance.csv', index=False, encoding='utf-8-sig')

    meta = {'task': 'Wave1→Wave2 两年高血压新发预测', 'dataset_version': 'htn_incidence_w1w2 v1',
            'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'xgb_version': xgb.__version__, 'random_state': RANDOM_STATE,
            'feature_set': cand_set, 'feature_names': cand_feats,
            'params': {**BASE_PARAMS, 'scale_pos_weight': spw},
            'n_train': int(len(X_tr)), 'n_test': int(len(X_te)),
            'n_pos_train': int(y_tr.sum()), 'n_neg_train': int((y_tr == 0).sum()),
            'recommended_threshold': round(rec_thr, 4),
            'threshold_note': 'Youden J 最大化，在 Platt 校准后的 OOF 概率上选择，未用 test',
            'missing_handling': 'XGBoost 原生 NaN',
            'calibration': {'platt': {'brier': brier_platt, 'file': 'calibrator_platt.pkl'},
                            'isotonic': {'brier': brier_iso, 'file': 'calibrator_isotonic.pkl'},
                            'selected': 'platt',
                            'selection_note': '固定使用 Platt；不使用 test Brier 选择校准器'},
            'ablation_summary': ablation, 'missing_strategy': missing_rows}
    with open(MODEL_DIR / 'candidate_metadata.json', 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f'  候选模型: {MODEL_DIR / "candidate_model.json"}')

    # ---------- 8. 最终验证 ----------
    print('\n[8] 最终验证')
    reloaded = xgb.XGBClassifier()
    reloaded.load_model(MODEL_DIR / 'candidate_model.json')
    rp = reloaded.predict_proba(X_te[cand_feats])[:, 1]
    assert np.allclose(rp, cand_test_raw, rtol=1e-8, atol=1e-10), '重载预测不一致!'
    assert list(X_te[cand_feats].columns) == cand_feats, '特征顺序不一致!'
    with open(MODEL_DIR / 'calibrator_platt.pkl', 'rb') as f:
        platt2 = pickle.load(f)
    reload_logit = np.log(np.clip(cand_test_raw, 1e-6, 1 - 1e-6) /
                          np.clip(1 - cand_test_raw, 1e-6, 1))
    assert np.allclose(platt2.predict_proba(reload_logit.reshape(-1, 1))[:, 1],
                       p_platt, rtol=1e-6, atol=1e-8), 'calibrator 重载不一致!'
    print('  模型重载 ✅ 预测一致 ✅ 特征顺序 ✅ calibrator 重载 ✅')

    # ---------- 9. Sensitivity 外部验证（候选模型直接应用，不训练） ----------
    print('\n[9] Sensitivity 数据集外部验证（候选模型直接预测）')
    sdf, _ = load(SENS_CSV)
    sy = sdf['y_htn_incidence'].astype(int)
    sp_raw = cand_model.predict_proba(sdf[cand_feats])[:, 1]
    sp_logit = np.log(np.clip(sp_raw, 1e-6, 1 - 1e-6) /
                      np.clip(1 - sp_raw, 1e-6, 1))
    sp = platt.predict_proba(sp_logit.reshape(-1, 1))[:, 1]
    sens_ext = {'note': '候选模型(主数据训练)应用 Platt 校准后直接预测 sensitivity，全样本未重新训练',
                'n': int(len(sy)), 'pos': int(sy.sum()),
                'roc_auc': round(float(roc_auc_score(sy, sp)), 4),
                'pr_auc': round(float(average_precision_score(sy, sp)), 4),
                'brier': round(float(brier_score_loss(sy, sp)), 4)}
    print(f"  {sens_ext}")
    with open(REPORT_DIR / 'sensitivity_metrics.json', 'w', encoding='utf-8') as f:
        json.dump(sens_ext, f, ensure_ascii=False, indent=2)

    # ---------- 10. 报告 ----------
    test_at_rec = full_metrics(y_te, cand_test_prob, rec_thr)
    test_at_05 = full_metrics(y_te, cand_test_prob, 0.5)
    report = f"""# Phase 1.6 报告：XGBoost 基线优化与概率校准

## 1. 特征消融（test 仅最终评估）
{ pd.DataFrame(ablation).to_string(index=False) }

## 2. education 敏感性
- edu(1-4) vs 官方 raeduc_c(10级): 见上表 E_edu4 / E_edu10
- edu10 匹配率 70.9%（29% 缺失，原生 NaN 处理）；APP 不采集 10 级教育 → 最终保留 edu(1-4)

## 3. 缺失处理对照（A 特征集）
{ pd.DataFrame(missing_rows).to_string(index=False) }

## 4. Threshold（OOF 选择，test 仅应用）
{ pd.DataFrame(thr_rows).to_string(index=False) }
推荐: threshold={rec_thr:.4f}（Youden J，OOF 选择）

## 5. Calibration（OOF 拟合）
- Brier: raw={brier_raw:.4f} | Platt={brier_platt:.4f} | Isotonic={brier_iso:.4f}
- 诊断 slope/intercept(raw): {calib['calibration_slope_raw']} / {calib['calibration_intercept_raw']}（理想 1/0）
- 校准曲线见 calibration_results.json

## 6. 最终候选模型
- 特征集: {cand_set} ({len(cand_feats)} 特征)
- test @threshold={rec_thr:.4f}: {json.dumps(test_at_rec, ensure_ascii=False)}
- test @threshold=0.5 对比: {json.dumps(test_at_05, ensure_ascii=False)}

## 7. Sensitivity 外部验证（不训练）
{sens_ext}

## 8. 数据泄漏
- test 仅最终评估；threshold/校准仅用 OOF（训练集内部）；中位数仅训练折拟合；未使用 test 统计量 ✅
"""
    with open(REPORT_DIR / 'phase_1_6_report.md', 'w', encoding='utf-8') as f:
        f.write(report)
    print(f'\n报告: {REPORT_DIR / "phase_1_6_report.md"} | 总耗时 {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
