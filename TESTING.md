# 测试、CI 与验收

本仓库的统一测试入口是 `server/scripts/run-tests.mjs`。测试使用临时数据库和临时报告目录，设置 UTF-8、关闭 Python 字节码写入，并比较测试前后的 `git status --porcelain`；若测试修改跟踪文件或产生未跟踪文件，验收失败。

受保护的正式产物不会作为测试输出目标：

- `elderly-health-rag/output/`
- `reports/`
- `ml/reports/`
- `server/data/app.db`

## 环境要求

- Node.js `>=22 <23`；`server/package.json`、`.nvmrc` 和 CI 均以 Node 22 为准。
- CI 使用 Python 3.13。本地完整测试可使用仓库现有 `.venv`，但必须能安装 `requirements-test.txt`。
- Windows 生产/演示安装脚本使用 Python 3.14 x64；这是本地推理部署要求，不应与 CI 的 Python 3.13 测试环境混写。

## 首次安装测试依赖

```powershell
Set-Location 'D:\BIGCHUANG\-\server'
npm ci

Set-Location ..
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-test.txt
```

若仓库已有可用 `.venv`，无需重建。

## 一键核心验收

```powershell
Set-Location 'D:\BIGCHUANG\-\server'
npm test
```

`npm test` 依次覆盖：

1. Node 单元测试；
2. 隔离数据库上的 Node 集成测试；
3. Python 单元测试；
4. GraphRAG 构建隔离与安全回归；
5. Curve 防泄漏/回归包装器；
6. 运行时与容器卫生安全测试；
7. Node 语法、Python 语法与 UTF-8 检查；
8. 测试前后 Git 工作区不变检查。

## 分组验收

在 `server` 目录运行：

```powershell
npm run test:unit
npm run test:integration
npm run test:graphrag
npm run test:curve
npm run test:security
npm run test:syntax
```

Python 入口也可在仓库根目录直接运行：

```powershell
.\.venv\Scripts\python.exe scripts\run_python_tests.py unit
.\.venv\Scripts\python.exe scripts\run_python_tests.py graphrag
.\.venv\Scripts\python.exe scripts\run_python_tests.py curve
.\.venv\Scripts\python.exe scripts\run_python_tests.py security
.\.venv\Scripts\python.exe scripts\run_python_tests.py syntax
```

## 重点能力对应测试

| 能力 | 直接证据 |
|---|---|
| 注册、bcrypt 迁移、锁定、会话过期、登出 | `server/data/test_auth_integration.mjs` |
| 家属授权、只读摘要、问卷代录、禁止直接代写测量值 | `server/data/test_care_permissions.mjs` |
| 设备同步写入 `source=device` | `server/data/test_device_sync.mjs` |
| 权限矩阵 | `server/src/test_permission_matrix.js` |
| 智能体工具与行动不自动执行 | `server/src/test_agent_orchestrator_v2.js`、`server/data/test_agent_tools.mjs` |
| 复测随访闭环 | `server/src/test_agent_followup_v3.js`、`server/data/test_quality_followup_review.mjs` |
| Curve | `tests/test_curve_regression_wrappers.py` 及 `ml/curve/test_*.py` |
| GraphRAG 隔离与安全门槛 | `tests/test_graphrag_isolation.py` |
| 容器不携带密钥、数据库或缓存产物 | `tests/test_container_hygiene.py` |

统一 `npm test` 是文档所承诺的一键核心验收；上表部分专项脚本用于更细粒度审计，并非全部包含在核心入口中。

## 手动生成临时验证产物

GraphRAG 构建必须明确使用临时路径；只有有意刷新正式报告时才使用 `--update-docs`：

```powershell
$graphOut = Join-Path $env:TEMP 'evicare-graphrag-output'
$graphReport = Join-Path $env:TEMP 'evicare-graphrag-reports\index-stats.json'
.\.venv\Scripts\python.exe elderly-health-rag\graphrag_index.py build `
  --output-path $graphOut `
  --report-path $graphReport
```

Curve 时间验证同样写入临时目录：

```powershell
$curveOut = Join-Path $env:TEMP 'evicare-curve\metrics.json'
$curveReport = Join-Path $env:TEMP 'evicare-curve\report.md'
.\.venv\Scripts\python.exe ml\curve\temporal_validation.py `
  --out $curveOut `
  --report-path $curveReport
```

合成场景只验证算法行为、拒绝逻辑和覆盖计算，不支持真实准确率、临床有效性或外部验证宣称。

## 启动冒烟检查

```powershell
Set-Location 'D:\BIGCHUANG\-'
.\scripts\Start-Local.ps1 -SkipSetup
Invoke-RestMethod http://localhost:3001/api/health
Invoke-WebRequest http://localhost:3001/login.html -UseBasicParsing | Select-Object StatusCode
.\scripts\Stop-Local.ps1
```

预期：健康检查 `ok=true`，登录页 HTTP 状态为 `200`。模型包或 LLM 未配置时可以是明确的降级状态，不应伪装为已安装或真实在线调用。

## Docker 验收

```powershell
Set-Location 'D:\BIGCHUANG\-'
docker build -t evicare-local .
docker run --rm -p 3001:3001 -e LOGIN_RATE_STORE=sqlite evicare-local
```

另开终端执行 `Invoke-RestMethod http://localhost:3001/api/health`。`LOGIN_RATE_STORE=sqlite` 仅用于单实例本地容器验收；生产模式默认要求 Redis 和 `REDIS_URL`。

## CI

`.github/workflows` 当前只运行 Node 22 + Python 3.13，不再宣称 Node 20 矩阵。CI 依次执行所有分组测试；Docker job 依赖测试 job，通过后构建镜像并检查镜像内不包含 `.env`、SQLite 数据库或 `.pyc`，非 PR 事件再推送 GHCR。

## 结果解释

- **工程测试通过**：证明当前仓库代码路径在隔离环境可运行。
- **内部验证通过**：证明固定内部数据集、合成夹具或研究队列切分下的指标可复现。
- **不代表**：真实临床有效性、持证医生审核、独立地区外部验证或真实用户可用性结论。

## 2026-08-28 实测记录

- `npm test`：PASS；Node 24 自动切换到 Node 22.16.0，全部 Node/Python/GraphRAG/Curve/安全/语法分组通过，Git 状态未被测试改变。
- `Start-Local.ps1 -SkipSetup` + `/api/health` + `/login.html` + `Stop-Local.ps1`：PASS；健康检查成功、登录页 HTTP 200、服务正常停止。
- Docker 镜像实机构建：未执行（当前主机无 Docker CLI）；容器卫生自动测试已通过，但不得据此宣称实机镜像构建通过。

完整记录见 `reports/documentation-capability-audit-20260828.md`。
