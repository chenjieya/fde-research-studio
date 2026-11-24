"""处理图运行的完整过程：调用 SDK、保存记录、查询结果和核验追踪。"""

import asyncio
import logging
from collections.abc import Callable
from functools import partial
from typing import cast
from urllib.parse import urlencode, urlparse
from uuid import UUID, uuid4

from langgraph_sdk.client import LangGraphClient

from prism_server.core.clock import utc_now
from prism_server.core.config import Settings
from prism_server.core.exceptions import RuntimeServiceError
from prism_server.core.secrets import CredentialCipher
from prism_server.integrations.agent_server import create_agent_client, public_agent_error
from prism_server.integrations.langsmith import read_trace_url
from prism_server.repositories.model_connections import ModelConnectionRepository
from prism_server.repositories.runtime_runs import RunRepository
from prism_server.schemas.runtime import TERMINAL_STATUSES, RunInput, RunRecord, RunStatus

logger = logging.getLogger(__name__)


class RuntimeService:
    """把 Agent Server、运行记录仓库和 LangSmith 查询连在一起。"""

    def __init__(
        self,
        settings: Settings,
        repository: RunRepository,
        *,
        client_factory: Callable[[], LangGraphClient] | None = None,
        trace_reader: Callable[[str], str] | None = None,
    ):
        self.settings = settings
        self.repository = repository
        self.client_factory = client_factory or partial(create_agent_client, settings)
        self.trace_reader = trace_reader or partial(read_trace_url, settings)
        self.models = ModelConnectionRepository(repository.database, CredentialCipher(settings.model_encryption_key))

    async def initialize(self) -> None:
        """启动时准备数据库表；同步数据库操作放进工作线程。"""
        await asyncio.to_thread(self.repository.initialize)

    def health(self) -> dict[str, object]:
        """返回运行窗口要展示的配置，不包含密码或密钥。"""
        settings = self.settings
        return {
            "service": "prism-research-server",
            "stage": "model-chat",
            "graph_id": settings.graph_id,
            "execution_mode": "model",
            "agent_public_url": settings.public_api_url,
            "studio_url": "https://smith.langchain.com/studio/?" + urlencode({"baseUrl": settings.public_api_url}),
            "tracing": {
                "enabled": settings.tracing_enabled,
                "key_configured": settings.tracing_key_configured,
                "project": settings.tracing_project,
                "verified": False,
            },
            "storage": "postgresql",
        }

    async def compiled_graph(self) -> dict[str, object]:
        """从 Agent Server 读取已编译的节点和连线，确认图注册成功。"""
        try:
            async with self.client_factory() as client:
                graph = await client.assistants.get_graph(self.settings.graph_id)
            return {"graph_id": self.settings.graph_id, "compiled": True, "graph": graph}
        except Exception as exc:
            logger.warning("读取图失败：%s", type(exc).__name__)
            raise RuntimeServiceError(502, public_agent_error(exc)) from None

    async def list_runs(self, limit: int, offset: int) -> list[RunRecord]:
        """按时间倒序读取工作台保存的运行记录。"""
        return await asyncio.to_thread(self.repository.list_recent, limit, offset)

    async def require_record(self, run_id: UUID) -> RunRecord:
        """找到工作台运行记录，找不到时返回明确的业务错误。"""
        record = await asyncio.to_thread(self.repository.get, str(run_id))
        if record is None:
            raise RuntimeServiceError(404, "运行记录不存在")
        return record

    async def create_run(self, payload: RunInput) -> RunRecord:
        """先记下请求，再通过 SDK 创建线程和运行，方便失败后继续排查。"""
        connection, _ = await asyncio.to_thread(self.models.resolve, payload.model_id)
        await self.conversation_runs(payload.conversation_id)
        local_id = str(uuid4())
        record, history_records = await asyncio.to_thread(
            self.repository.create_turn,
            RunRecord(id=local_id, graph_id=self.settings.graph_id, input=payload.prompt, status="pending", started_at=utc_now(), conversation_id=payload.conversation_id, model_id=payload.model_id, model_snapshot={"name": connection.name, "provider": connection.provider, "api_model": connection.api_model, "revision": connection.revision, "system_prompt": connection.system_prompt}),
        )
        history = []
        for previous in history_records:
            history.extend([{"role": "user", "content": previous.input}, {"role": "assistant", "content": str(previous.output["message"])}])
        try:
            async with self.client_factory() as client:
                thread = await client.threads.create(metadata={"prism_run_id": local_id})
                thread_id = thread["thread_id"]
                await asyncio.to_thread(self.repository.update, local_id, thread_id=thread_id)
                run = await client.runs.create(
                    thread_id,
                    self.settings.graph_id,
                    input={"prompt": payload.prompt, "request_id": local_id, "history": history},
                    context={"model_id": payload.model_id, "model_revision": connection.revision, "system_prompt": connection.system_prompt, "tools": []},
                    metadata={"prism_run_id": local_id, "prism_stage": "2.6", "purpose": "model-chat"},
                    config={"tags": ["prism", "model-chat"]},
                )
            return await asyncio.to_thread(
                self.repository.update, local_id, agent_run_id=run["run_id"], status="running",
            )
        except Exception as exc:
            logger.warning("创建图运行失败：%s", type(exc).__name__)
            record = await asyncio.to_thread(
                self.repository.update, record.id, status="error", error=public_agent_error(exc), finished_at=utc_now(),
            )
            raise RuntimeServiceError(502, {"message": record.error or "Agent Server 调用失败", "record_id": record.id}) from None

    async def get_run(self, run_id: UUID) -> RunRecord:
        """未结束时查询远端状态；成功后取回图状态并更新数据库。"""
        record = await self.require_record(run_id)
        if record.status in TERMINAL_STATUSES or not record.agent_run_id or not record.thread_id:
            return record
        try:
            async with self.client_factory() as client:
                remote = await client.runs.get(record.thread_id, record.agent_run_id)
                status = remote["status"]
                if status not in {"pending", "running", *TERMINAL_STATUSES}:
                    raise ValueError("无法识别远端运行状态")
                output = None
                error = None
                if status == "success":
                    state = await client.threads.get_state(record.thread_id)
                    values = state.get("values")
                    expected_mode = "model" if record.conversation_id else "connection_check"
                    if not isinstance(values, dict) or values.get("execution_mode") != expected_mode:
                        raise ValueError("图输出格式不匹配")
                    output = values
                elif status in {"error", "timeout", "interrupted"}:
                    error = {"error": "图执行失败，请在 Studio 检查运行。", "timeout": "图执行超时。", "interrupted": "运行已中断。"}[status]
            return await asyncio.to_thread(
                self.repository.update,
                record.id,
                status=cast(RunStatus, status),
                output=output,
                error=error,
                finished_at=utc_now() if status in TERMINAL_STATUSES else None,
            )
        except Exception as exc:
            # 暂时查不到不代表运行失败，保留原状态，之后还可以继续查询。
            logger.warning("查询运行失败：%s", type(exc).__name__)
            raise RuntimeServiceError(502, public_agent_error(exc)) from None

    async def conversation_runs(self, conversation_id: str) -> list[RunRecord]:
        """恢复页面时补查未完成的运行，浏览器关闭不会丢失已有消息。"""
        records = await asyncio.to_thread(self.repository.conversation_runs, conversation_id)
        return [await self.get_run(UUID(record.id)) if record.status not in TERMINAL_STATUSES else record for record in records]

    async def cancel_run(self, run_id: UUID) -> RunRecord:
        """请求中断后再查真实状态，不直接假定中断已经完成。"""
        record = await self.require_record(run_id)
        if record.status in TERMINAL_STATUSES:
            return record
        if not record.thread_id or not record.agent_run_id:
            raise RuntimeServiceError(409, "运行正在创建，请稍后刷新状态")
        try:
            async with self.client_factory() as client:
                await client.runs.cancel(record.thread_id, record.agent_run_id, action="interrupt")
            return await self.get_run(run_id)
        except RuntimeServiceError:
            raise
        except Exception as exc:
            raise RuntimeServiceError(502, public_agent_error(exc)) from None

    async def verify_trace(self, run_id: UUID) -> RunRecord:
        """实际查到 LangSmith 记录后，才保存链接并标记核验成功。"""
        record = await self.require_record(run_id)
        if not self.settings.tracing_enabled or not self.settings.tracing_key_configured:
            raise RuntimeServiceError(409, "请先在本地 .env 配置 LangSmith key 并开启 tracing，然后重启服务并重新运行验证。")
        if not record.agent_run_id:
            raise RuntimeServiceError(409, "该记录尚无 Agent Server 运行编号")
        try:
            url = await asyncio.to_thread(self.trace_reader, record.agent_run_id)
            if urlparse(url).scheme != "https":
                raise ValueError("监测平台返回了不受支持的链接")
            return await asyncio.to_thread(self.repository.update, record.id, trace_status="verified", trace_url=url)
        except Exception as exc:
            logger.warning("核验 LangSmith trace 失败：%s", type(exc).__name__)
            raise RuntimeServiceError(502, "尚未查到该运行的 LangSmith 记录。请核对账号、项目与追踪配置，等待上报后重试。") from None
