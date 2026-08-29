# 智能管家架构

生产聊天请求只进入 `POST /api/chat`，由 `routes/api.js` 绑定操作者、健康对象、会话与幂等键后调用 `orchestratorV3.js`。V3 负责目标与对话任务状态；V2 文件保留为兼容执行内核，不再是生产 HTTP 入口。

执行顺序：身份/对象授权 → 急症与攻击检查 → 四层上下文 → Goal Resolver → 最多三个工具的计划 → Policy Engine → Tool Executor → Result Verifier → 最多一次重新规划 → 结构化响应。所有数据库写入仍由专用路由完成，智能体只生成确认预览。

响应契约包含 `content`、`plan`、`confidence`、`task_state`、`presentation`、`tool_trace` 和 `context_manifest`，并携带 `run_id`、`conversation_id`。`client_request_id` 在 `(actor_user_id, client_request_id)` 上唯一。

已实现闭环：异常指标症状询问与急症分流、复测预览/确认/结果候选、数据缺失补充提示、个体干预提议/确认/执行/复测/评价、设备连接与新数据验证。

TODO：就医摘要的确认后下载接口尚未实现；当前只能通过现有数据与证据卡人工整理。
