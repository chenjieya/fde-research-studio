"""研究图的数据格式：外部输入、外部输出，以及节点共享的内部状态。"""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator


class ChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=200000)


class ResearchInput(BaseModel):
    """调用整张图时传入的字段。"""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    prompt: str = Field(min_length=1, max_length=20000)
    request_id: str = Field(default="", max_length=120)
    history: list[ChatTurn] = Field(default_factory=list, max_length=80)

    @field_validator("prompt")
    @classmethod
    def nonempty_prompt(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("消息不能为空")
        return value.strip()

    @model_validator(mode="after")
    def context_budget(self) -> Self:
        if sum(len(turn.content) for turn in self.history) + len(self.prompt) > 200000:
            raise ValueError("对话上下文超过限制，请新建对话。")
        return self


class ResearchOutput(BaseModel):
    """图执行结束后，返回给调用方的字段。"""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    message: str = Field(min_length=1)
    request_id: str
    execution_mode: Literal["model"]
    latency_seconds: float = Field(ge=0, allow_inf_nan=False)
    usage: dict[str, JsonValue]


class ResearchState(ResearchInput):
    """节点之间共享的数据；输入先写入，结果字段由节点补上。"""

    message: str | None = None
    execution_mode: Literal["model"] | None = None
    latency_seconds: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    usage: dict[str, JsonValue] = Field(default_factory=dict)
