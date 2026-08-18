#!/usr/bin/env bash
# 一键启动后端（macOS / Linux）
# 自动安装依赖 → 填充种子数据 → 启动服务

set -e
cd "$(dirname "$0")"

echo "📦 安装依赖..."
if [ ! -d "node_modules" ]; then
  npm install
else
  echo "   已安装，跳过"
fi

echo "🌱 填充种子数据..."
node data/seed.js > /dev/null && echo "   完成"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  echo "📝 已生成 .env（OPENAI_API_KEY 留空走 Mock，填上启用真实 LLM）"
fi

echo ""
echo "🚀 启动 API 服务..."
echo "   前端访问:  http://localhost:3001/api/health"
echo "   按 Ctrl+C 退出"
echo ""
npm start
