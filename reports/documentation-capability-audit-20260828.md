# 文档—代码能力一致性审计（2026-08-28）

状态：**documentation_aligned_with_current_code；external_gates_pending**

## 审计范围

- `README.md`、`FINAL_DELIVERY.md`、`TESTING.md`、`server/README.md`
- `server/package.json`、`server/src/db.js`、`server/src/auth.js`、`server/src/services/authService.js`
- `server/src/routes/`、`server/src/contracts/accessControl.js`
- 根目录全部 HTML、`assets/js/health-bulk-entry.js`
- `deliverables/national_award/` 的 Markdown/LaTeX 声明
- `elderly-health-rag/output/` 当前索引与审核清单
- `reports/` 的历史最终审计、最新 Curve/GraphRAG 结果和外部验证协议

本轮未修改应用业务逻辑、数据库 schema、模型或 API；只修改文档、页面提示文字和交付材料源文档。

## 页面审计

根目录共有 **15 个 HTML 文件**：

- 11 个登录后功能页：`index`、`monitoring`、`assessment`、`agent`、`knowledge`、`prediction`、`metric`、`alerts`、`profile`、`settings`、`confidence`；
- 2 个鉴权页：`login`、`register`；
- 2 个无需登录的展示/开发页：`showcase`、`dev`。

旧 README 的“登录 + 9 个页面”不再成立。

## 能力与代码证据

| 能力 | 结论 | 主要证据与边界 |
|---|---|---|
| 用户注册 | 已完成 | `POST /api/auth/register`；`register.html` 已接入 |
| bcrypt 密码哈希 | 已完成 | `bcryptjs`；默认 cost 12；种子账号、新注册和改密均哈希；旧明文仅在成功登录后迁移 |
| 登录失败锁定 | 已完成 | 失败计数、`locked_until`、账号/IP 限速；集成测试通过 |
| 会话过期和注销 | 已完成 | 绝对 TTL、空闲 TTL、登出撤销、过期删除；账号注销级联清理 |
| 家属/医生授权 | 已完成工程能力 | 一次性授权码、授权关系、摘要读取与撤销 |
| 健康数据代录 | 部分完成 | 已授权家属可提交结构化健康问卷/档案；直接代写测量值返回 403 |
| 设备同步 | 已完成接口/演示能力 | `/api/devices/:id/sync` 写入 `metrics.source=device`；未宣称全硬件认证 |
| Curve 预测 | 已完成工程能力、内部验证 | 稳健候选、基线、回测、区间和拒绝；真实独立外部纵向验证未完成 |
| 疾病风险预测 | 已完成工程能力、内部验证 | 四类两年筛查；模型包门槛和数据完整度；不是诊断 |
| GraphRAG | 已完成工程能力、内部验证 | live 索引 `2026-08-26.v9`：83 来源、129 分块、192 实体、557 关系、6 社区 |
| 智能体行动确认 | 已完成 | 敏感行动先计划后确认，未确认不落库执行 |
| 复测随访闭环 | 已完成 | 创建、确认、执行、到期、候选匹配、回填、拒绝/取消状态 |
| Docker 和本地部署 | 已完成实现 | Windows 脚本与 Dockerfile 存在；本机启动已实测，Docker 因当前主机未安装 CLI 未执行 |

## 证据等级与声明边界

### 已完成工程能力

代码路径、API、页面或脚本已经存在，并由自动测试或本轮冒烟检查支持。该等级不自动表示临床有效。

### 演示能力

张奶奶、李爷爷账号及相关记录属于合成演示数据；模拟设备和 Mock LLM 属于可演示降级路径。不得称为真实老人数据、真实临床运行或外部验证。

### 内部验证结果

包括内部黄金问题、口语改写留出、合成 Curve 干跑、CHARLS 内部/波次时间切分、工程回归和安全测试。只能用于说明内部可复现性与工程行为。

### 真实外部验证

当前未完成独立地区/机构风险队列、真实 60–90 天纵向 Curve 队列和真实老人/医生人因研究。因此不允许写“已完成临床外部验证”或“已证明临床疗效”。

