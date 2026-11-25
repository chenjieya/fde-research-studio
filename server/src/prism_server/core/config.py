"""从环境变量读取后端配置，不把数据库密码和 API key 返回给前端。"""

from typing import Self
from urllib.parse import urlparse

from cryptography.fernet import Fernet
from pydantic import (
    Field,
    HttpUrl,
    PostgresDsn,
    TypeAdapter,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """后端启动时读取的一组配置；修改 .env 后需要重启服务。"""

    # .env 由 langgraph.json / uv --env-file 加载，避免在事件循环中反复读文件。
    # 独立工具如需直接读文件，可显式使用 Settings(_env_file=".env")。
    model_config = SettingsConfigDict(
        env_file=None,
        extra="ignore",
        populate_by_name=True,
        frozen=True,
        hide_input_in_errors=True,
        str_strip_whitespace=True,
    )
    agent_api_url: str = Field(
        default="http://127.0.0.1:2024", validation_alias="PRISM_AGENT_API_URL"
    )
    public_api_url: str = Field(default="", validation_alias="PRISM_AGENT_PUBLIC_URL")
    graph_id: str = Field(
        default="prism_research", min_length=1, max_length=120, validation_alias="PRISM_GRAPH_ID"
    )
    database_url: str = Field(
        default="postgresql://prism_app@127.0.0.1:15433/prism_research",
        validation_alias="PRISM_DATABASE_URL",
        repr=False,
        exclude=True,
    )
    timeout_seconds: float = Field(
        default=30,
        ge=1,
        le=120,
        allow_inf_nan=False,
        validation_alias="PRISM_REQUEST_TIMEOUT_SECONDS",
    )
    tracing_enabled: bool = Field(default=False, validation_alias="LANGSMITH_TRACING")
    # 只保留配置状态，不在 Settings 内保存 LangSmith 密钥明文。
    tracing_key_configured: bool = Field(default=False, validation_alias="LANGSMITH_API_KEY")
    tracing_project: str = Field(
        default="prism-research-studio", min_length=1, validation_alias="LANGSMITH_PROJECT"
    )
    tracing_endpoint: str = Field(
        default="https://api.smith.langchain.com", validation_alias="LANGSMITH_ENDPOINT"
    )
    model_encryption_key: str = Field(
        default="", validation_alias="PRISM_MODEL_ENCRYPTION_KEY", repr=False, exclude=True
    )

    @field_validator("tracing_key_configured", mode="before")
    @classmethod
    def key_is_configured(cls, value: object) -> bool:
        return bool(value.strip()) if isinstance(value, str) else bool(value)

    @field_validator("agent_api_url", "public_api_url", "tracing_endpoint")
    @classmethod
    def valid_http_url(cls, value: str, info: ValidationInfo) -> str:
        value = value.strip().rstrip("/")
        if info.field_name == "public_api_url" and not value:
            return value
        parsed = TypeAdapter(HttpUrl).validate_python(value)
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("服务地址不能包含凭据、查询参数或片段")
        return value

    @field_validator("database_url")
    @classmethod
    def valid_database_url(cls, value: str) -> str:
        TypeAdapter(PostgresDsn).validate_python(value)
        if urlparse(value).scheme not in {"postgresql", "postgres"}:
            raise ValueError("业务数据库使用 postgresql:// 或 postgres:// 连接串")
        return value

    @field_validator("model_encryption_key")
    @classmethod
    def valid_encryption_key(cls, value: str) -> str:
        if value:
            try:
                Fernet(value.encode())
            except (ValueError, TypeError):
                raise ValueError("模型加密根密钥必须是有效的 Fernet 密钥") from None
        return value

    @model_validator(mode="after")
    def default_public_url(self) -> Self:
        if not self.public_api_url:
            object.__setattr__(self, "public_api_url", self.agent_api_url)
        return self

    @classmethod
    def from_env(cls) -> "Settings":
        """兼容现有调用入口，读取和校验均交给 BaseSettings。"""
        return cls()
