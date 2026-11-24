"""从运行上下文选择模型，把已完成的对话历史送入真实适配器。"""

import asyncio
from time import perf_counter

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.runtime import Runtime

from prism_server.core.config import Settings
from prism_server.core.secrets import CredentialCipher
from prism_server.db.postgres import PostgresDatabase
from prism_server.graphs.research.context import ResearchContext
from prism_server.graphs.research.state import ResearchOutput, ResearchState
from prism_server.integrations.chat_models import create_chat_model
from prism_server.repositories.model_connections import ModelConnectionRepository


def connection_repository() -> ModelConnectionRepository:
    """运行时创建数据库访问器；导入图时不建立网络连接。"""
    settings = Settings.from_env()
    return ModelConnectionRepository(
        PostgresDatabase(settings.database_url), CredentialCipher(settings.model_encryption_key)
    )


async def model_node(
    state: ResearchState, runtime: Runtime[ResearchContext], config: RunnableConfig
) -> ResearchOutput:
    context = runtime.context
    if context is None or context.tools:
        raise ValueError("需要模型运行上下文；本阶段尚未接入工具。")
    prompt = state.get("prompt", "")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 20000:
        raise ValueError("消息必须为 1 到 20000 字符的非空文字。")
    history = state.get("history", [])
    if not isinstance(history, list) or len(history) > 80 or len(context.system_prompt) > 20000:
        raise ValueError("对话上下文超过限制，请新建对话。")
    if any(
        not isinstance(turn, dict)
        or turn.get("role") not in {"user", "assistant"}
        or not isinstance(turn.get("content"), str)
        for turn in history
    ):
        raise ValueError("对话历史格式不合法。")
    if sum(len(turn["content"]) for turn in history) + len(prompt) > 200000:
        raise ValueError("对话上下文超过限制，请新建对话。")
    connection, api_key = await asyncio.to_thread(
        connection_repository().resolve, context.model_id, context.model_revision
    )
    messages: list[SystemMessage | HumanMessage | AIMessage] = []
    if context.system_prompt:
        messages.append(SystemMessage(content=context.system_prompt))
    for turn in history:
        messages.append(
            HumanMessage(content=turn["content"])
            if turn["role"] == "user"
            else AIMessage(content=turn["content"])
        )
    messages.append(HumanMessage(content=prompt.strip()))
    started = perf_counter()
    try:
        model = await asyncio.to_thread(create_chat_model, connection, api_key)
        response = await model.ainvoke(messages, config=config)
    except Exception as exc:
        # 提供方响应可能包含请求内容，不将原始异常体写入图输出或对外错误。
        status = getattr(exc, "status_code", None)
        message = {
            401: "模型认证失败，请检查 API Key。",
            403: "模型接口拒绝访问，请检查权限。",
            429: "模型接口限流或额度不足，请稍后重试。",
        }.get(status, "模型调用失败，请检查模型名、接口地址、参数和网络后重试。")
        raise RuntimeError(message) from None
    content = response.content
    text = (
        content
        if isinstance(content, str)
        else "\n".join(
            block["text"]
            for block in content
            if isinstance(block, dict)
            and block.get("type") == "text"
            and isinstance(block.get("text"), str)
        )
    )
    if not text.strip():
        raise RuntimeError("模型未返回文字内容，请检查模型是否支持文本对话或增大输出上限。")
    return {
        "message": text,
        "request_id": state.get("request_id", ""),
        "execution_mode": "model",
        "latency_seconds": round(perf_counter() - started, 3),
        "usage": response.usage_metadata or {},
    }
