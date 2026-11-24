"""运行接口收发的数据格式，与图内部的状态定义分开维护。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from prism_server.schemas.workspace import RecordId

RunStatus = Literal["pending", "running", "success", "error", "timeout", "interrupted"]
TERMINAL_STATUSES = frozenset({"success", "error", "timeout", "interrupted"})


class RunInput(BaseModel):
    """发送一轮消息，明确选择模型和会话。"""

    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=1, max_length=20000)
    model_id: RecordId
    conversation_id: str = Field(min_length=1, max_length=120)

    @field_validator("prompt")
    @classmethod
    def nonempty_prompt(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("请输入消息内容")
        return text


class RunRecord(BaseModel):
    """工作台保存的运行记录，包含 Agent Server 编号和追踪核验结果。"""

    # id 是工作台自己的编号；thread_id、agent_run_id 来自 Agent Server。
    id: str
    graph_id: str
    input: str
    status: RunStatus
    thread_id: str | None = None
    agent_run_id: str | None = None
    output: dict[str, object] | None = None
    error: str | None = None
    started_at: str
    finished_at: str | None = None
    # 配置了 LangSmith key 还不算核验成功，需要实际查到对应记录。
    trace_status: Literal["unverified", "verified"] = "unverified"
    trace_url: str | None = None
    conversation_id: str | None = None
    model_id: str | None = None
    model_snapshot: dict[str, object] | None = None


class Conversation(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
