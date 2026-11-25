"""单次运行的配置上下文。只携带模型引用，不携带 API Key。"""

from pydantic import BaseModel, ConfigDict, Field, field_validator

from prism_server.schemas.workspace import RecordId


class ResearchContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    # 工作台传入明确选择；Studio 留空时只允许使用唯一启用的模型。
    model_id: RecordId | None = Field(
        default=None, description="模型档案 ID；仅有一个启用模型时可留空。"
    )
    model_revision: int | None = Field(
        default=None,
        ge=1,
        strict=True,
        description="工作台自动传入配置版本；Studio 可留空，使用当前配置。",
    )
    # None 使用档案中的提示词，空字符串表示本次明确不使用系统提示词。
    system_prompt: str | None = Field(
        default=None, max_length=20000, description="留空使用模型档案中的系统提示词。"
    )
    # 预留工具标识；本阶段不接受工具，后续统一由服务端工具注册表解析。
    tools: list[str] = Field(default_factory=list)

    @field_validator("model_id", "model_revision", mode="before")
    @classmethod
    def empty_selection(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("tools")
    @classmethod
    def no_tools_yet(cls, value: list[str]) -> list[str]:
        if value:
            raise ValueError("本阶段尚未接入工具。")
        return value
