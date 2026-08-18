# Phase 1.6 报告：XGBoost 基线优化与概率校准

## 1. 特征消融（test 仅最终评估）
          feature_set  n_features  cv_auc  cv_auc_std  cv_prauc  cv_prauc_std  test_auc  test_prauc
              A_all32          32  0.6392      0.0124    0.1005        0.0252    0.6790      0.1293
 B_no_exercise_totmet          30  0.6429      0.0230    0.0990        0.0197    0.6932      0.1415
         C_app_core12          12  0.6506      0.0270    0.0998        0.0352    0.6938      0.1234
D_core_demo_disease21          21  0.6507      0.0259    0.0994        0.0298    0.6807      0.1179
               E_edu4          32  0.6392      0.0124    0.1005        0.0252    0.6790      0.1293
     E_edu10_official          32  0.6393      0.0153    0.0953        0.0227    0.6919      0.1395

## 2. education 敏感性
- edu(1-4) vs 官方 raeduc_c(10级): 见上表 E_edu4 / E_edu10
- edu10 匹配率 70.9%（29% 缺失，原生 NaN 处理）；APP 不采集 10 级教育 → 最终保留 edu(1-4)

## 3. 缺失处理对照（A 特征集）
        strategy  cv_auc  cv_prauc  test_auc  test_prauc
      native_nan  0.6392    0.1005    0.6790      0.1293
median_indicator  0.6485    0.0969    0.6868      0.1410

## 4. Threshold（OOF 选择，test 仅应用）
      candidate  threshold     selected_on  oof_precision  oof_recall   oof_f1  oof_specificity  oof_sensitivity  test_precision  test_recall  test_f1  test_specificity  test_sensitivity
  threshold_0.5     0.5000 oof(train only)       0.084891    0.425316 0.141533         0.776420         0.425316        0.098513     0.535354 0.166405          0.760494          0.535354
         F1_max     0.6397 oof(train only)       0.122024    0.207595 0.153702         0.927160         0.207595        0.151351     0.282828 0.197183          0.922469          0.282828
       Youden_J     0.3847 oof(train only)       0.073936    0.602532 0.131710         0.631975         0.602532        0.081329     0.717172 0.146091          0.603951          0.717172
Recall_priority     0.3576 oof(train only)       0.071367    0.630380 0.128218         0.600000         0.630380        0.075212     0.717172 0.136146          0.568889          0.717172
推荐: threshold=0.3847（Youden J，OOF 选择）

## 5. Calibration（OOF 拟合）
- Brier: raw=0.1584 | Platt=0.2500 | Isotonic=0.0431
- 诊断 slope/intercept(raw): 0.7092 / -2.6757（理想 1/0）
- 校准曲线见 calibration_results.json

## 6. 最终候选模型
- 特征集: C_app_core12 (12 特征)
- test @threshold=0.3847: {"roc_auc": 0.6937523381967826, "pr_auc": 0.1233829340851823, "precision": 0.08132875143184422, "recall": 0.7171717171717171, "f1": 0.14609053497942387, "specificity": 0.6039506172839506, "sensitivity": 0.7171717171717171, "tn": 1223, "fp": 802, "fn": 28, "tp": 71}
- test @threshold=0.5 对比: {"roc_auc": 0.6937523381967826, "pr_auc": 0.1233829340851823, "precision": 0.09851301115241635, "recall": 0.5353535353535354, "f1": 0.1664050235478807, "specificity": 0.7604938271604939, "sensitivity": 0.5353535353535354, "tn": 1540, "fp": 485, "fn": 46, "tp": 53}

## 7. Sensitivity 外部验证（不训练）
{'note': '候选模型(主数据训练)直接应用于 sensitivity 全样本，未重新训练', 'n': 7968, 'pos': 252, 'roc_auc': 0.8671, 'pr_auc': 0.2896, 'brier': 0.1116}

## 8. 数据泄漏
- test 仅最终评估；threshold/校准仅用 OOF（训练集内部）；中位数仅训练折拟合；未使用 test 统计量 ✅
