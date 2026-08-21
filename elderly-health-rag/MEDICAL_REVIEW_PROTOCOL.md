# GraphRAG 医学审核协议

本项目将“证据登记”和“医学批准”严格分开。索引可以自动构建，但高风险关系在医生完成逐条审核前，不得作为老人端的确定性医疗建议。

## 审核对象

`output/relation_review_manifest.json` 收录所有高强度关系和安全关系。当前索引版本 `2026-08-21.v6` 共 83 条，状态为：

- `pending_medical_review`: 83
- `approved`: 0
- `rejected`: 0

这表示审核队列已建立，不表示已经获得临床批准。

当前 AI 预审核结果：66 条可用于演示/健康教育，17 条必须由临床人员确认，0 条因字段错误被直接放行。每条关系还记录了证据评价、允许表达、禁止表达和安全护栏。详细理由见 `output/medical_pre_review.json` 和 `reports/medical-pre-review-20260821.md`。

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

## 运行方式

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py D:\BIGCHUANG\-\elderly-health-rag\graphrag_index.py build
& $py D:\BIGCHUANG\-\elderly-health-rag\medical_pre_review.py
& $py D:\BIGCHUANG\-\elderly-health-rag\validate_graph.py
```

验证报告会检查来源元数据、关系字段、集中审核清单覆盖率、逐条意见字段和冲突检测结果。演示模式保留 `pending_medical_review` 是有意的安全降级；完成医生审核后，再将对应条目更新为 `approved` 并重新运行验证。
