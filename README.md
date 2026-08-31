# 老年人健康管理智能体（小康·健康管家）

面向老年人、家属和医生协同场景的本地可运行健康管理系统。仓库包含零构建前端、Node.js/Express/SQLite API、Curve 个体趋势预测、四类疾病风险筛查、本地 GraphRAG、可确认的智能体行动与复测随访闭环。

> 当前定位：工程原型与研究演示系统，不是医疗器械，不输出诊断、处方或个体用药调整。演示账号和部分评测使用合成数据；AI 证据预审核不等同于医生审核。

## 当前能力与证据等级

| 能力 | 状态 | 实现与边界 |
|---|---|---|
| 用户注册 | 已完成 | `register.html` 调用 `POST /api/auth/register`，注册后自动建立会话 |
| 密码保护 | 已完成 | 新密码使用 bcrypt（默认 cost 12）；旧明文记录仅在成功登录后迁移为 bcrypt，不再新增明文密码 |
| 登录失败保护 | 已完成 | 账号失败计数、临时锁定，以及 IP/账号共享速率限制；生产模式应配置 Redis |
| 会话过期与注销 | 已完成 | 随机会话令牌仅以 SHA-256 摘要入库，支持绝对过期、空闲过期、登出撤销和账号注销级联清理 |
| 家属/医生授权 | 已完成工程能力 | 老人生成一次性授权码；家属/医生接受后可读取授权摘要，关系可撤销 |
| 健康数据代录 | 部分完成 | 已授权家属可替老人提交结构化健康问卷/档案；直接代写血压等测量值被权限测试明确拒绝 |
| 设备同步 | 已完成接口与演示能力 | 真实 Web Bluetooth 适配层或模拟设备可统一调用 `/api/devices/:id/sync`；仓库不宣称已完成所有硬件型号配网/认证 |
| Curve 预测 | 已完成工程能力、内部验证 | 对血压、条件分组血糖、体重和静息心率做稳健趋势/预测；数据不足或不稳定时拒绝外推；步数、睡眠只做行为趋势 |
| 疾病风险预测 | 已完成工程能力、内部验证 | 高血压、糖尿病、心血管疾病、脑卒中两年筛查概率；模型包缺失时明确降级，不作诊断 |
| GraphRAG | 已完成工程能力、内部验证 | 本地混合检索、证据来源、关系路径、冲突和审核状态可追溯；尚未完成持证医生逐条签字 |
| 智能体行动确认 | 已完成 | 创建待办、安排复测、通知家属、联系医生等敏感行动先生成计划，确认后才落库执行 |
| 复测随访闭环 | 已完成 | 支持建议、确认、执行、到期、候选测量匹配、结果回填、取消/拒绝等状态 |
| Docker 与本地部署 | 已完成 | Windows 安装/启动/停止脚本；单容器 Dockerfile；Node 服务同时托管前端和 API |

## 16 个根目录 HTML 页面

页面总数按仓库根目录 `*.html` 实际文件统计为 **16**：新增 1 个统一移动端应用，同时保留 11 个桌面功能页、2 个鉴权页和 2 个展示/开发页。

| 类型 | 页面 | 用途 |
|---|---|---|
| 移动端 | `mobile.html` / `/mobile` | 新版手机应用：登录、健康摘要、测量、趋势、计划、评估、提醒、智能管家、知识、照护与账户设置 |
| 鉴权 | `login.html` | 登录、演示账号入口 |
| 鉴权 | `register.html` | 创建老人或家属账号并建立会话 |
| 功能 | `index.html` | 健康概览、待办、预警和快捷入口 |
| 功能 | `monitoring.html` | 指标录入、文本/语音批量识别、设备管理与同步 |
| 功能 | `assessment.html` | 健康评估、ADL/IADL 和改善建议 |
| 功能 | `agent.html` | 智能体对话、证据卡片、行动确认与随访 |
| 功能 | `knowledge.html` | 知识文章、GraphRAG 查询与证据展示 |
| 功能 | `prediction.html` | Curve、疾病风险、健康问卷和发现总览 |
| 功能 | `metric.html` | 单指标历史、趋势、预测区间和录入 |
| 功能 | `alerts.html` | 预警状态管理 |
| 功能 | `profile.html` | 个人资料、改密、授权关系和账号注销 |
| 功能 | `settings.html` | LLM 状态及管理员配置入口 |
| 功能 | `confidence.html` | 可信度评分细则 |
| 展示 | `showcase.html` | 产品展示页 |
| 开发 | `dev.html` | 开发导航与页面入口 |

