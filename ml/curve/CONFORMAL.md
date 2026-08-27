# Curve V2/V3 finite-sample conformal intervals

Curve 的默认区间为 `lead_time_scaled_pooled`。它只使用预测起点之前、滚动 origin 已经产生真实目标值的校准残差，不读取预测起点之后的数据。

## 有限样本分位数

目标覆盖率为 `1 - alpha = 0.8`。对 `n` 个绝对残差排序后，使用下列次序统计量：

```text
k = ceil((n + 1) * (1 - alpha))
q = sorted_scores[k - 1]
```

当 `k > n` 时不返回有限区间，而是以 `INSUFFICIENT_CALIBRATION_RESIDUALS` 拒绝。实现禁止用带插值的普通 0.8 分位数冒充有限样本保证。

## 比较的区间策略

- `horizon_specific`：仅使用对应 horizon 的残差。
- `pooled`：合并已经完成的各 horizon 校准折。
- `lead_time_scaled_pooled`：先按 `sqrt(lead_days)` 标准化，再按实际 lead time 恢复尺度。
- `block_conformal`：按目标日期排序，对不重叠残差块取最大分数，再使用有限样本次序统计量。

池化和 block 方法不会扩大训练时间范围；报告中的 `calibration_leakage_check` 要求所有校准目标日期不晚于当前预测 origin。

## 报告原则

`temporal_validation.py` 同时报告 coverage、平均区间宽度和拒绝率，并分别展示：

- 有拒绝策略下的 Curve 指标；
- 所有时间窗口上的无拒绝 last-value 与 rolling-median 基线；
- 每个拒绝代码、分类、数量及比例；
- 每个成功窗口的模型、horizon、校准样本量、区间宽度、覆盖和相对基线差异。

九类合成场景只用于验证代码行为、覆盖逻辑和拒绝机制，不代表真实老人准确率，不能用于临床宣称。
