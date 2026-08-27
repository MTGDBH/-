# 高风险关系医生审核包

待审核关系：90；已审核：0；approved：0。

> 本包由现有证据和 pending 清单机械生成。建议表述不是医生意见，不能自动转为 approved。

审核人逐条核对原文、URL、版本、发布日期/年份、适用人群、关系方向和因果口径后，填写 `decision=approve|reject|revise`。决定不为空时必须填写匿名 `reviewer_id`、`reviewer_role`、ISO-8601 `reviewed_at`、`review_version` 和 `rationale`；`revise` 还必须填写 `revision_text`。

不得填写虚假姓名、机构、签字或日期。身份映射保存在受控系统，不进入公开仓库。
