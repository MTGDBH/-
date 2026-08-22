# 多源健康指标预测实施与验收说明

## 已实施架构

项目现在明确分离三类输出：`直接测量值`、`估计值`、`预测值`。19 个核心指标均登记
`prediction_mode=value/range/risk/anomaly/derived/not_supported`，统一定义位于
`ml/prediction_contract.json`，数据库 `metric_defs.prediction_mode`、预测 API 和预测页共同使用。

Curve V2 继续作为个人短期历史基线；CHARLS 模型作为波次级人群长期模型，通过
`GET /api/prediction/population/:type` 单独返回，页面不把二者画成同一时间尺度。

## 第一阶段验收

- `ml/curve/health_curve.py` 的滚动回测按真实日历 1/3/7 天选择目标，不再按“后续第几条记录”代替天数。
- `ml/curve/temporal_validation.py` 按预测日期与真实日期连接；缺测日不会错位比较。
- `ml/common/feature_builder.py` 只使用 `as_of` 当时及之前记录，生成 1/3/7/14/30/90 天窗口特征。
- `ml/common/prediction_contract.py` 强制输出模式、值类型、显示标签、区间、风险、拒绝原因和模型元数据。
- `prediction.html` 的图例、详情和提示明确区分直接测量、模型估计和未来预测。

## 第二阶段验收

训练入口：

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py D:\BIGCHUANG\-\ml\population\train_charls_predictors.py --backend auto
```

后端优先级固定为 CatBoost → LightGBM → XGBoost。每个数值任务同时评估最近值、Ridge
线性模型和树模型；树模型验证 MAE 未比最佳简单基线改善至少 2% 时不启用。化验风险同时
评估患病率基线、Logistic 和校准后的树模型；只有 PR-AUC 至少提升 0.01 且 Brier 不恶化
超过 5% 时启用复杂模型。

- 数值目标：Wave1 无创/问卷特征预测 Wave2 收缩压、舒张压、心率、体重、腰围和握力。
- 化验风险：Wave1 预测 Wave3 血糖、HbA1c、总胆固醇、尿酸和肌酐异常；分别训练纯无创层和带一次微创锚点层。
- 血压点预测经过收缩压/舒张压联合投影，强制最小脉压差并报告调整前后 MAE。
- 输出 MAE、RMSE、MASE、80%覆盖率、区间宽度、拒绝率；风险输出 AUROC、PR-AUC、灵敏度、特异度、Brier 和校准分箱。
- 年龄、性别、缺失程度、慢病状态和设备来源均有分层字段；CHARLS 没有设备来源时明确标记为 `charls_survey_no_device`。
- 参与者按 70/15/15 隔离，另完整留出一个省份做地理迁移测试，参与者重叠为 0。

当前实跑结果见 `ml/reports/charls-multitarget-evaluation.json` 和
`reports/charls-multitarget-evaluation.md`。这些结果是 CHARLS 内部/地理迁移审计，不是独立机构临床外部验证。

## 第三阶段数据闸门

统一模板与工具：

- `ml/validation/longitudinal_dataset_template.csv`
- `ml/validation/longitudinal_dataset_schema.json`
- `ml/validation/validate_longitudinal_dataset.py`
- `ml/validation/evaluate_predictions.py`

采集数据进入训练前必须达到：工程试点至少 100 人且每人覆盖 90 天；模型开发至少 300 人、
目标 500 人；至少两个机构或地区，外部机构至少 50 人。最终样本量仍需按目标误差、阳性事件
数、分层精度和失访率重新估算。验证器自动生成参与者级 split manifest，并检查直接身份字段、
synthetic 来源、重复测量、参与者泄漏、机构留出及时间跨度。

真实预测导出交给 `evaluate_predictions.py` 后，会在测试集和外部集分别计算全部数值/风险指标、
分层结果、简单基线比较和复杂模型启用门槛。

## 运行回归

```powershell
$env:PYTHONUTF8 = '1'
& $py D:\BIGCHUANG\-\ml\common\test_prediction_common.py
& $py D:\BIGCHUANG\-\ml\curve\test_health_curve.py
& $py D:\BIGCHUANG\-\ml\curve\test_temporal_validation.py
& $py D:\BIGCHUANG\-\ml\validation\test_validation_tools.py
cd D:\BIGCHUANG\-\server
npx --yes node@22.16.0 src/test_prediction_contract.js
npx --yes node@22.16.0 src/test_population_prediction.js
```

## 医疗边界

化验模块只输出异常风险等级，不显示由模型伪造的化验浓度。eGFR 必须在取得规范肌酐后按
认可公式推导。所有模型允许因缺失、区间过宽或基线不优而拒绝输出；结果用于健康管理筛查，
不构成诊断或治疗建议。
