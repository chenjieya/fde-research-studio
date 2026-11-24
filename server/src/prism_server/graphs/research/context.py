"""单次运行的配置上下文。只携带模型引用，不携带 API Key。"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ResearchContext:
    model_id: str
    model_revision: int
    system_prompt: str = ""
    # 预留工具标识；本阶段不接受工具，后续统一由服务端工具注册表解析。
    tools: list[str] = field(default_factory=list)
