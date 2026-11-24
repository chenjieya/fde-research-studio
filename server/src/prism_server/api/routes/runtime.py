"""运行接口：接收前端请求，再交给 RuntimeService 调用 SDK 和数据库。"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from prism_server.api.responses import service_response
from prism_server.schemas.runtime import RunInput, RunRecord
from prism_server.services.runtime import RuntimeService


def create_runtime_router(service: RuntimeService) -> APIRouter:
    """把准备好的 service 交给这组路由使用。"""
    router = APIRouter(prefix="/prism/runtime", tags=["工作台运行"])

    @router.get("/health")
    async def health() -> dict[str, object]:
        """返回服务和追踪配置，供运行窗口展示。"""
        return service.health()

    @router.get("/graph")
    async def compiled_graph() -> dict[str, object]:
        """通过 SDK 读取 Agent Server 已注册的图。"""
        return await service_response(service.compiled_graph())

    @router.get("/runs", response_model=list[RunRecord])
    async def list_runs(
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> list[RunRecord]:
        return await service_response(service.list_runs(limit, offset))

    @router.post("/runs", response_model=RunRecord, status_code=201)
    async def create_run(payload: RunInput) -> RunRecord:
        """启动一次图运行，返回工作台保存的运行编号。"""
        return await service_response(service.create_run(payload))

    @router.get("/runs/{run_id}", response_model=RunRecord)
    async def get_run(run_id: UUID) -> RunRecord:
        """查询运行状态，结束后同时取回图的结果。"""
        return await service_response(service.get_run(run_id))

    @router.post("/runs/{run_id}/cancel", response_model=RunRecord)
    async def cancel_run(run_id: UUID) -> RunRecord:
        """向 Agent Server 请求中断运行，再查询实际状态。"""
        return await service_response(service.cancel_run(run_id))

    @router.post("/runs/{run_id}/trace", response_model=RunRecord)
    async def verify_trace(run_id: UUID) -> RunRecord:
        """到 LangSmith 查找本次运行，查到后才标记为已核验。"""
        return await service_response(service.verify_trace(run_id))

    return router

