# Phase 1.5 XGBoost 基线建模报告

> 数据血缘：`charls_w1w2_incidence.v2/app_core12`；专用高血压数据集 n=10,619，阳性=494（4.65%）。多病种基线使用同一 CHARLS 原始版本但不同清洗边界，n=11,010，不能视为同一派生集。完整哈希和管线记录见 [risk_data_manifest.json](../../risk_data_manifest.json)。

## 数据集
- 主数据集: hypertension_incidence_w1w2.csv | n=10619, Y=1=494 (4.65%)
- test 划分: 20%, stratify, random_state=42（仅用于最终评估）

## 模型参数（baseline，未调参）
```json
{
  "objective": "binary:logistic",
  "eval_metric": "auc",
  "random_state": 42,
  "n_estimators": 300,
  "learning_rate": 0.05,
  "max_depth": 3,
  "subsample": 0.8,
  "colsample_bytree": 0.8,
  "tree_method": "hist",
  "scale_pos_weight": 20.5063
}
```

## 5-Fold CV（训练集内部）
- ROC-AUC: 0.6392 ± 0.0124
- PR-AUC:  0.1005 ± 0.0252
- 逐折明细见 cv_results.csv

## Test 结果（threshold=0.5，仅工程默认值）
- ROC-AUC: 0.6790
- PR-AUC:  0.1293
- Precision: 0.0941 | Recall: 0.4545 | F1: 0.1560 | Specificity: 0.7862
- Confusion: {"tn": 1592, "fp": 433, "fn": 54, "tp": 45}
- 注意: 阳性率仅 4.65%，Accuracy 不是核心指标；threshold=0.5 非医学最优，后续单独优化

## 特征重要性 Top15
### Gain（见 feature_importance.csv）
 feature       gain  gain_normalized
   systo 101.570160           100.00
   diabe  85.602356            84.28
  diasto  65.640556            64.63
  hearte  58.833782            57.92
  smoken  56.002674            55.14
     bmi  55.908081            55.04
     age  50.807236            50.02
 chronic  50.168495            49.39
   pulse  48.579193            47.83
   lgrip  48.394291            47.65
  bl_glu  48.093376            47.35
  cesd10  48.017509            47.28
     srh  47.475163            46.74
bl_hbalc  47.099739            46.37
   bl_ua  46.956551            46.23

### Permutation（见 permutation_importance.csv）
        feature  perm_importance_mean  perm_importance_std
          systo              0.102673             0.008251
          bl_ua              0.032926             0.004482
         bl_glu              0.028128             0.006226
          pulse              0.027581             0.003177
         diasto              0.025315             0.003831
          rgrip              0.024502             0.002388
            age              0.024419             0.002280
          lgrip              0.021717             0.001548
       bl_hbalc              0.019707             0.001932
            bmi              0.017641             0.002048
         mwaist              0.016403             0.001629
total_cognition              0.015234             0.001152
         bl_cho              0.013986             0.000579
          sleep              0.012314             0.001848
         cesd10              0.012236             0.001392

## 严格敏感性分析（同参数独立训练，不合并数据）
- sensitivity 数据集: n=7968, Y=1=252 (3.16%)
- test ROC-AUC: 0.5782 | test PR-AUC: 0.0507
- 对比: 主数据集 test AUC 0.6790 / PR-AUC 0.1293
- 说明: sensitivity 版为"纯净新发"定义（排除基线血检已检出者），事件更稀，指标通常更低属预期

## 数据泄漏检查
- ✅ ID/wave 未进入模型；Y 仅来自 Wave2；X 仅来自 Wave1
- ✅ hibpe/hibpe_1 不在特征中；test set 未参与训练/调参/任何拟合
- ✅ 缺失处理使用 XGBoost 原生 NaN，无全局填充、无 test 统计量
- ✅ 模型重载预测一致性验证通过

## SHAP
- 未安装 shap（按要求未新增依赖），已跳过；后续阶段如需可安装后补充

## 文件位置
- 模型: D:\BIGCHUANG\-\ml\models\htn_xgb\baseline_model.json
- 元数据: D:\BIGCHUANG\-\ml\models\htn_xgb\model_metadata.json
- CV: D:\BIGCHUANG\-\ml\reports\htn_xgb\cv_results.csv | Test: D:\BIGCHUANG\-\ml\reports\htn_xgb\test_metrics.json | Sensitivity: D:\BIGCHUANG\-\ml\reports\htn_xgb\sensitivity_metrics.json
