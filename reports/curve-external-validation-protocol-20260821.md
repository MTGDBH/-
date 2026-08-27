# Curve V2 真实老人纵向数据与外部验证协议 v2（待采集）

## 数据要求

- 工程试点至少100名老人连续90天；第一版人群模型至少300名、目标500名，最终样本量按目标误差与异常事件数重新估算。
- 至少两个机构；一个或多个 `site_id` 在查看结果前预先指定并完整留作外部测试，外部集合建议不少于50名老人。
- 每位老人目标连续 90 天；每天 1–2 次血压，并保存收缩压/舒张压、时间、姿势、测量条件和来源。
- 空腹血糖、餐后 2 小时血糖、随机血糖严格分组；不根据数值猜测条件。
- 体重只使用晨起条件；静息心率只使用明确静息条件。
- 记录缺测、设备同步失败、异常点、人工复测、用药上下文和设备 ID。
- 必填列以 `external_dataset_schema.json` v2 为准，并包含年龄、性别、地区、基础疾病用于预先声明的亚组报告。

## 外部验证切分

先完整取出预注册外部 `site_id`，剩余站点按老人使用确定性哈希形成 train/validation/temporal_test。任何 participant 只能属于一个集合。每位老人内部按 1、3、7、14 天 rolling-origin；每折的去重、异常处理、change-point、模型选择和区间校准只能拟合于 origin 及以前。

## 主要终点

MAE、RMSE、MASE、coverage、interval width、bias、refusal rate、baseline win rate、boundary-event sensitivity。分别报告 micro、participant macro、site macro、指标×horizon，以及年龄、性别、地区、设备和基础疾病亚组。行为指标（步数、睡眠）只评估滚动平均/规律性，不评估精确未来日值。

预注册模板将主要分析固定为 external-site test 的晨间静息收缩压、7 日 horizon、participant-macro MAE，主要模型为冻结的 Curve rolling-origin 选择流水线，并同时比较 last-value 与 rolling-median。80% 为预先声明的区间 coverage 目标。只有对两个基线的 participant-bootstrap 95% MAE 差值上界均小于 0，且 participant-macro MAE 均更低，才达到预注册的工程优势判据；否则结论必须是“未证明优势”。该判据不等于临床有效性。

置信区间以 participant 为 cluster 重采样，禁止把同一老人的记录或窗口当作独立样本。模型拒绝和已预测但无可评分目标的窗口分别报告，不得从分母中静默删除。

## 验收规则

- 预测模型必须来自滚动 1/3/7/14 日分别选出的候选；
- 预测区间始终满足 `lower <= predicted <= upper`，并随距离扩大；
- 数据不足、高波动、区间过宽或回测误差超限时必须拒绝预测；
- 报告同时列出简单基线和 Curve V2，若没有稳定提升则保留“拒绝预测”结论。

## 当前状态

验证流水线已完成，但真实纵向数据和独立站点测试集尚未进入工作区。报告必须分开标识 synthetic dry-run、internal validation、temporal test、external-site test；当前不得把任何 synthetic 结果写成外部临床验证。

外部结果运行前，必须由有权人员填写并冻结 `external_validation_preregistration.template.json`，生成 participant-disjoint split manifest，再用 `freeze_external_split.py` 创建内容寻址快照。`evaluate_external_longitudinal.py` 会核对数据、预注册、manifest 与 freeze record 的 SHA-256；任一不一致即停止。