## 项目核心创新

1. **从单点数值到可拒绝的个人曲线**：Curve 以真实时间戳、测量条件、异常点、滚动回测和预测区间组织结果；复杂模型不能稳定优于简单基线时返回趋势或拒绝原因。
2. **风险概率与数据完整度绑定**：疾病风险接口同时返回缺失特征、适用范围、模型版本和校准信息，避免把低完整度输入包装成确定结论。
3. **关系级证据治理的 GraphRAG**：结果不仅返回文本片段，还返回来源版本、证据等级、关系路径、冲突和医学审核状态，支持老人端安全门槛与审计视图。
4. **智能体建议进入可审计行动闭环**：敏感动作必须确认；复测任务能够与后续测量匹配并记录完成、拒绝、取消和回填结果。
5. **角色、主体和证据分离**：系统区分操作人（actor）和健康数据主体（subject），授权读取、问卷代录、工具调用及审计日志都绑定身份与权限。

## 医疗安全边界

- 系统用于健康管理演示、风险筛查和复测提示，不用于诊断、处方、用药调整或替代线下就医。
- 胸痛、呼吸困难、意识改变、单侧无力、言语含糊等危险信号优先提示急救，不等待模型预测。
- 张奶奶等演示账号数据及 Curve 干跑数据属于 `synthetic`，不得描述为真实临床数据或真实老人验证。
- GraphRAG 的 AI 预审核只用于证据分流；当前高风险关系仍待持证医生逐条审核与签字。
- 内部黄金集、口语改写留出集、合成干跑和 CHARLS 内部/时间切分属于内部验证，不等同于独立外部临床验证。
- 真实医疗使用前仍需伦理与授权流程、数据脱敏、独立外部队列验证、真实老人/医生人因研究和临床审核。

## 快速开始

### Windows 10/11 本地一键启动（推荐）

要求：PowerShell、可用的 Python 3.14 x64，以及可联网取得 Node 22.16.0（安装脚本通过 `npx` 使用固定 Node 版本）。

```powershell
Set-Location 'D:\BIGCHUANG\-'
.\scripts\Install-Local.ps1
.\scripts\Start-Local.ps1 -SkipSetup
```

服务和前端统一运行在 `http://localhost:3001/`，启动脚本默认打开新版移动端 `/mobile`。手机访问旧页面时会自动进入对应的新版移动视图；桌面端仍保留原页面。停止：

```powershell
.\scripts\Stop-Local.ps1
```

未配置私有模型包时，站点、Curve 和 GraphRAG 仍可运行，疾病人群模型在页面中显示降级/未安装。未配置 LLM 密钥时使用本地 Mock/工具降级，不伪装为真实大模型调用。

### Node 手动启动

要求 Node `>=22 <23`。

```powershell
Set-Location 'D:\BIGCHUANG\-\server'
npm ci
npm start
```

Node 服务已同时托管根目录静态页面，不需要另开 Python 静态服务器。移动端访问 `http://localhost:3001/mobile`，桌面端仍可访问 `http://localhost:3001/login.html`。

### Docker

```powershell
Set-Location 'D:\BIGCHUANG\-'
docker build -t evicare-local .
docker run --rm -p 3001:3001 -e LOGIN_RATE_STORE=sqlite evicare-local
```

上述命令用于单实例本地验收。生产环境默认使用 Redis 登录限速，需要设置 `REDIS_URL`，并应配置持久化数据库卷、HTTPS、受限 CORS 和密钥管理。

## 一键验收

首次执行先安装测试依赖：

```powershell
Set-Location 'D:\BIGCHUANG\-\server'
npm ci
Set-Location ..
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-test.txt
```

核心无副作用验收：

```powershell
Set-Location 'D:\BIGCHUANG\-\server'
npm test
```

