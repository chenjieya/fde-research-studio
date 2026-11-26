"""统一生成入口；对图暴露同一种结果，协议细节留在各适配模块。"""

import asyncio

import httpx
from langsmith import traceable
from pydantic import BaseModel, Field, JsonValue

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.integrations.generation.http import store_results
from prism_server.integrations.generation.images import generate_images
from prism_server.integrations.generation.tasks import generate_task
from prism_server.integrations.model_network import create_model_client
from prism_server.integrations.nvidia_cosmos import generate_cosmos
from prism_server.repositories.media import MediaRepository
from prism_server.schemas.media import GenerationMode, MediaAsset
from prism_server.schemas.models import ConnectionRecord


class GenerationResult(BaseModel):
    media: list[MediaAsset]
    usage: dict[str, JsonValue] = Field(default_factory=dict)
    provider_task_id: str | None = None


@traceable(name="Multimodal generation", run_type="chain", process_inputs=lambda values: {"mode": values.get("mode"), "request_id": values.get("request_id")})
async def generate(
    config: ConnectionRecord, api_key: str, prompt: str, mode: GenerationMode,
    assets: list[MediaAsset], media: MediaRepository, request_id: str,
) -> GenerationResult:
    """提交和等待均有超时；生成服务不自动重试，避免重复计费。"""
    if config.provider == "nvidia_cosmos":
        return GenerationResult(media=await generate_cosmos(config, api_key, prompt, mode, assets, media))
    remote_id = None
    try:
        async with asyncio.timeout(config.timeout_seconds + 150):
            async with create_model_client(config) as client:
                if config.provider in {"wan", "seedance", "krea"}:
                    values, usage, remote_id = await generate_task(client, config, api_key, prompt, mode, assets, media, request_id)
                else:
                    values, usage = await generate_images(client, config, api_key, prompt, assets, media)
            kind = "image" if mode in {"text2image", "image2image"} else "video"
            saved = await store_results(values, kind, media, config.timeout_seconds)
            return GenerationResult(media=saved, usage=usage, provider_task_id=remote_id)
    except (TimeoutError, httpx.HTTPError):
        suffix = f" 厂商任务号：{remote_id}。" if remote_id else ""
        raise RuntimeServiceError(502, "生成接口连接失败或超时，请到厂商控制台查询原请求后再决定是否重试。" + suffix) from None
    except RuntimeServiceError as exc:
        if remote_id:
            raise RuntimeServiceError(exc.status_code, f"{exc.detail} 厂商任务号：{remote_id}。") from None
        raise
