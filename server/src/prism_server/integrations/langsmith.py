from langchain_core.tracers.langchain import get_client as get_tracing_client
from langsmith import Client

from prism_server.core.config import Settings


def initialize_tracing(settings: Settings) -> None:
    """在线程中预先创建共享追踪客户端，避免首次运行时读取本机配置阻塞事件循环。"""
    if settings.tracing_enabled and settings.tracing_key_configured:
        get_tracing_client()


def read_trace_url(settings: Settings, agent_run_id: str) -> str:
    """用运行编号到 LangSmith 查记录，查到后返回监测页面地址。"""
    client = Client()
    try:
        run = client.read_run(agent_run_id)
        return client.get_run_url(run=run, project_name=settings.tracing_project)
    finally:
        client.close()
