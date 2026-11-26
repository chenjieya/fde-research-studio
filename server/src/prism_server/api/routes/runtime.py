"""运行接口：接收前端请求，再交给 RuntimeService 调用 SDK 和数据库。"""

import asyncio
import re
from typing import Annotated
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, Request, Response

from prism_server.api.responses import service_response
from prism_server.repositories.workspaces import WorkspaceRepository
from prism_server.schemas.media import MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MediaAsset
from prism_server.schemas.models import ConnectionInput, ConnectionRecord
from prism_server.schemas.providers import PROVIDERS, ProviderDefinition
from prism_server.schemas.runtime import Conversation, RunInput, RunRecord
from prism_server.schemas.workspace import Experiment
from prism_server.services.runtime import RuntimeService


def create_runtime_router(service: RuntimeService) -> APIRouter:
    """把准备好的 service 交给这组路由使用。"""
    router = APIRouter(prefix="/prism/runtime", tags=["工作台运行"])

    @router.get("/providers", response_model=list[ProviderDefinition])
    async def providers() -> list[ProviderDefinition]:
        """配置与运行窗口共享的官方服务目录，不包含任何账号凭据。"""
        return PROVIDERS

    @router.post("/media", response_model=MediaAsset, status_code=201)
    async def upload_media(request: Request, filename: Annotated[str, Query(min_length=1, max_length=200)]) -> MediaAsset:
        """原始二进制上传；流式限制大小，不依赖 multipart 或把文件放进 JSON。"""
        mime = request.headers.get("content-type", "").split(";", 1)[0]
        if mime not in {"image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm"}:
            raise HTTPException(415, "请选择 PNG、JPEG、WebP、GIF 图片或 MP4、WebM 视频。")
        limit = MAX_IMAGE_BYTES if mime.startswith("image/") else MAX_VIDEO_BYTES
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > limit:
                raise HTTPException(413, "文件过大，图片上限 10 MB，视频上限 32 MB。")
            raw.extend(chunk)
        return await service_response(asyncio.to_thread(service.media.save, bytes(raw), filename, mime))

    @router.api_route("/media/{media_id}", methods=["GET", "HEAD"])
    async def read_media(media_id: UUID, request: Request) -> Response:
        """支持浏览器视频 Range 请求；只按 UUID 读取当前工作空间的媒体。"""
        asset, raw = await service_response(asyncio.to_thread(service.media.get, str(media_id), content=request.method != "HEAD"))
        headers = {"Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600", "Content-Disposition": f"inline; filename*=UTF-8''{quote(asset.filename, safe='')}"}
        start, end, status = 0, asset.size - 1, 200
        requested = request.headers.get("range")
        if requested:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
            if not match or not any(match.groups()):
                return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{asset.size}"})
            left, right = match.groups()
            if left:
                start, end = int(left), min(int(right), end) if right else end
            else:
                start = max(0, asset.size - int(right))
            if start > end or (not left and int(right) == 0):
                return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{asset.size}"})
            status = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{asset.size}"
        headers["Content-Length"] = str(end - start + 1)
        return Response(raw[start:end + 1] if request.method != "HEAD" else b"", status_code=status, media_type=asset.mime_type, headers=headers)

    @router.get("/models", response_model=list[ConnectionRecord])
    async def model_connections() -> list[ConnectionRecord]:
        return await service_response(asyncio.to_thread(service.models.list))

    @router.put("/models/{model_id}", response_model=ConnectionRecord)
    async def save_model_connection(model_id: str, payload: ConnectionInput) -> ConnectionRecord:
        return await service_response(asyncio.to_thread(service.models.save, model_id, payload))

    @router.post("/conversations", response_model=Conversation, status_code=201)
    async def create_conversation() -> Conversation:
        return await service_response(asyncio.to_thread(service.repository.create_conversation, str(uuid4())))

    @router.get("/conversations", response_model=list[Conversation])
    async def list_conversations(offset: Annotated[int, Query(ge=0)] = 0) -> list[Conversation]:
        return await service_response(asyncio.to_thread(service.repository.list_conversations, offset))

    @router.get("/conversations/{conversation_id}/runs", response_model=list[RunRecord])
    async def conversation_runs(conversation_id: UUID) -> list[RunRecord]:
        return await service_response(service.conversation_runs(str(conversation_id)))

    @router.post("/runs/{run_id}/experiment", response_model=Experiment, status_code=201)
    async def confirm_experiment(run_id: UUID, payload: Experiment) -> Experiment:
        return await service_response(asyncio.to_thread(WorkspaceRepository(service.repository.database).confirm_run_experiment, str(run_id), payload))

    @router.get("/experiments/{experiment_id}/source", response_model=RunRecord | None)
    async def experiment_source(experiment_id: str) -> RunRecord | None:
        return await service_response(asyncio.to_thread(service.repository.experiment_source, experiment_id))

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

