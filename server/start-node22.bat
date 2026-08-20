@echo off
REM Windows 本地启动：better-sqlite3 当前使用 Node 22 ABI。
REM 首次运行会由 npx 下载/缓存 node-win-x64@22.16.0。
chcp 65001 > nul
cd /d "%~dp0"

echo === Node 版本 ===
call npx --yes node@22.16.0 --version
if errorlevel 1 exit /b 1

if not exist "node_modules\" (
  echo 请先执行 npm install，再用本脚本启动。
  exit /b 1
)

echo === 填充种子数据 ===
call npx --yes node@22.16.0 data/seed.js
if errorlevel 1 exit /b 1

echo.
echo === 启动 API 服务（Node 22） ===
echo 前端访问: http://localhost:3001/api/health
echo 按 Ctrl+C 退出
echo.
call npx --yes node@22.16.0 src/index.js
