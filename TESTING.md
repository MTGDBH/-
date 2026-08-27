# 测试与 CI

本仓库的测试默认无副作用。测试运行器会设置 UTF-8 环境、关闭 Python 字节码写入，并在开始和结束时比较 `git status --porcelain`；如果测试改变任何跟踪文件或新增未跟踪文件，测试失败。

受保护的正式产物不会作为测试输出目标：

- `elderly-health-rag/output/`
- `reports/`
- `ml/reports/`
- `server/data/app.db`

GraphRAG 构建和评测测试分别通过 `output_path`、`report_path` 写入系统临时目录。Node 数据库测试先复制 `server/data/app.db`（若不存在则在临时目录初始化），所有迁移和测试写入只发生在副本中。

## Windows 本地运行

要求 Node `>=20 <23`（推荐仓库 `.nvmrc` 指定的 Node 22）和 Python 3.13。PowerShell 命令：

若本机默认 Node 超出 engines 范围，测试运行器会自动通过 `npx node@22.16.0` 重新执行；生产启动仍应直接使用 Node 20 或 22。

```powershell
cd D:\BIGCHUANG\-\server
npm ci

cd ..
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-test.txt

cd server
npm test
```

`npm test` 是核心验收入口，依次运行 Node 单元/集成测试、Python 单元测试、GraphRAG、安全、Curve 防泄漏以及语法和 UTF-8 检查。

可单独运行：

```powershell
npm run test:unit
npm run test:integration
npm run test:graphrag
npm run test:curve
npm run test:security
npm run test:syntax
```

Python 统一入口也可从仓库根目录直接使用：

```powershell
.\.venv\Scripts\python.exe scripts\run_python_tests.py unit
.\.venv\Scripts\python.exe scripts\run_python_tests.py graphrag
.\.venv\Scripts\python.exe scripts\run_python_tests.py curve
.\.venv\Scripts\python.exe scripts\run_python_tests.py security
.\.venv\Scripts\python.exe scripts\run_python_tests.py syntax
```

## 显式产物路径

手动进行 GraphRAG 构建时应明确给出隔离路径；只有需要刷新正式文档时才使用 `--update-docs`：

```powershell
python elderly-health-rag\graphrag_index.py build `
  --output-path $env:TEMP\graphrag-output `
  --report-path $env:TEMP\graphrag-reports\index-stats.json
```

Curve 时间验证同样要求显式报告路径：

```powershell
python ml\curve\temporal_validation.py `
  --out $env:TEMP\curve\metrics.json `
  --report-path $env:TEMP\curve\report.md
```

该报告包含 horizon-specific、pooled、lead-time scaled pooled 和 block conformal 的 coverage–width–refusal 对比。默认区间使用有限样本次序统计量；算法说明见 `ml/curve/CONFORMAL.md`。合成场景只验证行为和覆盖逻辑，不支持真实准确率或临床宣称。

## CI

GitHub Actions 在 Node 20 和 22 上运行 Node 单元及集成测试，并在 Node 22 任务中用 Python 3.13 安装 `requirements-test.txt`，执行 Python 单元测试、GraphRAG 安全回归、Curve 防泄漏回归和语法检查。Docker job 依赖整个测试矩阵，任何测试（包括安全测试）失败时不会构建或推送镜像。
