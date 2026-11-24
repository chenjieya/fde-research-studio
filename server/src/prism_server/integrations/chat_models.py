"""两种 LangChain 适配器的创建入口；凭据只传给服务端 SDK。"""

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from prism_server.schemas.models import ModelConnection


def create_chat_model(config: ModelConnection, api_key: str) -> BaseChatModel:
    """显式传入凭据与地址，避免误用宿主机上的其他提供方环境变量。"""
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
    )
