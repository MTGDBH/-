# 真实老人纵向曲线数据卡（采集后填写）

状态：`NOT_COLLECTED / NOT_EVALUATED`。本模板不包含任何老人记录或虚构统计量。

## 1. 数据身份与治理

| 项目 | 内容 |
|---|---|
| 数据集版本 | 待填写 |
| 数据负责人 | 待填写 |
| 伦理审批/知情同意编号 | 待填写 |
| 去标识化方法 | 待填写 |
| 招募起止日期 | 待填写 |
| 纳入/排除标准 | 待填写 |
| 数据冻结日期与 SHA-256 | 待填写 |
| 允许用途与保存期限 | 待填写 |

禁止在仓库中写入姓名、身份证号、电话、住址等直接标识符。

## 2. 覆盖范围

参与者数、站点数、各站点人数、年龄/性别/地区/基础疾病分布、各指标记录数、每人跨度和有效日数均由真实 CSV 校验后自动填写。未采集前保持 `NA`。

## 3. 必填字段

`participant_id, site_id, timestamp, metric, value, unit, condition, posture, device_id, measurement_source, repeat_flag, medication_context, missing_reason, quality_flag, age, sex, region, baseline_conditions`。

## 4. 缺测与质量

- `value` 为空时必须填写 `missing_reason`，且 `quality_flag=missing`。
- 报告总体及按站点/设备/指标的缺测率、缺测原因和 excluded/questionable 比例。
- 不把插值结果伪装为测量值；若研究分析另行插值，必须记录方法且不能用于当前折未来目标。

## 5. 切分与泄漏门禁

- 同一 participant 只属于一个 site 和一个 split。
- 外部站点在查看结果前预先指定并完整留出。
- 数据卡附 `curve-split-manifest.v1`、CSV 指纹及 overlap=0 审计。

## 6. 已知限制

待真实数据进入后填写设备选择偏倚、站点差异、依从性、失访、事件稀少、亚组样本量及泛化限制。数据质量通过不等于临床有效性成立。
