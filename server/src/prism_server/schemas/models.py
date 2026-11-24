"""可运行的模型配置与研究档案分开；接口从不读回 API Key。"""

from typing import Literal, Self
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator


class ModelConnection(BaseModel):
    """两种适配协议共用的公开参数；不传温度时遵循模型默认值。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    provider: Literal["openai", "anthropic"]
    api_model: str = Field(min_length=1, max_length=200)
    base_url: str = Field(max_length=2000)
    enabled: bool = True
    system_prompt: str = Field(
        default="你是严谨的多模态模型研究助手。区分事实、推断与待验证问题。", max_length=20000
    )
    temperature: float | None = Field(default=None, ge=0, le=2, allow_inf_nan=False)
    max_tokens: int = Field(default=2048, ge=1, le=131072)
    timeout_seconds: int = Field(default=120, ge=5, le=600)

    @field_validator("base_url")
    @classmethod
    def valid_base_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname:
            raise ValueError("Base URL 必须是有效的 http(s) 地址")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Base URL 不能包含凭据、查询参数或片段")
        return value.rstrip("/")

    @model_validator(mode="after")
    def provider_limits(self) -> Self:
        if self.provider == "anthropic" and self.temperature is not None and self.temperature > 1:
            raise ValueError("Anthropic 的温度范围为 0 到 1")
        return self


class ConnectionInput(ModelConnection):
    """空密钥保留原值，clear_api_key 明确清空；版本号避免覆盖另一页面的修改。"""

    api_key: SecretStr | None = Field(default=None, exclude=True)
    clear_api_key: bool = False
    expected_revision: int = Field(default=0, ge=0)


class ConnectionRecord(ModelConnection):
    model_id: str
    name: str
    revision: int
    api_key_configured: bool
