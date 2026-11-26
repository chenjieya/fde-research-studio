"""可运行的模型配置与研究档案分开；接口从不读回 API Key。"""

from typing import Literal, Self
from urllib.parse import urlparse

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    computed_field,
    field_validator,
    model_validator,
)

from prism_server.schemas.media import GenerationMode, GenerationOptions, MediaKind
from prism_server.schemas.providers import ModelProvider, provider_definition


class ModelConnection(BaseModel):
    """对话与 Cosmos 接入参数；generation 字段仅用于生成协议。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    provider: ModelProvider
    api_model: str = Field(min_length=1, max_length=200)
    base_url: str = Field(max_length=2000)
    enabled: bool = True
    input_modalities: list[MediaKind] = Field(default_factory=lambda: ["image"], max_length=2)
    generation_mode: GenerationMode = "text2video"
    generation: GenerationOptions = Field(default_factory=GenerationOptions)
    system_prompt: str = Field(
        default="你是严谨的多模态模型研究助手。区分事实、推断与待验证问题。", max_length=20000
    )
    temperature: float | None = Field(default=None, ge=0, le=2, allow_inf_nan=False)
    max_tokens: int = Field(default=2048, ge=1, le=131072)
    timeout_seconds: int = Field(default=120, ge=5, le=3600)
    qwen_thinking: Literal["off", "on", "default"] = "off"

    @property
    def supports_qwen_thinking(self) -> bool:
        host = urlparse(self.base_url).hostname or ""
        # 仅对已确认支持开关的百炼混合思考模型发送扩展参数，避免影响其他兼容服务。
        official = self.provider == "qwen" or host == "dashscope.aliyuncs.com" or host.endswith(".maas.aliyuncs.com")
        return official and self.api_model.lower().startswith((
            "qwen3.8-max", "qwen3.8-flash", "qwen3.7-plus", "qwen3.6-plus",
            "qwen3.5-plus", "qwen3.5-flash", "qwen3-vl-plus", "qwen3-vl-flash",
        ))

    @property
    def is_generation(self) -> bool:
        return bool(provider_definition(self.provider).modes)

    @property
    def task_modes(self) -> list[GenerationMode]:
        if self.provider == "qwen_image":
            model = self.api_model.lower()
            if "edit" in model:
                return ["image2image"]
            if not model.startswith(("qwen-image-2", "qwen-image-3")):
                return ["text2image"]
        return provider_definition(self.provider).modes

    @model_validator(mode="before")
    @classmethod
    def migrate_known_official_connections(cls, value: object) -> object:
        """兼容已保存的官方生成模型，保留原域名、密钥与版本，不再误发聊天接口。"""
        if not isinstance(value, dict):
            return value
        data = dict(value)
        model = str(data.get("api_model", "")).lower()
        host = urlparse(str(data.get("base_url", ""))).hostname or ""
        if data.get("provider") == "openai":
            if host.endswith(".aliyuncs.com"):
                if model.startswith("wan3."):
                    data["provider"] = "wan"
                elif model.startswith("qwen-image"):
                    data["provider"] = "qwen_image"
            elif host == "api.openai.com" and model.startswith(("gpt-image-", "chatgpt-image-")):
                data["provider"] = "openai_image"
        provider = data.get("provider")
        if provider in {"qwen_image", "openai_image", "krea", "moss_image", "minimax_image"}:
            if data.get("generation_mode", "text2video") == "text2video":
                data["generation_mode"] = "text2image"
        if provider == "qwen_image" and "edit" in model and data.get("generation_mode") == "text2image":
            data["generation_mode"] = "image2image"
        return data

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
        if self.provider == "anthropic" and "video" in self.input_modalities:
            raise ValueError("当前 Anthropic 适配器支持图片，不支持直接视频输入。")
        if len(set(self.input_modalities)) != len(self.input_modalities):
            raise ValueError("输入类型不能重复")
        modes = self.task_modes
        if modes and self.generation_mode not in modes:
            raise ValueError("默认任务不在此接入的支持范围内")
        if self.provider == "krea" and self.api_model not in {"krea-2/medium", "krea-2/large"}:
            raise ValueError("当前 Krea 2 适配器的模型名为 krea-2/medium 或 krea-2/large")
        if self.provider == "moss_image" and self.generation.image_size == "auto":
            raise ValueError("MOSS Image 需要明确的图片尺寸")
        if self.provider in {"wan", "seedance"}:
            if self.provider == "seedance" and self.generation.duration < 4:
                raise ValueError("Seedance 视频时长至少为 4 秒")
            if self.provider == "seedance" and "seedance-2-5" not in self.api_model and self.generation.duration > 15:
                raise ValueError("当前模型时长上限按 15 秒校验；30 秒需使用 Seedance 2.5 Model ID")
        if self.provider == "openai_image" and self.api_model.lower() in {"gpt-image-1", "dall-e-2", "dall-e-3"}:
            raise ValueError("此 OpenAI 图片模型已退役，请填写账号可用的 GPT Image 模型版本")
        if self.provider == "openai_image" and self.api_model.lower() in {"gpt-image-1.5", "gpt-image-1-mini"} and self.generation.image_size not in {"auto", "1024x1024", "1024x1536", "1536x1024"}:
            raise ValueError("此 GPT Image 版本的尺寸支持 auto、1024x1024、1024x1536、1536x1024")
        if self.provider == "qwen_image" and len(self.generation.negative_prompt) > 500:
            raise ValueError("Qwen Image 的反向提示词最长 500 字符")
        if self.provider == "moss_image" and self.generation.image_size != "auto":
            width, height = map(int, self.generation.image_size.split("x"))
            if not all(256 <= side <= 2048 and side % 16 == 0 for side in (width, height)) or width * height > 2097152:
                raise ValueError("MOSS 图片每边需为 256–2048 的 16 倍数，总像素不超过 2097152")
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

    @computed_field
    @property
    def supported_modes(self) -> list[GenerationMode]:
        return self.task_modes
