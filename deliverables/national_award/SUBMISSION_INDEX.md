# 国奖提交材料索引

本文件用于把题目、LaTeX 源码和最终交付物直接交给 Codex/评审材料整理流程。

## 题目

- 题目文件：`D:\BIGCHUANG\-\deliverables\national_award\project_title.md`

## 项目总结书

- LaTeX 源码：`D:\BIGCHUANG\-\deliverables\national_award\latex\project_summary.tex`
- 编译 PDF：`D:\BIGCHUANG\-\deliverables\national_award\latex\project_summary.pdf`（2026-08-21 历史快照；当前事实以已更新的 `.tex`、`FINAL_DELIVERY.md` 和 2026-08-28 文档审计为准，提交前需重新编译）

## 汇报材料

- 汇报 PPT：`D:\BIGCHUANG\-\deliverables\national_award\elderly_health_national_award.pptx`（历史快照；提交前需同步 v9 索引 83/129/192/557 与 90 条待医生审核范围）
- 5 分钟演示脚本：`D:\BIGCHUANG\-\deliverables\national_award\demo_script.md`
- 最终交付说明：`D:\BIGCHUANG\-\FINAL_DELIVERY.md`
- 一键提交包：`D:\BIGCHUANG\-\deliverables\national_award\national_award_submission_bundle.zip`

## 证据与自检

- 提交前自检：`D:\BIGCHUANG\-\reports\submission-readiness-check-20260821.md`
- 任务矩阵：`D:\BIGCHUANG\-\reports\national-award-task-matrix-20260821.md`
- 交付物哈希清单：`D:\BIGCHUANG\-\reports\submission-artifact-manifest-20260821.json`
- 最终提交审计：`D:\BIGCHUANG\-\reports\final-submission-audit-20260821.md`
- 文档与代码能力复核：`D:\BIGCHUANG\-\reports\documentation-capability-audit-20260828.md`
- 外部证据闸门清单：`D:\BIGCHUANG\-\reports\external-gate-execution-checklist-20260821.md`
- 回归测试汇总：`D:\BIGCHUANG\-\reports\regression-suite-summary-20260821.md`
- 医生审核报告（83 条历史待签版，已落后于 v9 的 90 条范围）：`D:\BIGCHUANG\-\reports\clinician-review-report-20260821.md`
- 张奶奶演示数据说明：`D:\BIGCHUANG\-\reports\demo-curve-data-generation-20260821.md`

提交包由 `reports/create_submission_bundle.py` 按哈希清单生成，不包含密钥、原始个人数据、`node_modules`、缓存或临时预览文件。

> 当前材料、代码和内部评测可复现；张奶奶等账号为合成演示数据。当前 v9 有 90 条待医生审核关系，而旧签字包只有 83 条且 0 签字，提交前必须重新生成当前版本审核包。真实老人/医生人因研究、带日期的外部 Curve 数据和独立外部风险队列仍需项目组或合作机构完成，不能用演示数据或 AI 预审替代。
