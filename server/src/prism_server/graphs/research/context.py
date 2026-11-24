"""单次运行的配置上下文。只携带模型引用，不携带 API Key。"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ResearchContext:
    # 工作台传入明确选择；Studio 留空时只允许使用唯一启用的模型。
    model_id: str | None = field(
        default=None, metadata={"description": "模型档案 ID；仅有一个启用模型时可留空。"}
    )
    model_revision: int | None = field(
        default=None,
        metadata={"description": "工作台自动传入配置版本；Studio 可留空，使用当前配置。"},
    )
    # None 使用档案中的提示词，空字符串表示本次明确不使用系统提示词。
    system_prompt: str | None = field(
        default=None, metadata={"description": "留空使用模型档案中的系统提示词。"}
    )
    # 预留工具标识；本阶段不接受工具，后续统一由服务端工具注册表解析。
    tools: list[str] = field(default_factory=list)
