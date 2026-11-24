"""创建工作台的 FastAPI 应用，供 Agent Server 一起加载。"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from prism_server.api.routes.runtime import create_runtime_router
from prism_server.api.routes.workspace import create_workspace_router
from prism_server.core.config import Settings
from prism_server.db.postgres import PostgresDatabase
from prism_server.repositories.runtime_runs import RunRepository
from prism_server.repositories.workspaces import WorkspaceRepository
from prism_server.services.runtime import RuntimeService


def create_app(service: RuntimeService | None = None) -> FastAPI:
    """组装接口和业务服务；测试时可以传入单独准备的 service。"""
    if service is None:
        settings = Settings.from_env()
        service = RuntimeService(settings, RunRepository(PostgresDatabase(settings.database_url)))
    runtime = service

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # 服务启动时检查数据库表结构，不在每个请求里重复初始化。
        await runtime.initialize()
        yield

    application = FastAPI(title="Prism 工作台运行 API", lifespan=lifespan)
    application.include_router(create_runtime_router(runtime))
    application.include_router(create_workspace_router(WorkspaceRepository(runtime.repository.database)))

    @application.exception_handler(psycopg.Error)
    async def database_unavailable(_: Request, __: psycopg.Error) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": "数据库暂不可用，请检查数据库服务与 SSH 隧道后重试。"})

    return application


# langgraph.json 的 http.app 指向这里；开发时不用再单独启动一份 uvicorn。
app = create_app()
