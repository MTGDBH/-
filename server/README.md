# 老年人健康管理网站 · 后端 API

> Node.js + Express + SQLite · 零配置即跑

## 一、文件结构

```
server/
├── package.json          # 依赖 + 脚本（npm start / seed / reset / dev）
├── .env.example          # 环境变量模板（拷贝为 .env 后填 OPENAI_API_KEY 即可启用真实 LLM）
├── start.sh              # macOS / Linux 一键启动
├── start.bat             # Windows 一键启动
├── data/
│   ├── app.db            # SQLite 数据库（首次启动自动生成）
│   └── seed.js           # 种子数据脚本（与设计稿一致：86 分、128/85、4,820 步……）
└── src/
    ├── index.js          # 入口：CORS、路由挂载、健康检查
    ├── db.js             # SQLite 连接 + 表结构（启动自动建表）
    ├── lib/scoring.js    # 健康评分算法（5 大子项 + 总分 + 改善建议）
    ├── ai/agent.js       # AI 智能体：OpenAI 兼容接口 / Mock 回退
    └── routes/
        ├── health.js     # GET /api/health/summary, /metrics, POST /metrics
        └── api.js        # assessments, todos, devices, alerts, chat
```

## 二、快速开始

### macOS / Linux
```bash
./start.sh
```

### Windows
```cmd
start.bat
```

### 手动
```bash
npm install
node data/seed.js
npm start
```

启动成功后会看到：

```
🩺 老年人健康管家 API 已启动
   地址:  http://localhost:3001
   模式:  Mock  （填入 OPENAI_API_KEY 后会自动切到 LLM）
   数据库: .../data/app.db
```

打开 http://localhost:3001/api/health 应返回 `{ok:true}`。

## 三、AI 模式切换

环境变量留空 → 自动用 Mock 智能体（关键词匹配 + 模板回复）  
填入 `OPENAI_API_KEY` → 自动切到真实 LLM

兼容：OpenAI / DeepSeek / 通义千问 / Ollama / 任何 OpenAI 兼容协议

```bash
# .env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.deepseek.com/v1   # 默认是 OpenAI
OPENAI_MODEL=deepseek-chat
```

**切换无需改代码**，重启服务即生效。

## 四、API 一览

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/health/summary` | 今日健康摘要（分数+子项+待办+预警） |
| GET | `/api/health/metrics` | 8 项指标最新值 |
| GET | `/api/health/metrics/:type/history?days=7` | 单项历史 |
| POST | `/api/health/metrics` | 录入一条数据 |
| GET | `/api/assessments/latest` | 最近评估（实时计算） |
| POST | `/api/assessments` | 触发一次完整评估并存档 |
| GET | `/api/assessments` | 历史评估列表 |
| GET | `/api/todos/today` | 今日待办 |
| PATCH | `/api/todos/:id` | 标记完成/未完成 |
| GET | `/api/devices` | 设备列表 |
| GET | `/api/alerts?status=pending` | 预警列表 |
| PATCH | `/api/alerts/:id` | 更新预警状态 |
| POST | `/api/chat` | 智能体对话 |
| GET | `/api/chat/history` | 对话历史 |

## 五、前端对接

在 `assets/js/main.js` 里修改一行：

```js
const API_BASE = 'http://localhost:3001';
```

> 注意：浏览器跨域请求本地 API 时，前端要用 HTTP 服务方式打开（不能 `file://`）。
> 推荐启动一个静态服务：
>
> ```bash
> # 在项目根目录
> python3 -m http.server 3000
> # 然后访问 http://localhost:3000
> ```

或者把前端也部署在 Node 服务的 `/` 下（修改 `src/index.js` 加上 `app.use(express.static('../'))`）。

## 六、待办清单（同学接手时主要做的）

- [ ] 前端 4 个 HTML 替换硬编码为 API 调用
- [ ] 用户登录（目前 hardcode user_id=1）
- [ ] 设备配网流程（蓝牙/Wi-Fi 配对）
- [ ] 真正的医学级别评分（接入医生审核过的规则库）
- [ ] LLM 上下文记忆（目前只取最近 10 条对话）
- [ ] 多租户 / 家庭账号体系
- [ ] 移动端 H5 适配

## 七、调试小贴士

```bash
# 看数据库内容
sqlite3 data/app.db "SELECT * FROM metrics LIMIT 10;"

# 重置数据
npm run reset

# 开发模式（文件变更自动重启）
npm run dev
```

## 八、技术决策说明

- **为什么用 better-sqlite3 而非 sqlite3**：同步 API、无回调地狱、性能更好，单文件后端首选
- **为什么不用 ORM（Prisma/TypeORM）**：本项目表少，ORM 反而是负担
- **为什么不用 axios**：Node 22 原生 fetch 足够，零依赖
- **为什么不用 LLM SDK**：OpenAI 兼容协议是 fetch 一个 POST，SDK 多一层封装没收益
