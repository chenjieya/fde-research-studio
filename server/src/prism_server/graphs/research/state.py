"""研究图的数据格式：外部输入、外部输出，以及节点共享的内部状态。"""

from typing import Literal, NotRequired, TypedDict


class ChatTurn(TypedDict):
    role: Literal["user", "assistant"]
    content: str


class ResearchInput(TypedDict):
    """调用整张图时传入的字段。"""

    prompt: str
    request_id: str
    history: NotRequired[list[ChatTurn]]


class ResearchOutput(TypedDict):
    """图执行结束后，返回给调用方的字段。"""

    message: str
    request_id: str
    execution_mode: Literal["model"]
    latency_seconds: float
    usage: dict


class ResearchState(ResearchInput, total=False):
    """节点之间共享的数据；输入先写入，结果字段由节点补上。"""

    message: str
    execution_mode: Literal["model"]
    latency_seconds: float
    usage: dict

