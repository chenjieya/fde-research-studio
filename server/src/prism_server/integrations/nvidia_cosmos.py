"""Cosmos 托管生成协议。ChatNVIDIA 的 chat/completions 接口不覆盖此协议。"""

import asyncio
import json

import httpx
from langsmith import traceable

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.repositories.media import MediaRepository, decode_media, detect_media
from prism_server.schemas.media import MAX_MEDIA_BYTES, GenerationMode, MediaAsset
from prism_server.schemas.models import ModelConnection


@traceable(
    name="NVIDIA Cosmos generation",
    run_type="chain",
    process_inputs=lambda values: {"mode": values.get("mode"), "provider": "nvidia_cosmos"},
)
async def generate_cosmos(
    config: ModelConnection,
    api_key: str,
    prompt: str,
    mode: GenerationMode,
    assets: list[MediaAsset],
    media: MediaRepository,
) -> list[MediaAsset]:
    """使用完整调用地址；不追加 /chat/completions、不重试计费生成请求。"""
    params = config.generation.model_dump(include={"resolution", "num_frames", "num_inference_steps", "fps", "seed"}, exclude_none=True)
    if mode == "text2image":
        params["num_frames"] = 1
        params.pop("fps", None)
    payload = {"model_mode": mode, "prompt": prompt, **params}
    if assets:
        _, uri = await asyncio.to_thread(media.data_uri, assets[0].id)
        payload["input_reference"] = uri
    async with httpx.AsyncClient(timeout=config.timeout_seconds, follow_redirects=False) as client:
        async with client.stream(
            "POST",
            config.base_url,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            json=payload,
        ) as response:
            if not response.is_success:
                message = {
                    401: "NVIDIA 认证失败，请检查 API Key。",
                    403: "NVIDIA 拒绝访问，请检查模型权限。",
                    404: "NVIDIA 模型接口不可用，请核对完整地址及账号权限。",
                    422: "NVIDIA 拒绝生成，请检查任务参数、输入素材或内容限制。",
                    429: "NVIDIA 限流或额度不足，请稍后重试。",
                }.get(response.status_code, "NVIDIA 生成请求失败，请稍后重试。")
                raise RuntimeServiceError(502, message)
            raw = bytearray()
            async for chunk in response.aiter_bytes():
                raw.extend(chunk)
                if len(raw) > MAX_MEDIA_BYTES * 2:
                    raise RuntimeServiceError(502, "NVIDIA 响应过大，请降低分辨率或帧数。")
    try:
        data = await asyncio.to_thread(json.loads, raw)
    except (ValueError, UnicodeDecodeError):
        raise RuntimeServiceError(502, "NVIDIA 返回了无法识别的结果。") from None
    if not isinstance(data, dict):
        raise RuntimeServiceError(502, "NVIDIA 响应格式不匹配。")
    key = "b64_image" if mode == "text2image" else "b64_video"
    encoded = data.get(key)
    if not isinstance(encoded, str) or not encoded:
        raise RuntimeServiceError(502, "NVIDIA 未返回所选任务的媒体结果。")
    content = await asyncio.to_thread(decode_media, encoded)
    expected_kind = "image" if mode == "text2image" else "video"
    mime = detect_media(content)
    if mime.split("/")[0] != expected_kind:
        raise RuntimeServiceError(502, "NVIDIA 返回的媒体类型与任务不匹配。")
    extension = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "video/mp4": "mp4",
        "video/webm": "webm",
    }[mime]
    asset = await asyncio.to_thread(
        media.save, content, f"cosmos-result.{extension}", generated=True
    )
    return [asset]
