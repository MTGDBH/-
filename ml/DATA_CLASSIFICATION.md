# 数据分类与隔离规则

本项目不允许把演示账号数据、研究训练数据和自动化测试序列混为一体。

| 类别 | 位置/标识 | 用途 | 是否进入风险训练 |
|---|---|---|---|
| 研究数据 | `D:/大创数据2/CHARLS.csv` 及 `ml/*/datasets/*_incidence_w1w2.csv`；`data_manifest_id=charls_w1w2_incidence.v2` | Wave1→Wave2 队列建模与离线评估 | 是，仅限派生集 |
| 演示数据 | `server` 数据库中 `metrics.source=synthetic` 的张奶奶等账号 | 页面演示、智能体链路展示、人工操作 | 否 |
| 真实设备/手工数据 | `metrics.source=device` 或 `manual` | 在线健康管理和个体趋势 | 否，不回写训练集 |
| 真实纵向验证候选 | 不进入仓库；由 `curve-external-dataset.v2` 校验并以 SHA-256 注册 | internal/temporal/external-site 曲线验证 | 否，只读评测 |
| 测试数据 | `ml/curve/test_health_curve.py` 等测试内存序列、Node 测试夹具 | 回归、边界和安全测试 | 否 |

规则：

1. 研究数据只通过 `risk_data_manifest.json` 注册；训练脚本拒绝读取演示数据库。
2. 演示数据可以保留用于课堂展示，但不得在模型卡中称为研究样本。
3. 测试序列不得写入 `ml/disease_risk/datasets`；测试只验证算法，不产生训练文件。
4. 每个实验运行记录 `run_id`、`data_manifest_id`、代码版本、模型版本和参数。
5. 真实纵向候选 CSV 不提交到仓库；只提交去标识化切分清单、质量摘要和汇总结果。完整外部 `site_id` 必须在查看结果前预注册。
