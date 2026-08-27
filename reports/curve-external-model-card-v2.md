# 个体健康曲线候选模型卡 v2

## 用途

用于血压、静息心率、体重和测量条件明确的血糖之短期趋势辅助管理。步数和睡眠不预测精确未来日值。本系统不是诊断工具。

## 候选与选择

强基线为 `last_value`、`rolling_median`；候选包括可靠周期门控后的 seasonal naive、ETS damped trend、Kalman local-level/local-linear、robust quantile trend，以及只有在版本、指标、单位和测量条件匹配时才启用的 population prior + personal residual correction。

1、3、7、14 天分别采用 fold-local rolling-origin。评分为：

`prediction_error + 0.50×calibration_error + 0.35×instability_penalty + complexity_penalty`

复杂候选未稳定优于双基线时返回 `trend_only/refused`。

## 外部验证门槛

- participant-disjoint train/validation/temporal_test；
- 至少一个完整 site 永久留作 external_site_test；
- 预处理、异常处理、change-point、模型选择和区间校准全部限制在当前 origin 及以前；
- 同时报告 micro、participant macro、site macro、亚组、拒绝原因及 participant bootstrap CI；
- 必须报告 MAE、RMSE、MASE、coverage、interval width、bias、refusal rate、baseline win rate 和 boundary-event sensitivity。

## Boundary event 定义

阈值由 `external_dataset_schema.json` 预先声明。敏感度分母是实际越过管理边界的可评分点；预测区间触及同方向边界区域视为检测。无事件时报告 `NA`，不得填 0 或推断结果。

## 当前证据状态

`REAL EXTERNAL-SITE VALIDATION NOT YET RUN`。现有 synthetic dry-run 只验证代码路径，不能证明临床有效性。只有带来源审查、数据冻结指纹和预注册站点留出的真实报告才能更新本节。
