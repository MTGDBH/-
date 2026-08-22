# 老年人健康管理智能体 · 完整网站

> 「小康·健康管家」—— 一套面向老年人的健康管理网站，含登录 + 9 个页面 + Node 后端 API。  
> 设计稿：https://ardot.tencent.com/file/715873789077397  
> 视觉风格：温暖亲和（暖杏 + 米白 + 思源黑体）

## 9 个页面一览

| 页面 | 用途 | 路径 |
|---|---|---|
| 登录页 | 账号密码登录 | `login.html` |
| 概览 | 今日健康分 + 待办 + 预警 + 快捷入口 | `index.html` |
| 健康监测 | 8 项数据录入 + 设备 + AI 7 日预测 | `monitoring.html` |
| 健康评估 | 总评分 + 5 子项 + ADL/IADL + 改善建议 | `assessment.html` |
| 智能管家 | AI 对话 + 5 步方案 + 方案/问答/贴士切换 | `agent.html` |
| 健康知识 | 科普 / 问答 / 贴士三类文章 + 搜索 | `knowledge.html` |
| 个人资料 | 基本信息 + 紧急联系人 + 修改密码 + 注销 | `profile.html` |
| 单指标趋势 | 7/30/90/365 天折线图 + AI 评价 + 录入 | `metric.html?type=bp` |
| 预警中心 | 待处理 / 已读 / 已解决 + 全部已读 | `alerts.html` |

## 演示账号

| 账号 | 密码 | 数据完整度 |
|---|---|---|
| 张奶奶 | `123456` | 完整（推荐体验用） |
| 李爷爷 | `123456` | 部分（仅血压/心率/血氧） |

⚠️ **本系统为本地演示，密码明文存储，切勿放公网。**

## 文件结构

```
老年人健康管理网站/
├── login.html              ← 登录页
├── index.html              ← 概览
├── monitoring.html         ← 健康监测
├── assessment.html         ← 健康评估
├── agent.html              ← 智能管家
├── knowledge.html          ← 健康知识
├── profile.html            ← 个人资料
├── metric.html             ← 单指标趋势
├── alerts.html             ← 预警中心
├── assets/
│   ├── css/styles.css      ← 共享样式（设计令牌 + 所有页面组件）
│   └── js/
│       ├── api.js          ← fetch 封装 + 401 自动跳登录
│       ├── auth.js         ← 自动注入顶部导航 + 路由守卫
│       └── main.js         ← 通用工具（日期/Toast/Tabs）
├── design-tokens.md        ← 设计令牌
├── README.md               ← 本文件
├── 截图/                    ← 4 张视觉稿对照图
└── server/                 ← 后端 API
    ├── start.sh / start.bat
    ├── package.json
    ├── .env.example
    ├── data/seed.js        ← 种子数据（2 用户 + 8 知识文章 + 7 天历史指标）
    ├── src/
    │   ├── index.js        ← 入口
    │   ├── db.js           ← SQLite schema（自动建表 + 升级兼容）
    │   ├── auth.js         ← login/logout/me + session 中间件
    │   ├── lib/scoring.js  ← 5 子项评分算法
    │   ├── ai/agent.js     ← LLM 兼容接口 + Mock 回退
    │   └── routes/
    │       ├── health.js   ← /summary /metrics /metrics/:type/history
    │       ├── api.js      ← 评估/待办/设备/对话
    │       ├── profile.js  ← 用户资料 + 改密码 + 注销
    │       ├── knowledge.js ← 健康知识文章 CRUD
    │       ├── alerts.js   ← 预警中心
    │       └── trend.js    ← 单指标 30 天趋势 + AI 评价
    └── README.md
```

## 快速开始

### Windows 10/11 一键部署（推荐）

在 PowerShell 中从项目根目录运行：

```powershell
.\scripts\Install-Local.ps1
.\scripts\Start-Local.ps1 -SkipSetup
```

安装脚本固定使用 Node 22.16 和 Python 3.14 x64，在项目 `.venv` 中安装推理依赖，并初始化 SQLite。启动成功后会打开 `http://localhost:3001/prediction.html`。停止服务：

```powershell
.\scripts\Stop-Local.ps1
```

人群模型通过私有签名 URL 分发。在 `server\.env` 配置 `MODEL_BUNDLE_URL` 和 `MODEL_BUNDLE_SHA256`；留空时主系统及 Curve V2 正常启动，预测页会明确显示模型包未安装。模型维护者可运行：

```powershell
.\scripts\New-ModelBundle.ps1 -Version 2026.08.22
```

生成的 ZIP 位于被 Git 忽略的 `private-artifacts`，只包含校验过的推理产物，不包含 CHARLS 原始数据。