测试会使用临时数据库/临时输出目录，并在前后比较 Git 状态。分组命令及 CI 说明见 [TESTING.md](TESTING.md)。

## API 速查

除健康检查和 `/api/auth/*` 外，其余 `/api/*` 均需登录。

| 模块 | 方法与路径 | 用途 |
|---|---|---|
| 健康检查 | `GET /api/health`、`GET /api/health/dependencies` | 服务、模型包和 Python 依赖状态 |
| 鉴权 | `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me` | 注册、登录、登出和会话检查 |
| 健康记录 | `GET /api/health/summary`、`GET /api/health/metrics`、`GET /api/health/metrics/:type/history`、`POST /api/health/metrics` | 摘要、最新值、历史和本人录入 |
| 批量识别 | `POST /api/health/metrics/parse-description` | 把文本/语音转写拆成待确认的指标草稿 |
| 评估/待办 | `/api/assessments*`、`/api/todos*`、`/api/alerts*` | 评估、待办和预警管理 |
| 设备 | `GET/POST /api/devices`、`PATCH /api/devices/:id`、`POST /api/devices/:id/sync` | 设备登记、状态和测量同步 |
| Curve/风险 | `/api/prediction/*`、`GET /api/trend/:type` | 个体曲线、健康发现、问卷和疾病风险 |
| GraphRAG | `GET /api/knowledge/graph/query`、`GET /api/knowledge/graph/sources`、`GET/POST /api/knowledge/graph/reviews` | 图谱查询、来源和审核数据 |
| 智能体 | `POST /api/chat`、`GET /api/chat/history`、`/api/chat/conversations*` | 对话、历史和会话管理 |
| 行动/随访 | `/api/actions*`、`/api/actions/followups*` | 建议、确认、执行和复测闭环 |
| 照护授权 | `POST /api/care/invitations`、`POST /api/care/accept`、`GET /api/care/relationships`、`GET /api/care/seniors/:id/summary` | 授权码、关系和只读摘要 |
| 账号 | `GET/PUT /api/profile/me`、`POST /api/profile/password`、`DELETE /api/profile/me` | 资料、改密和注销 |

完整路由事实以 `server/src/index.js` 和 `server/src/routes/` 为准。

## 项目结构

```text
.
├── *.html                         # 15 个根目录页面
├── assets/                        # 共享 CSS、API/鉴权/批量录入脚本
├── server/
│   ├── src/auth.js                # 注册、登录、登出、会话中间件
│   ├── src/services/authService.js# bcrypt、锁定、会话过期
│   ├── src/db.js                  # SQLite schema 与兼容迁移
│   ├── src/routes/                # 健康、预测、GraphRAG、行动、授权等路由
│   └── scripts/run-tests.mjs      # Node/Python 统一验收入口
├── ml/                            # Curve、疾病风险、模型包与验证工具
├── elderly-health-rag/            # GraphRAG 索引、检索、安全门槛与评测
├── tests/                         # Python 隔离、安全与回归测试
├── scripts/                       # 本地安装/启动/停止、容器启动脚本
├── deliverables/national_award/   # 提交材料、数据卡、模型卡、演示脚本
├── reports/                       # 内部审计、评测与外部验证协议
├── Dockerfile
├── FINAL_DELIVERY.md
└── TESTING.md
```

## 演示账号

| 账号 | 密码 | 说明 |
|---|---|---|
| 张奶奶 | `123456` | 合成演示数据较完整 |
| 李爷爷 | `123456` | 合成演示数据较少，用于展示数据不足与降级 |

演示密码在数据库中以 bcrypt 哈希保存。演示账号仅供本地评审体验；公开部署前仍应更换凭据、关闭或清理演示数据。

## 尚待外部完成

- 持证医生对高风险关系逐条审核、签字和版本化发布；
- 真实老人和医生参与的人因/可用性研究及伦理、知情同意；
- Curve 使用 60–90 天真实纵向数据、按参与者隔离的独立外部验证；
- 疾病风险模型在独立地区/机构/日期队列上的外部验证与再校准；
- 真实硬件型号的设备兼容、可靠性和合规验证；
- 面向生产环境的渗透测试、灾备、监控、隐私合规与医疗器械路径评估。
