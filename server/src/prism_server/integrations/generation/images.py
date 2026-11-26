"""官方图片 API：GPT Image、Qwen Image、MOSS Image、MiniMax H3 Image。"""

import asyncio

import httpx

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.integrations.generation.http import request_json
from prism_server.repositories.media import MediaRepository
from prism_server.schemas.media import MediaAsset
from prism_server.schemas.models import ModelConnection


def alibaba_base(base_url: str) -> str:
    """从同一业务空间的兼容地址得到原生服务地址，始终保留地域和 workspace 域名。"""
    for suffix in ("/compatible-mode/v1", "/api/v1"):
        if base_url.endswith(suffix):
            return base_url[:-len(suffix)]
    return base_url


def versioned_base(base_url: str) -> str:
    return base_url if base_url.endswith("/v1") else base_url + "/v1"


async def generate_images(
    client: httpx.AsyncClient, config: ModelConnection, api_key: str, prompt: str,
    assets: list[MediaAsset], media: MediaRepository,
) -> tuple[list[str], dict]:
    options = config.generation
    payload: dict = {"model": config.api_model, "prompt": prompt, "n": 1}
    if options.image_size != "auto":
        payload["size"] = options.image_size
    uri_list = []
    if config.provider != "openai_image":
        for asset in assets:
            _, uri = await asyncio.to_thread(media.data_uri, asset.id)
            uri_list.append(uri)
    provider = config.provider
    if provider == "qwen_image":
        content = [{"image": uri} for uri in uri_list] + [{"text": prompt}]
        params = {"n": 1}
        if options.image_size != "auto":
            params["size"] = options.image_size.replace("x", "*")
        if options.seed is not None:
            params["seed"] = options.seed
        if options.negative_prompt:
            params["negative_prompt"] = options.negative_prompt
        payload = {"model": config.api_model, "input": {"messages": [{"role": "user", "content": content}]}, "parameters": params}
        url = alibaba_base(config.base_url) + "/api/v1/services/aigc/multimodal-generation/generation"
        data = await request_json(client, "POST", url, label="Qwen Image", api_key=api_key, payload=payload)
        values = [block["image"] for choice in data.get("output", {}).get("choices", []) for block in choice.get("message", {}).get("content", []) if isinstance(block.get("image"), str)]
        return values, data.get("usage", {})
    base = versioned_base(config.base_url)
    if provider == "openai_image":
        payload.update({"quality": options.quality, "output_format": "png"})
        if assets:
            files = []
            for asset in assets:
                _, raw = await asyncio.to_thread(media.get, asset.id, content=True)
                files.append(("image[]", (asset.filename, raw, asset.mime_type)))
            # HTTPX 编码 multipart，无需安装另一个 SDK 或服务端 multipart 解析依赖。
            data = await request_json(client, "POST", base + "/images/edits", label="GPT Image", api_key=api_key, data={key: str(value) for key, value in payload.items()}, files=files)
        else:
            data = await request_json(client, "POST", base + "/images/generations", label="GPT Image", api_key=api_key, payload=payload)
    elif provider == "minimax_image":
        payload.update({"response_format": "b64_json", "output_format": "png"})
        if uri_list:
            payload["images"] = [{"image_url": uri} for uri in uri_list]
        data = await request_json(client, "POST", base + ("/images/edits" if assets else "/images/generations"), label="MiniMax H3 Image", api_key=api_key, payload=payload)
    elif provider == "moss_image":
        if len(prompt) > 4000:
            raise RuntimeServiceError(422, "MOSS Image 提示词最长 4000 字符。")
        payload.update({"response_format": "url", "num_inference_steps": options.num_inference_steps})
        if options.seed is not None:
            payload["seed"] = options.seed
        if options.negative_prompt:
            payload["negative_prompt"] = options.negative_prompt
        data = await request_json(client, "POST", base + "/images/generations", label="MOSS Image", api_key=api_key, payload=payload)
    else:
        raise RuntimeServiceError(422, "未注册的图片生成接入。")
    items = data.get("data")
    if not isinstance(items, list) or any(not isinstance(item, dict) or item.get("error") for item in items):
        raise RuntimeServiceError(502, "图片接口未返回成功的图片数据，请到厂商控制台核对。")
    return [item.get("b64_json") or item.get("url") for item in items], data.get("usage", {})
