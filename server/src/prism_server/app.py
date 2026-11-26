"""创建工作台的 FastAPI 应用，供 Agent Server 一起加载。"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from prism_server.api.routes.runtime import create_runtime_router
from prism_server.api.routes.workspace import create_workspace_router
from prism_server.core.config import Settings
from prism_server.db.postgres import PostgresDatabase
from prism_server.repositories.runtime_runs import RunRepository
from prism_server.repositories.workspaces import WorkspaceRepository
from prism_server.services.runtime import RuntimeService

logger = logging.getLogger(__name__)


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

    @application.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, error: RequestValidationError) -> JSONResponse:
        """跨字段校验可能包含整份接入表单，错误响应不回显密钥或原始素材。"""
        return JSONResponse(status_code=422, content={"detail": [{key: item[key] for key in ("loc", "type", "msg")} for item in error.errors()]})

    @application.exception_handler(psycopg.Error)
    async def database_unavailable(request: Request, error: psycopg.Error) -> JSONResponse:
        """只记录操作位置、异常类型和 SQLSTATE，避免异常文本泄露连接串或 SQL 参数。"""
        code = error.sqlstate
        logger.error("数据库操作失败 method=%s path=%s error_type=%s sqlstate=%s", request.method, request.url.path, type(error).__name__, code or "unknown")
        if code == "57014":
            status, detail = 504, "数据库查询或写入超时，请稍后重试；这不一定是 SSH 隧道中断。"
        elif code in {"55P03", "40P01", "40001"}:
            status, detail = 409, "数据库操作遇到锁等待或并发冲突，请稍后重试。"
        elif code in {"28P01", "28000"}:
            status, detail = 503, "数据库认证失败，请检查服务端数据库账号配置。"
        elif isinstance(error, psycopg.IntegrityError):
            status, detail = 409, "记录保存遇到重复、关联或数据约束冲突，请刷新并核对记录后重试。"
        elif isinstance(error, (psycopg.OperationalError, psycopg.InterfaceError)):
            status, detail = 503, "数据库连接失败，请检查数据库服务与 SSH 隧道后重试。"
        else:
            status, detail = 500, "数据库操作失败，请查看服务端日志中的异常类型和 SQLSTATE。"
        if code:
            detail += f"（SQLSTATE: {code}）"
        return JSONResponse(status_code=status, content={"detail": detail})

    return application


# langgraph.json 的 http.app 指向这里；开发时不用再单独启动一份 uvicorn。
app = create_app()
