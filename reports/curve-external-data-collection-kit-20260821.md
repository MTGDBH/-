# Curve V2 真实纵向数据采集包

## 目的

这套模板用于收集独立于演示账号的真实纵向数据，并在数据进入 Curve V2 评测前完成结构和质量检查。它不是受试者招募伦理文件，也不会把候选数据自动标记为已验证。

## 每次记录必须填写

| 字段 | 规则 |
|---|---|
| `participant_id` | 去标识化编号，例如 `P001`；不要填写姓名、身份证号或手机号 |
| `timestamp` | ISO 8601 日期时间，保留时区；同一老人未来记录不能进入过去窗口 |
| `metric` | `systo`、`diasto`、`glucose`、`weight`、`pulse` |
| `value` | 数值，不带单位字符串 |
| `unit` | mmHg、mmol/L、kg 或 bpm |
| `condition` | 血糖必须是 `fasting`/`postprandial_2h`/`random`；心率必须是 `resting` |
| `source` | `real_device`、`manual` 或 `clinic`；合成数据只能用于测试 |
| `measurement_id` | 设备记录 ID 或现场编号，用于异常点回溯 |
| `quality_status` | `valid`、`questionable` 或 `excluded` |

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
& $py D:\BIGCHUANG\-\ml\curve\temporal_validation.py --csv D:\path\to\curve_external.csv --out D:\path\to\temporal_result.json
```

质量校验通过只代表“可以进入候选评测”，不代表外部验证完成。最终报告必须同时写出参与者数量、覆盖天数、每指标有效日数、拒绝窗口、MAE、RMSE、MASE、80% 覆盖率、区间宽度和数据缺失情况。

模板文件：`ml/curve/external_dataset_template.csv`；字段规范：`ml/curve/external_dataset_schema.json`；校验脚本：`ml/curve/validate_external_dataset.py`。
