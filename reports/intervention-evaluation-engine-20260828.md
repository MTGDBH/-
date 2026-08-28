# N-of-1 个体干预效果评估引擎说明

## 医疗安全定位

本模块输出个人时间序列上的描述性或初步证据，不作诊断、处方、停换药或替代就医用途。证据等级仅允许 `insufficient`、`descriptive_only`、`personal_preliminary`、`personal_repeated`。输出契约禁止确认临床有效性的措辞。

## 算法说明

1. 在读取和 Python 预处理两层执行 `recorded_at <= outcome_window.end` 截断；基线拟合参数只来自基线窗口。
2. 按 IANA 时区转换为本地日期，再按本地日、严格测量条件聚合重复读数。
3. 血糖分为空腹、餐后 2 小时、随机；血压键包含姿势、时段、设备与复测状态；心率分静息/非静息；体重仅将晨起且衣着相近视为同组。
4. 不跨条件合并。选择有最大共同支持的单一条件组，并要求结局点能在基线中找到相同“星期 + 测量时段”层。
5. 主估计为匹配数据的中位数差；标准化效应量使用两窗口 MAD 的稳健合并尺度。
6. 不确定区间采用固定种子的匹配分层 bootstrap。每轮重采样结局日，并从对应星期/时段基线池中抽取个人基线。
7. 离群阈值不读取未来点：物理范围和质量标记先过滤，基线 MAD 只在基线拟合；结局窗口内孤立离群点剔除，持续段保留并报告。
8. 当结局内部存在持续 change point 或基线漂移明显且数据量足够时，增加分段时间序列敏感性分析；它不是主因果估计。
9. 匹配后基线或结局少于 6 个本地日、少于 4 个不同日期，或基线跨度少于 7 天时拒绝评价。

## 输入契约

Python 输入是完整快照，至少包括：

- `intervention`：定义、计划执行次数、最低依从率；
- `target_metric`：指标、血压分量与单位；
- `baseline_window`、`intervention_window`、`outcome_window`：ISO-8601 起止；
- `execution_records`：追加式执行日志及修订关系；
- `measurements`：值、时间、条件、设备、上下文和数据质量；
- `timezone`：IANA 时区；
- `concurrent_interventions`、`acute_events`、`prior_evaluations`；
- `confidence_level`、`bootstrap_iterations`、`random_seed`。

HTTP 入口为 `POST /api/actions/interventions/:interventionId/evaluate`，只接受处于 `evaluating` 状态的干预。Node 服务只组装截止快照、调用 Python、验证契约并保存结果。

## 输出契约

版本为 `n-of-1-intervention-evaluation.v1`，机器可读 schema 位于 `server/src/contracts/interventionEvaluation.v1.schema.json`。核心字段包括 `baseline_summary`、`outcome_summary`、`absolute_change`、`relative_change`、`effect_size`、`uncertainty_interval`、`adherence_rate`、`measurement_count`、`confidence_level`、`evidence_level`、`confounders`、`reason_code` 与中文 `message`。

## 混杂因素

当前检测：设备更换、测量时段改变或不稳定、低依从、同期干预、计划测量缺失、结局内部持续状态突变、急性事件。重大混杂会把可计算结果降为 `descriptive_only`；测量条件无共同组或样本量不足则直接输出 `insufficient`，且变化量与区间为 `null`。

## 时间泄漏检查

- 数据库查询上界固定为干预记录的 `outcome_end`；执行日志也使用同一上界。
- Python 在条件分组、设备检测、质量过滤、离群拟合和摘要之前重复丢弃截止点后的记录。
- `input_fingerprint` 只纳入截止点以内的测量。
- 回归测试向输入追加未来极端值和新设备，历史评价完整对象保持不变。

## 限制

- 首版不是随机交叉 N-of-1 试验，不能充分排除自然病程、回归均值、季节性与未记录共干预。
- bootstrap 表示采样不确定性，不覆盖全部测量误差和未测混杂。
- `personal_repeated` 依赖至少两次方向一致且达到个人初步等级的历史评价，不等同于群体证据。
- 医学安全方向是保守配置；体重等依赖个体目标的指标不会自动判定改善。
- 急性不适、危险读数或持续异常应进入临床复核/急救流程，不能等待本引擎结论。

## 合成案例与测试

合成干跑见 `reports/intervention-evaluation-synthetic-dry-run-20260828.md` 和同名 JSON。两者明确标记 synthetic，只验证流水线。自动测试覆盖未来点不变性、条件隔离、数据不足拒绝、多干预冲突、bootstrap 可复现、时区/DST、本地日期分组、离群点/change point 和危险方向文案。
