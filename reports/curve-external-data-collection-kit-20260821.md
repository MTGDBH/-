# Curve V2 真实纵向数据采集包

## 目的

这套模板用于收集独立于演示账号的真实纵向数据，并在数据进入 Curve V2 评测前完成结构和质量检查。它不是受试者招募伦理文件，也不会把候选数据自动标记为已验证。

## 每次记录必须填写

| 字段 | 规则 |
|---|---|
| `participant_id` | 去标识化编号，例如 `P001`；不要填写姓名、身份证号或手机号 |
| `site_id` | 采集机构去标识化编号；每位老人只能属于一个站点 |
| `timestamp` | ISO 8601 日期时间，必须保留时区；同一老人未来记录不能进入过去窗口 |
| `metric` | `systo`、`diasto`、`glucose`、`weight`、`pulse` |
| `value` | 数值，不带单位字符串 |
| `unit` | mmHg、mmol/L、kg 或 bpm |
| `condition` | 血糖必须是 `fasting`/`postprandial_2h`/`random`；心率必须是 `resting` |
| `posture` | 按指标填写 seated/supine/standing/not_applicable |
| `device_id` | 去标识化设备编号，不能用 unknown 代替长期缺失 |
| `measurement_source` | `real_device`、`manual` 或 `clinic`；真实候选集禁止 synthetic |
| `repeat_flag` | initial/repeat/confirmed_repeat/not_applicable |
| `medication_context` | 与预先约定的服药时点关系，不根据结果反推 |
| `missing_reason` | value 为空时必须填写；有值时为空或 not_missing |
| `quality_flag` | valid/questionable/excluded/missing |
| `age, sex, region, baseline_conditions` | participant 级固定亚组字段；基础疾病用 `|` 分隔或填写 none |

## 推荐采集设计

- 工程试点至少 100 名去标识化参与者，每人连续 90 天；该规模只用于验证设备、数据链路和初步误差，不作为临床有效性证明。
- 第一版人群模型至少争取 300 名、目标 500 名；最终样本量按目标误差、异常事件数、分层分析和失访率重新估算。
- 至少两个独立 `site_id` 或 `region_id`，其中一个机构/地区完整留作外部测试；同一参与者不得跨训练、验证、测试或外部集合。
- 血压每天 1–2 次，收缩压和舒张压同一测量时刻成对记录。
- 空腹血糖、餐后 2 小时血糖分开记录，不能混入同一序列。
- 体重尽量在晨起、进食前记录；静息心率只使用明确 `resting` 的记录。
- 缺测保留为空缺，不用插值补成“测量值”；异常值保留原始记录并填写 `quality_status`。
- 采集前完成知情同意、去标识化和数据授权；本项目代码不保存姓名等直接身份信息。

## 运行方式

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py D:\BIGCHUANG\-\ml\curve\validate_external_dataset.py D:\path\to\curve_external.csv --out D:\path\to\quality.json
& $py D:\BIGCHUANG\-\ml\curve\leakage_safe_split.py D:\path\to\curve_external.csv --external-site SITE_B --out D:\path\to\split.json
& $py D:\BIGCHUANG\-\ml\curve\evaluate_external_longitudinal.py D:\path\to\curve_external.csv --manifest D:\path\to\split.json --out-json D:\path\to\result.json --out-md D:\path\to\result.md
```

质量校验通过只代表“可以进入候选评测”，不代表外部验证完成。最终报告同时写出 micro/participant macro/site macro、全部要求指标、participant bootstrap CI、亚组、漂移、设备、测量条件缺失及拒绝原因分布。

模板文件：`ml/curve/external_dataset_template.csv`；字段规范：`ml/curve/external_dataset_schema.json`；校验脚本：`ml/curve/validate_external_dataset.py`。
