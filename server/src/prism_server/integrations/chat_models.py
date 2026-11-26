"""两种 LangChain 适配器的创建入口；凭据只传给服务端 SDK。"""

import asyncio

import httpx
from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from prism_server.integrations.model_network import create_model_client
from prism_server.schemas.models import ModelConnection


def create_chat_model(config: ModelConnection, api_key: str, *, http_async_client: httpx.AsyncClient | None = None) -> BaseChatModel:
    """显式传入凭据与地址，避免误用宿主机上的其他提供方环境变量。"""
    if config.is_generation:
        raise ValueError("图片、视频生成接口使用统一生成适配入口")
    if config.provider == "anthropic":
        return ChatAnthropic(
            model_name=config.api_model,
            anthropic_api_url=config.base_url,
            api_key=SecretStr(api_key),
            temperature=config.temperature,
            max_tokens_to_sample=config.max_tokens,
            timeout=config.timeout_seconds,
            max_retries=0,
        )
    return ChatOpenAI(
        model=config.api_model,
        base_url=config.base_url,
        api_key=SecretStr(api_key),
        temperature=config.temperature,
        max_tokens=config.max_tokens,
        timeout=config.timeout_seconds,
        max_retries=0,
        use_responses_api=False,
        http_async_client=http_async_client,
        http_socket_options=() if http_async_client is not None else None,
        streaming=config.supports_qwen_thinking,
        stream_usage=config.supports_qwen_thinking,
        extra_body={"enable_thinking": config.qwen_thinking == "on"}
        if config.supports_qwen_thinking and config.qwen_thinking != "default" else None,
    )


async def invoke_chat_model(config: ModelConnection, api_key: str, messages: list[BaseMessage], runnable_config: RunnableConfig) -> BaseMessage:
    """每次异步调用拥有并关闭自己的 HTTP 连接；不让 SDK 隐式选择代理或缓存失效连接。"""
    if config.provider == "anthropic":
        model = await asyncio.to_thread(create_chat_model, config, api_key)
        return await model.ainvoke(messages, config=runnable_config)
    async with create_model_client(config) as client:
        model = await asyncio.to_thread(create_chat_model, config, api_key, http_async_client=client)
        return await model.ainvoke(messages, config=runnable_config)
