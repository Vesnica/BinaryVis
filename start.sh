#!/bin/bash

# BinaryVis 启动脚本

set -e

echo "==================================="
echo "  BinaryVis 启动脚本"
echo "==================================="

# 检查是否在正确的目录
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo "错误: 请在 BinaryVis 根目录下运行此脚本"
    exit 1
fi

# 启动后端
echo ""
echo ">>> 启动后端服务器..."
cd backend

# 创建上传目录
mkdir -p uploads

# 后台运行后端
cargo run --release > ../backend.log 2>&1 &
BACKEND_PID=$!
echo "后端进程 PID: $BACKEND_PID"

cd ..

# 等待后端启动
echo "等待后端启动..."
sleep 3

# 检查后端是否启动成功
if ! curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "警告: 后端可能未成功启动，请检查 backend.log"
fi

# 启动前端
echo ""
echo ">>> 启动前端开发服务器..."
cd frontend

# 检查是否已安装依赖
if [ ! -d "node_modules" ]; then
    echo "安装前端依赖..."
    npm install
fi

# 启动前端开发服务器
npm run dev

# 清理：当前端退出时，也停止后端
echo ""
echo ">>> 清理..."
kill $BACKEND_PID 2>/dev/null || true
echo "已停止所有服务"