### 尚待医生审核

当前 `relation_review_manifest.json` 有 **90 条**待医学审核关系：`pending_medical_review=90`、`approved=0`、`rejected=0`。AI 预审核分为 70 条仅限演示/健康教育、20 条需临床确认。

2026-08-21 的医生待签表只有 83 行且 0 签字，已落后于 v9 当前范围。提交前必须重新生成 90 条版本化审核包，完成持证医生逐条结论、签名和日期；旧表或 AI 预审核都不能冒充医生批准。

## 本轮关键命令结果

### 一键核心验收

```powershell
Set-Location 'D:\BIGCHUANG\-\server'
npm test
```

结果：**PASS**。

- 当前系统 Node 24.16.0 被测试入口自动重启为 Node 22.16.0；
- Node 单元测试全部通过；
- 鉴权集成：bcrypt 迁移、锁定恢复、会话过期、登出、Cookie 策略、权限矩阵、共享限速通过；
- 授权集成：未授权读取/写入为 403，授权摘要、家属问卷代录和趋势读取通过；
- 设备集成：同步记录 `source=device`，电量和智能体设备工具通过；
- Python unit：7 passed；GraphRAG isolation：2 passed；GraphRAG/安全长组：5 passed；Curve/安全短组：5 passed；
- Python 语法/UTF-8、Node 语法通过；
- 测试前后 Git 状态一致。

### 本地启动与 HTTP 冒烟

```powershell
.\scripts\Start-Local.ps1 -SkipSetup
Invoke-RestMethod http://localhost:3001/api/health
Invoke-WebRequest http://localhost:3001/login.html -UseBasicParsing
.\scripts\Stop-Local.ps1
```

结果：**PASS**。`health_ok=true`、`populationModels=ready`、登录页 HTTP 200，服务随后由停止脚本正常关闭。LLM 模式取决于本机私有 `.env`，不是仓库默认能力声明。

### Docker

`docker version` 结果：**NOT RUN**，当前主机未安装/未暴露 Docker CLI。Dockerfile 及容器卫生测试已被 `npm test` 静态/隔离检查覆盖，但本轮不能把镜像构建写成实机通过。

## 已修正的过时表述

- “含登录 + 9 个页面” → 15 个 HTML，并按功能/鉴权/展示分类；
- “密码明文存储” → bcrypt + 旧记录登录后迁移；
- “用户注册流程（目前只有登录）” → 注册页面/API 已完成；
- “前端需另启 Python 静态服务器” → Node 已统一托管页面和 API；
- “Node 20/22 CI 矩阵” → 当前实际只有 Node 22；
- “83 条 AI 预审（66/17）” → 当前 v9 为 90 条（70/20），且批准数仍为 0；
- “GraphRAG 78/111/159/419” → 当前 v9 为 83/129/192/557；
- “张奶奶真实数据” → 合成演示记录；
- “家属/医生只能只读” → 已授权家属还可代填问卷，但直接测量代写仍禁止。

## 尚未完成的外部证据

1. 当前 90 条关系的持证医生逐条审核、签字和版本化发布；
2. 真实老人/医生人因研究、伦理审批或知情同意；
3. Curve 的真实纵向、参与者隔离、独立外部验证；
4. 疾病风险的独立地区/机构/日期队列验证与再校准；
5. 真实硬件设备兼容性、可靠性和合规验证；
6. 生产环境渗透、灾备、隐私合规及医疗器械路径证据。

## 交付物版本提醒

`deliverables/national_award/elderly_health_national_award.pptx` 和 `latex/project_summary.pdf` 是 2026-08-21 的历史二进制快照，仍可能含旧 v6/83 条统计。本轮已更新 Markdown 和 LaTeX 源文件并在 `SUBMISSION_INDEX.md` 标明快照状态；正式提交前必须重新生成并复核 PPT/PDF/ZIP，不能把旧二进制当成当前审计结果。
