# 个体健康曲线稳定性升级说明

## 目标与边界

本次升级优化真实时间外推稳定性，不以增加模型复杂度或训练拟合度为目标。`last_value` 与 `rolling_median` 始终进入候选集；复杂候选若不能在 rolling-origin 的多个起点稳定击败两者，接口返回 `trend_only`/结构化拒绝。

步数和睡眠只输出规律性、滚动水平、波动与异常信息，不预测精确未来日值。所有结果属于健康管理估计，不是诊断。

## 候选约束

| 模型 | 最小有效日 | 适用指标 | 缺测处理 | 测量条件 | 最大窗口 |
|---|---:|---|---|---|---:|
| last_value | 1 | 所有允许外推的数值指标 | 最近观测；不填补目标 | 单一兼容条件组 | 14天 |
| rolling_median | 5 | 同上 | 最近最多14个观测日中位数 | 单一兼容条件组 | 14天 |
| seasonal_naive | 28 | 经验证存在周周期的日测指标 | 同星期观测；仅缺失时回退星期中位数 | 日覆盖≥80%，至少14组周滞后配对且周期可靠 | 14天 |
| ETS damped trend | 14 | 血压、静息心率、体重、条件明确的血糖 | 跨日历缺口传播状态，不填补目标 | 单一兼容条件组 | 14天 |
| Kalman local level | 10 | 噪声较大的水平型指标 | 缺口期间只做状态转移 | 单一兼容条件组 | 7天 |
| Kalman local linear | 14 | 缓慢漂移指标 | 缺口期间只做状态转移 | 单一兼容条件组 | 14天 |
| robust quantile trend | 12 | 单调或缓慢漂移指标 | 仅在真实观测日坐标拟合 | 单一兼容条件组 | 14天 |
| population prior + personal residual | 7 | 有外部、版本化同指标先验时 | 人群路径叠加个人残差中位数修正 | metric/unit/condition_group 必须完全匹配 | 14天 |

机器可读版本由 `curve_models.MODEL_SPECS` 随接口返回。

## 选择、区间和 change-point

- 分别为 1、3、7、14 天运行 fold-local rolling-origin；选择尾段与区间校准尾段不重叠。
- `final_score = prediction_error + 0.50×calibration_error + 0.35×instability_penalty + complexity_penalty`。
- 复杂候选还必须同时满足：最终分数和 MASE 均至少优于最佳基线 2%，共同起点胜率至少 55%，且起点数不少于 3。
- 区间默认使用按 horizon 分开的 80% split-conformal 校准；接口返回覆盖率、平均宽度、校准样本数、上下界和边界裁剪审计。
- 检测到持续水平迁移且改变后至少有 7 个有效日时，可只使用新状态稳定段；返回 `state_segment.reason` 和 `state_segment.start_date`。

## 消融与真实验收

运行：

```powershell
& .\.venv\Scripts\python.exe ml\curve\ablation_report.py --csv D:\path\to\real_longitudinal.csv
```

报告固定包含：无异常处理、无 change-point、无阻尼、无拒绝、不同区间校准方案和不同候选集合。默认无 `--csv` 时只生成 `test_synthetic_dry_run`，并强制标注 `clinical_claim_allowed=false`。真实验收必须采用严格时间外推、参与者独立切分、last-value/rolling-median 对照，并同时报告拒绝率、区间覆盖率和宽度。
