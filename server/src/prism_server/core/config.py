"""从环境变量读取后端配置，不把数据库密码和 API key 返回给前端。"""

import os
from dataclasses import dataclass, field
from urllib.parse import urlparse


def env_bool(name: str) -> bool:
    """把环境变量中的 1、true、yes 当作开启，其余值当作关闭。"""
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes"}


@dataclass(frozen=True)
class Settings:
    """后端启动时读取的一组配置；修改 .env 后需要重启服务。"""

    # SDK 使用 agent_api_url；浏览器打开 Studio 使用 public_api_url。
    agent_api_url: str
    public_api_url: str
    graph_id: str
    database_url: str
    timeout_seconds: float
    tracing_enabled: bool
    tracing_key_configured: bool
    tracing_project: str
    tracing_endpoint: str
    model_encryption_key: str = field(default="", repr=False)

    @classmethod
    def from_env(cls) -> "Settings":
        """读取配置并检查地址和超时，尽早发现填错的值。"""
        agent_url = os.getenv("PRISM_AGENT_API_URL", "http://127.0.0.1:2024").rstrip("/")
        public_url = os.getenv("PRISM_AGENT_PUBLIC_URL", agent_url).rstrip("/")
        for url in (agent_url, public_url):
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("Agent Server 地址必须为有效的 http(s) URL")
            if parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError("Agent Server 地址不能包含凭据、查询参数或片段")
        timeout = float(os.getenv("PRISM_REQUEST_TIMEOUT_SECONDS", "30"))
        if not 1 <= timeout <= 120:
            raise ValueError("请求超时必须为 1 到 120 秒")
        return cls(
            agent_api_url=agent_url,
            public_api_url=public_url,
            graph_id=os.getenv("PRISM_GRAPH_ID", "prism_research"),
            database_url=os.getenv("PRISM_DATABASE_URL", "postgresql://prism_app@127.0.0.1:15433/prism_research"),
            timeout_seconds=timeout,
            tracing_enabled=env_bool("LANGSMITH_TRACING"),
            tracing_key_configured=bool(os.getenv("LANGSMITH_API_KEY", "").strip()),
            tracing_project=os.getenv("LANGSMITH_PROJECT", "prism-research-studio"),
            tracing_endpoint=os.getenv("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com"),
            model_encryption_key=os.getenv("PRISM_MODEL_ENCRYPTION_KEY", ""),
        )
