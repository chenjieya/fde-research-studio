"""创建 Agent Server 的 SDK 客户端，并把底层异常整理成可展示的提示。"""

import httpx
from langgraph_sdk import get_client
from langgraph_sdk.client import LangGraphClient

from prism_server.core.config import Settings


def create_agent_client(settings: Settings) -> LangGraphClient:
    """按配置创建 SDK 客户端，调用方用 async with 在完成后关闭连接。"""
    # LangSmith key 用于上报追踪，不拿它当本地 Agent Server 的访问凭据。
    return get_client(
        url=settings.agent_api_url,
        api_key=None,
        timeout=httpx.Timeout(settings.timeout_seconds, connect=3),
    )


def public_agent_error(exc: Exception) -> str:
    """只返回简短提示，不把底层地址、请求头或密钥带给前端。"""
    if isinstance(exc, httpx.TimeoutException):
        return "Agent Server 响应超时，请稍后刷新运行状态。"
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 404:
        return "Agent Server 未找到图或运行；请检查图标识与开发服务状态。"
    return "Agent Server 调用失败，请检查本地服务与图配置。"

