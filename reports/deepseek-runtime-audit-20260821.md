# DeepSeek 运行链路审计（2026-08-21）

## 观测结果

Node 22 运行 `server/final_acceptance.mjs`，结果：

```text
FINAL ACCEPTANCE PASS: login, DeepSeek trend, disease risk, GraphRAG, behavior, history
```

运行中的 `/api/health` 返回：

```json
{"ok":true,"mode":"llm","provider":"deepseek","model":"deepseek-chat"}
```

## 字段契约

- 成功回答带 `source=deepseek`、`llm.provider=deepseek`、`llm.model=deepseek-chat` 和 `call_status=success`。
- 工具调用顺序为：第一轮工具选择 → 服务端读取登录用户数据 → 工具结果回填 → 第二轮结构化回答。
- 网络失败时返回 `tool`/`tool_fallback`/`mock`，并保留 `call_status` 和 `fallback_reason`，不伪装为大模型成功回答。
- API Key 只从服务端环境读取，不进入前端、普通日志或本报告。

## 边界

该审计证明的是本机服务配置和字段契约可观测，不证明 DeepSeek 建议具有临床疗效；建议仍受 GraphRAG 证据、医学审核状态和安全过滤约束。
