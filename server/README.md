# 后端 API

Node.js 22 + Express + SQLite。服务同时托管仓库根目录的 15 个 HTML 页面和 `/api`，不需要另启静态服务器。

## 启动

```powershell
Set-Location 'D:\BIGCHUANG\-\server'
npm ci
npm start
```

Windows 固定 Node 22 启动也可使用：

```cmd
start-node22.bat
```

浏览器访问 `http://localhost:3001/login.html`；健康检查为 `GET http://localhost:3001/api/health`。

## 鉴权事实

- `POST /api/auth/register`：注册并自动建立会话；
- `POST /api/auth/login`：bcrypt 校验、失败计数、临时锁定和 IP/账号限速；
- `POST /api/auth/logout`：撤销当前会话；
- `GET /api/auth/me`：检查会话；
- 会话支持绝对过期和空闲过期，Cookie 为 HttpOnly + SameSite=Strict；
- 旧明文密码只在一次成功校验后迁移为 bcrypt，新密码和演示账号均以 bcrypt 保存。

## 主要模块

| 路径前缀 | 用途 |
|---|---|
| `/api/health` | 健康检查、指标摘要、历史、录入和文本批量识别 |
| `/api/prediction` | 健康问卷、Curve、发现总览和疾病风险 |
| `/api/knowledge` | 知识文章、GraphRAG 查询、来源和审核数据 |
| `/api/actions` | 需确认的智能体行动与复测随访 |
| `/api/care` | 家属/医生授权、授权摘要和关系撤销 |
| `/api/devices` | 设备登记、状态和同步入库 |
| `/api/chat` | 智能体对话、证据与历史 |
| `/api/profile` | 资料、改密和账号注销 |
| `/api/ops` | 按角色控制的运行指标、审计和依赖状态 |

完整路由以 `src/index.js` 和 `src/routes/` 为准，API 速查见仓库根目录 `README.md`。

## 权限边界

- 老人可管理本人健康记录和照护授权；
- 已授权家属/医生可读取老人摘要；
- 已授权家属可代填结构化健康问卷/档案；
- 直接代写血压等测量记录目前被拒绝，不应写成“家属可代录所有健康数据”；
- 管理配置、运行指标和审计日志使用独立 capability 检查。

## LLM 与模型降级

复制 `.env.example` 为 `.env` 后可配置 OpenAI 兼容 LLM。密钥留空时使用明确标记的 Mock/本地工具降级。私有人群模型包未安装时，主站、Curve 和 GraphRAG 仍可运行，风险页面显示模型包未安装/降级，不生成伪概率。

## 测试

```powershell
npm test
```

要求 Node `>=22 <23`。该命令运行 Node 单元/集成、Python 单元、GraphRAG、Curve、安全和语法检查，并保证测试不改写 Git 工作区。详见根目录 `TESTING.md`。

## 生产边界

本仓库默认配置用于本地工程验收。生产环境应使用 Redis 登录限速、HTTPS、受限 CORS、持久化与备份、集中密钥管理、监控审计及合规评估。健康评分、风险模型和 GraphRAG 不能替代医生诊断或医疗处置。
