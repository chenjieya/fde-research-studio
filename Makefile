# 后端启动快捷命令；前端使用 pnpm dev。
.PHONY: dev

dev:
	uv run --env-file .env langgraph dev --host 127.0.0.1 --port 2024
