# 大模型链路与降级审计说明（2026-08-20）

## 调用顺序

意图路由 → 真实健康工具 → GraphRAG → 安全过滤 → DeepSeek 组织语言 → 对话与证据审计。

## 可观测字段

`provider`、`model`、`call_status`、`latency_ms`、`tool_calls`、`fallback_reason`、`graph_index_version` 已写入 `chat_messages` 和 `llm_call_logs`，历史记录可查看。

## 状态语义

- `deepseek / success`：DeepSeek 成功生成；
- `tool / tool_fallback`：健康工具或 GraphRAG 本地结果；
- `mock / not_configured`：未配置密钥时的明确降级，不伪装成大模型；
- `fallback`：DeepSeek 超时、鉴权、限流或服务错误后的安全降级。

默认地址为 `https://api.deepseek.com/v1`，默认模型为 `deepseek-chat`。密钥只从设置表或环境变量读取，不进入仓库、前端或普通日志。

本机验收：登录 → 录入 10 次血压 → 询问“最近血压怎么样”成功返回 `source=deepseek`、`provider=deepseek`、`model=deepseek-chat`，并记录工具调用 `analyze_health_trend`；随后健康摘要、设备同步、GraphRAG 和行动闭环回归通过。
