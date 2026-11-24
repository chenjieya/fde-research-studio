"""研究空间接口：读取、保存整份记录，以及迁入旧浏览器数据。"""

import asyncio

from fastapi import APIRouter

from prism_server.api.responses import service_response
from prism_server.repositories.workspaces import WorkspaceRepository
from prism_server.schemas.workspace import WorkspaceImport, WorkspaceSnapshot, WorkspaceWrite


def create_workspace_router(repository: WorkspaceRepository) -> APIRouter:
    """把数据库仓库交给路由，较慢的同步读写放进工作线程。"""
    router = APIRouter(prefix="/prism/workspace", tags=["研究空间"])

    @router.get("", response_model=WorkspaceSnapshot)
    async def get_workspace() -> WorkspaceSnapshot:
        """一起返回研究记录和版本号，保存时需要带回这个版本号。"""
        return await service_response(asyncio.to_thread(repository.get))

    @router.put("", response_model=WorkspaceSnapshot)
    async def save_workspace(payload: WorkspaceWrite) -> WorkspaceSnapshot:
        """只有版本号仍然一致才保存，避免覆盖别的页面刚写入的数据。"""
        return await service_response(asyncio.to_thread(repository.save, payload.data, payload.expected_revision))

    @router.post("/import", response_model=WorkspaceSnapshot)
    async def import_workspace(payload: WorkspaceImport) -> WorkspaceSnapshot:
        """导入旧浏览器记录；同一份数据重复提交只处理一次。"""
        return await service_response(asyncio.to_thread(repository.import_legacy, payload.data, payload.source_id))

    return router
