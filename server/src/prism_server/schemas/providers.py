"""官方接入目录：前端读取同一份能力声明，业务代码不依赖厂家名称猜测任务。"""

from typing import Literal

from pydantic import BaseModel

from prism_server.schemas.media import GenerationMode

ModelProvider = Literal[
    "openai", "anthropic", "qwen", "nvidia_cosmos", "openai_image", "qwen_image",
    "seedance", "wan", "krea", "moss_image", "minimax_image",
]


class ProviderDefinition(BaseModel):
    id: ModelProvider
    label: str
    base_url: str
    api_model: str
    modes: list[GenerationMode]
    hint: str
    documentation: str
    timeout_seconds: int = 900


PROVIDERS = [
    ProviderDefinition(id="openai", label="OpenAI / 兼容对话", base_url="https://api.openai.com/v1", api_model="", modes=[], hint="文本对话与视觉分析；按模型能力启用图片、视频输入。", documentation="https://developers.openai.com/api/docs/guides/images-vision", timeout_seconds=120),
    ProviderDefinition(id="anthropic", label="Anthropic · 分析", base_url="https://api.anthropic.com", api_model="", modes=[], hint="支持文本和图片分析，当前适配器不直接传入视频。", documentation="https://platform.claude.com/docs/en/build-with-claude/vision", timeout_seconds=120),
    ProviderDefinition(id="qwen", label="通义千问 · 分析", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1", api_model="qwen3-vl-plus", modes=[], hint="Qwen VL 使用兼容对话接口；图片生成请选择「Qwen Image」。地址和密钥须属于同一地域。", documentation="https://help.aliyun.com/zh/model-studio/vision", timeout_seconds=120),
    ProviderDefinition(id="openai_image", label="OpenAI · GPT Image", base_url="https://api.openai.com/v1", api_model="gpt-image-1.5", modes=["text2image", "image2image"], hint="官方 Images API，支持文生图与多图编辑；模型名按账号已开通版本填写。", documentation="https://developers.openai.com/api/docs/guides/image-generation"),
    ProviderDefinition(id="qwen_image", label="阿里 · Qwen Image", base_url="https://dashscope.aliyuncs.com", api_model="qwen-image-2.0-pro", modes=["text2image", "image2image"], hint="百炼原生图片生成接口；图像编辑需使用支持编辑的模型，最多 3 张参考图。地址和密钥须同地域。", documentation="https://help.aliyun.com/zh/model-studio/qwen-image-edit-api"),
    ProviderDefinition(id="seedance", label="字节 · Seedance 视频", base_url="https://ark.cn-beijing.volces.com/api/v3", api_model="", modes=["text2video", "image2video"], hint="填写方舟已开通的 Model ID 或 Endpoint ID。上传 1 张图作为首帧，2 张依次作为首尾帧。使用 Seedance 2.5 Model ID 时，图生视频自动沿用首帧比例。", documentation="https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh"),
    ProviderDefinition(id="wan", label="阿里 · 万相视频", base_url="https://dashscope.aliyuncs.com", api_model="wan3.0-video-prime", modes=["text2video", "image2video"], hint="Wan 3.0 原生异步接口，支持文生视频和首帧 / 首尾帧生视频。保留控制台所属地域或业务空间域名。", documentation="https://help.aliyun.com/en/model-studio/wan3-video-generation-api-reference"),
    ProviderDefinition(id="krea", label="Krea · Krea 2", base_url="https://api.krea.ai", api_model="krea-2/medium", modes=["text2image", "image2image"], hint="官方 Krea 2 Medium / Large；图生图将单张图片作为源图，输出 1K。", documentation="https://www.krea.ai/docs/developers/krea-2/overview"),
    ProviderDefinition(id="moss_image", label="OpenMOSS · MOSS Image", base_url="https://api.mosi.cn/v1", api_model="moss-image-sft-1.0", modes=["text2image"], hint="官方 MOSI 文生图接口；不支持参考图编辑。", documentation="https://platform.moss.cn/docs/reference/images-generations"),
    ProviderDefinition(id="minimax_image", label="MiniMax · H3 Image", base_url="https://api.minimax.cn/v1", api_model="MiniMax-H3-Image", modes=["text2image", "image2image"], hint="H3-Image 官方图片接口，支持文生图、多图编辑；海外地址为 https://api.minimax.io/v1。", documentation="https://github.com/MiniMax-AI/MiniMax-H3-Image"),
    ProviderDefinition(id="nvidia_cosmos", label="NVIDIA · Cosmos", base_url="https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano", api_model="nvidia/cosmos3-nano", modes=["text2image", "text2video", "image2video", "video2video"], hint="填写完整生成接口地址；托管端点是否开放取决于 NVIDIA 服务及账号权限。", documentation="https://build.nvidia.com/nvidia/cosmos3-nano/modelcard", timeout_seconds=600),
]


def provider_definition(provider: ModelProvider) -> ProviderDefinition:
    return next(item for item in PROVIDERS if item.id == provider)
