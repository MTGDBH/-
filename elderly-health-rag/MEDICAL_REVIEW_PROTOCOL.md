# GraphRAG 医学审核协议

本项目将“证据登记”和“医学批准”严格分开。索引可以自动构建，但高风险关系在医生完成逐条审核前，不得作为老人端的确定性医疗建议。

## 审核对象

`output/relation_review_manifest.json` 收录所有高强度关系和安全关系。版本和数量以 `output/index_stats.json`、`output/relation_review_manifest.json` 为准，不在协议中手写。审核队列已建立不表示已经获得临床批准。

AI 预审核数量和逐条意见以 `output/medical_pre_review.json` 为准。`ai_pre_review_status` 只用于分流，不能写入或推导 `review_status=approved`。

## 逐条审核字段

医生或老年医学/全科审核人应逐条填写：

```text
relation_index
review_status: approved | rejected | pending_medical_review
reviewer_name_or_id
reviewer_role
reviewed_at
decision_rationale
population_scope
allowed_audience
conditions_or_exceptions
source_version_checked
```

## 审核准入规则

1. 指南、系统综述和关键研究的来源 URL、版本、发布时间、适用人群和限制必须可追溯。
2. 观察性研究只能支持“相关/预测因素”，不能自动标记为因果关系。
3. `urgent_signal`、`emergency_action`、`requires_medical_review`、`do_not_self_adjust_medication` 等安全关系必须经过审核或保持降级提示。
4. 冲突关系必须先进入医学复核，不能直接进入老人端建议。
5. 审核通过后仍需保留原始证据 ID、审核人和审核时间，索引重建不得覆盖审核记录。

## 系统准入行为

- 老人端（默认 `audience=elderly`）过滤 `needs_clinician_confirmation` 关系；急症或紧急行动边只作为安全提示保留，不作为普通健康建议依据。
- 医生/审计端（`audience=doctor` 或 `audit`）保留完整关系、审核理由和路径，便于复核。
- `output/medical_pre_review.json` 中的 AI 预审状态不能替换 `review_status`，也不能自动写成 `approved`。

## P0 门控矩阵

| 状态 | 老人/照护者展示 | 医生/临床/审计展示 | 普通行动、诊断暗示、用药建议 |
|---|---|---|---|
| 医生批准（`approved` + 审核人 + 审核时间）且无冲突、来源有效 | 可展示 | 可展示 | 可按适用范围生成 |
| `requires_clinician_confirmation` / `pending_medical_review` 的高风险关系 | 默认隐藏 | 带 pending/research 标记展示 | 禁止；只能提示交由医生确认 |
| AI 预审为 `needs_clinician_confirmation` | 默认隐藏 | 带 AI 预审标记展示 | 禁止；AI 预审不构成批准 |
| 冲突关系 | 默认隐藏 | 带 conflict 标记展示 | 禁止，直至医生解决冲突 |
| 来源 `invalid/revoked/expired/unavailable` | 排除 | 仅审计展示 | 禁止 |
| legacy pending 来源（flag 模式） | 标记并可配置降权 | 完整展示 | 高风险关系仍按医生批准门控 |
| legacy pending 来源（exclude 模式） | 直接排除 | 完整审计展示 | 禁止由被排除证据生成 |
| 未批准的 `urgent_signal/emergency_action` | 仅作急症安全提示 | 带 pending 标记展示 | 不得转成普通行动、诊断或用药建议 |

## 运行方式

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py D:\BIGCHUANG\-\elderly-health-rag\graphrag_index.py build
& $py D:\BIGCHUANG\-\elderly-health-rag\medical_pre_review.py
& $py D:\BIGCHUANG\-\elderly-health-rag\validate_graph.py
```

验证报告会检查来源元数据、关系字段、集中审核清单覆盖率、逐条意见字段和冲突检测结果。演示模式保留 `pending_medical_review` 是有意的安全降级；完成医生审核后，再将对应条目更新为 `approved` 并重新运行验证。