### 1. 启动后端

**macOS / Linux**
```bash
cd server
./start.sh
```

**Windows**
```cmd
cd server
start.bat
```

看到以下输出即成功：

```
🩺 老年人健康管家 API 已启动
   地址:  http://localhost:3001
   模式:  Mock
```

### 2. 启动前端

**任意静态服务器**（任选其一）：
```bash
# 方式 A：Python
cd 老年人健康管理网站
python3 -m http.server 3000

# 方式 B：Node
npx http-server -p 3000
```

**⚠️ 必须用 HTTP 服务方式打开**，不能直接 `file://` —— 因为要用 cookie 和 fetch API。

浏览器打开 **http://localhost:3000/login.html** 开始。

### 3. （可选）启用真实 LLM

编辑 `server/.env`：

```bash
cp server/.env.example server/.env
# 编辑填入：
OPENAI_API_KEY=sk-xxxxx
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat
```

重启 server（`./start.sh` 重跑一次即可），自动从 Mock 切到真实 LLM。

## API 速查（所有 `/api/*` 都需要登录）

| 方法 | 路径 | 用途 |
|---|---|---|
| **鉴权（无需登录）** | | |
| POST | `/api/auth/login` | 登录（identifier + password） |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 当前用户信息 |
| **健康** | | |
| GET | `/api/health/summary` | 今日健康分 + 子项 + 待办 + 预警 |
| GET | `/api/health/metrics` | 8 项指标最新值 |
| GET | `/api/health/metrics/:type/history?days=7` | 单项历史 |
| POST | `/api/health/metrics` | 录入一条数据 |
| GET | `/api/assessments/latest` | 最近评估（实时计算） |
| POST | `/api/assessments` | 触发并保存一次评估 |
| GET | `/api/assessments` | 历史评估列表 |
| GET | `/api/todos/today` | 今日待办 |
| PATCH | `/api/todos/:id` | 标记完成 |
| POST | `/api/todos` | 新增待办 |
| DELETE | `/api/todos/:id` | 删除待办 |
| GET | `/api/devices` | 设备列表 |
| GET | `/api/trend/types` | 8 种指标类型元数据 |
| GET | `/api/trend/:type?days=N` | 单指标 7/30/90/365 天趋势 + AI 评价 |
| **对话** | | |
| POST | `/api/chat` | 给 AI 发消息 |
| GET | `/api/chat/history` | 对话历史 |
| **资料** | | |
| GET | `/api/profile/me` | 个人信息 |
| PUT | `/api/profile/me` | 修改信息 |
| POST | `/api/profile/password` | 修改密码 |
| DELETE | `/api/profile/me` | 注销账号 |
| **知识** | | |
| GET | `/api/knowledge` | 文章列表（支持 `?category=`、`?q=`） |
| GET | `/api/knowledge/:id` | 文章详情 |
| GET | `/api/knowledge/meta/popular-tags` | 热门标签 |
| **预警** | | |
| GET | `/api/alerts?status=pending` | 预警列表 |
| GET | `/api/alerts/summary` | 预警数量摘要 |
| PATCH | `/api/alerts/:id` | 更新预警状态 |
| POST | `/api/alerts/read-all` | 全部已读 |

## 关键设计决策

- **零前端构建**：HTML+CSS+JS 直接跑，无 webpack/vite
- **零后端外部依赖**：不填 LLM key 也能完整 demo
- **OpenAI 兼容 LLM**：DeepSeek / 通义千问 / Ollama 都能切
- **SQLite 单文件**：跟代码走
- **路由守卫**：所有页面通过 `Auth.init()` 自动检查登录，未登录跳 login.html
- **数据驱动 UI**：所有页面 JS 拉 API 渲染，不用写死数据
- **可视化**：SVG 圆环（健康评估）、SVG 折线（趋势）、SVG 大图标（无 icon font 依赖）

## 设计依据

- **设计稿**：https://ardot.tencent.com/file/715873789077397
- **设计令牌**：./design-tokens.md
- **4 张视觉稿对照图**：./截图/

## 待办清单（后续迭代）

- [ ] 真实 LLM 接入（替换 OpenAI API key）
- [ ] 用户注册流程（目前只有登录）
- [ ] 移动端 H5 完整适配（< 768px）
- [ ] 设备配网流程（蓝牙/Wi-Fi）
- [ ] 真实医学级别评分（接医生审核过的规则）
- [ ] 推送通知（用药提醒、紧急预警）
- [ ] 多账号 / 家庭账号体系
- [ ] 可访问性（字号缩放、语音播报）
