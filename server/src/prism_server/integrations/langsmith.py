from langsmith import Client

from prism_server.core.config import Settings


def read_trace_url(settings: Settings, agent_run_id: str) -> str:
    """用运行编号到 LangSmith 查记录，查到后返回监测页面地址。"""
    client = Client()
    try:
        run = client.read_run(agent_run_id)
        return client.get_run_url(run=run, project_name=settings.tracing_project)
    finally:
        client.close()
