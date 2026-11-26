"""从运行上下文选择模型，把已完成的对话历史送入真实适配器。"""

import asyncio
import logging
from time import perf_counter
from typing import NoReturn
from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.runtime import Runtime

from prism_server.core.config import Settings
from prism_server.core.exceptions import RuntimeServiceError
from prism_server.core.secrets import CredentialCipher
from prism_server.db.postgres import PostgresDatabase
from prism_server.graphs.research.context import ResearchContext
from prism_server.graphs.research.state import ResearchOutput, ResearchState
from prism_server.integrations.chat_models import invoke_chat_model
from prism_server.integrations.generation.service import generate
from prism_server.integrations.model_network import (
    exception_types,
    inherits_proxy,
    model_failure_message,
)
from prism_server.integrations.multimodal import chat_content, save_response_media, validate_media
from prism_server.repositories.media import MediaRepository
from prism_server.repositories.model_connections import ModelConnectionRepository
from prism_server.repositories.runtime_runs import RunRepository
from prism_server.schemas.models import ConnectionRecord

logger = logging.getLogger(__name__)


def connection_repository() -> ModelConnectionRepository:
    """运行时创建数据库访问器；导入图时不建立网络连接。"""
    settings = Settings.from_env()
    return ModelConnectionRepository(
        PostgresDatabase(settings.database_url), CredentialCipher(settings.model_encryption_key)
    )


def resolve_model(context: ResearchContext) -> tuple[ConnectionRecord, str]:
    """Studio 不传内部版本号也能运行；缺少模型选择时不随意调用多个候选之一。"""
    repository = connection_repository()
    model_id = context.model_id
    if not model_id:
        enabled = [item for item in repository.list() if item.enabled]
        if not enabled:
            raise ValueError(
                "尚未配置可运行模型。请先在工作台「模型档案 → 配置接入」中配置并启用模型。"
            )
        if len(enabled) > 1:
            choices = "、".join(f"{item.name}（model_id: {item.model_id}）" for item in enabled[:8])
            raise ValueError(
                f"有多个启用模型，请在 Studio 的 Context 中填写 model_id，或从工作台选择模型后运行。可选：{choices}"
            )
        model_id = enabled[0].model_id
    return repository.resolve(model_id, context.model_revision)


async def model_node(
    state: ResearchState, runtime: Runtime[ResearchContext], config: RunnableConfig
) -> ResearchOutput:
    context = runtime.context or ResearchContext()
    # 字段类型、长度和历史格式由 Pydantic 状态/上下文模型统一检查。
    prompt = state.prompt
    history = state.history
    connection, api_key = await asyncio.to_thread(resolve_model, context)
    media_repository = MediaRepository((await asyncio.to_thread(connection_repository)).database)
    assets = await asyncio.to_thread(media_repository.list_refs, state.attachment_ids)
    await asyncio.to_thread(validate_media, connection, assets, state.generation_mode)
    started = perf_counter()
    async def fail(message: str) -> NoReturn:
        if state.request_id:
            await asyncio.to_thread(RunRepository(media_repository.database).save_model_error, state.request_id, connection.model_id, message)
        raise RuntimeError(message) from None

    if connection.is_generation:
        try:
            result = await generate(connection, api_key, prompt, state.generation_mode or connection.generation_mode, assets, media_repository, state.request_id or str(uuid4()))
        except RuntimeServiceError as exc:
            await fail(str(exc.detail))
        except Exception as exc:
            logger.warning("生成调用失败 model_id=%s exception_types=%s", connection.model_id, exception_types(exc))
            await fail(model_failure_message(exc, connection, api_key))
        return ResearchOutput(message="生成完成，结果已保存。", media=result.media, provider_task_id=result.provider_task_id, request_id=state.request_id or str(uuid4()), execution_mode="model", latency_seconds=round(perf_counter() - started, 3), usage=result.usage)
    historical_ids = [media_id for turn in history for media_id in turn.attachment_ids]
    historical = await asyncio.to_thread(media_repository.list_refs, historical_ids)
    await asyncio.to_thread(validate_media, connection, [*historical, *assets])
    system_prompt = (
        connection.system_prompt if context.system_prompt is None else context.system_prompt
    )
    messages: list[SystemMessage | HumanMessage | AIMessage] = []
    if system_prompt:
        messages.append(SystemMessage(content=system_prompt))
    for turn in history:
        if turn.role == "user":
            content = await asyncio.to_thread(chat_content, turn.content, turn.attachment_ids, connection, media_repository)
            messages.append(HumanMessage(content=content))
        else:
            messages.append(AIMessage(content=turn.content))
            if turn.attachment_ids:
                content = await asyncio.to_thread(chat_content, "上一轮生成的媒体，供继续分析：", turn.attachment_ids, connection, media_repository)
                messages.append(HumanMessage(content=content))
    content = await asyncio.to_thread(chat_content, prompt.strip(), state.attachment_ids, connection, media_repository)
    messages.append(HumanMessage(content=content))
    try:
        response = await invoke_chat_model(connection, api_key, messages, config)
    except Exception as exc:
        # 提供方响应可能包含请求内容，不将原始异常体写入图输出或对外错误。
        logger.warning("模型调用失败 model_id=%s provider=%s inherit_proxy=%s elapsed=%.2fs exception_types=%s", connection.model_id, connection.provider, inherits_proxy(connection), perf_counter() - started, exception_types(exc))
        await fail(model_failure_message(exc, connection, api_key))
    text, media = await asyncio.to_thread(save_response_media, response.content, media_repository)
    if not text.strip() and not media:
        raise RuntimeError("模型未返回可展示的文本或媒体，请检查模型协议和输出上限。")
    return ResearchOutput(
        message=text or "生成完成，结果已保存。",
        media=media,
        request_id=state.request_id or str(uuid4()),
        execution_mode="model",
        latency_seconds=round(perf_counter() - started, 3),
        usage=response.usage_metadata or {},
    )
