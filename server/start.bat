@echo off
REM 一键启动后端（Windows）
chcp 65001 > nul
cd /d "%~dp0"

echo === 安装依赖 ===
if not exist "node_modules\" (
  call npm install
  if errorlevel 1 exit /b 1
) else (
  echo 已安装,跳过
)

echo === 填充种子数据 ===
call node data/seed.js
if errorlevel 1 exit /b 1

if not exist ".env" if exist ".env.example" (
  copy .env.example .env > nul
  echo 已生成 .env ^(OPENAI_API_KEY 留空走 Mock^)
)

echo.
echo === 启动 API 服务 ===
echo 前端访问: http://localhost:3001/api/health
echo 按 Ctrl+C 退出
echo.
call npm start
