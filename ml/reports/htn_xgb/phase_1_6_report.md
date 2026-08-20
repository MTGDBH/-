# Phase 1.6 报告：XGBoost 基线优化与概率校准

## 1. 特征消融（test 仅最终评估）
          feature_set  n_features  cv_auc  cv_auc_std  cv_prauc  cv_prauc_std  test_auc  test_prauc
              A_all32          32  0.6675      0.0188    0.1018        0.0210    0.7052      0.1853
 B_no_exercise_totmet          30  0.6664      0.0163    0.1019        0.0185    0.7082      0.1951
         C_app_core12          12  0.6685      0.0311    0.1055        0.0334    0.7060      0.1635
D_core_demo_disease21          21  0.6720      0.0288    0.1028        0.0260    0.7099      0.1900
               E_edu4          32  0.6675      0.0188    0.1018        0.0210    0.7052      0.1853
     E_edu10_official          32  0.6663      0.0224    0.1008        0.0204    0.7121      0.1898

## 2. education 敏感性
- edu(1-4) vs 官方 raeduc_c(10级): 见上表 E_edu4 / E_edu10
- edu10 匹配率 70.9%（29% 缺失，原生 NaN 处理）；APP 不采集 10 级教育 → 最终保留 edu(1-4)

## 3. 缺失处理对照（A 特征集）
        strategy  cv_auc  cv_prauc  test_auc  test_prauc
      native_nan  0.6675    0.1018    0.7052      0.1853
median_indicator  0.6686    0.1015    0.7109      0.1950

## 4. Threshold（OOF 选择，test 仅应用）
      candidate  threshold                selected_on  oof_precision  oof_recall   oof_f1  oof_specificity  oof_sensitivity  test_precision  test_recall  test_f1  test_specificity  test_sensitivity
  threshold_0.5     0.5000 calibrated_oof(train only)       0.000000    0.000000 0.000000         1.000000         0.000000        0.000000     0.000000 0.000000          1.000000          0.000000
         F1_max     0.0670 calibrated_oof(train only)       0.106592    0.384810 0.166941         0.842716         0.384810        0.124277     0.434343 0.193258          0.850370          0.434343
       Youden_J     0.0391 calibrated_oof(train only)       0.068382    0.746835 0.125292         0.503827         0.746835        0.069620     0.777778 0.127801          0.491852          0.777778
Recall_priority     0.0457 calibrated_oof(train only)       0.070362    0.620253 0.126386         0.600370         0.620253        0.075082     0.696970 0.135560          0.580247          0.696970
推荐: threshold=0.0391（Youden J，OOF 选择）

## 5. Calibration（OOF 拟合）
- Brier: raw=0.0423 | Platt=0.0427 | Isotonic=0.0427
- 诊断 slope/intercept(raw): 0.9415 / -0.1575（理想 1/0）
- 校准曲线见 calibration_results.json

## 6. 最终候选模型
- 特征集: C_app_core12 (12 特征)
- test @threshold=0.0391: {"roc_auc": 0.7060231949120839, "pr_auc": 0.16352565881521328, "precision": 0.06962025316455696, "recall": 0.7777777777777778, "f1": 0.12780082987551866, "specificity": 0.4918518518518519, "sensitivity": 0.7777777777777778, "tn": 996, "fp": 1029, "fn": 22, "tp": 77}
- test @threshold=0.5 对比: {"roc_auc": 0.7060231949120839, "pr_auc": 0.16352565881521328, "precision": 0.0, "recall": 0.0, "f1": 0.0, "specificity": 1.0, "sensitivity": 0.0, "tn": 2025, "fp": 0, "fn": 99, "tp": 0}

## 7. Sensitivity 外部验证（不训练）
{'note': '候选模型(主数据训练)应用 Platt 校准后直接预测 sensitivity，全样本未重新训练', 'n': 7968, 'pos': 252, 'roc_auc': 0.7664, 'pr_auc': 0.1219, 'brier': 0.0298}

## 8. 数据泄漏
- test 仅最终评估；threshold/校准仅用 OOF（训练集内部）；中位数仅训练折拟合；未使用 test 统计量 ✅
