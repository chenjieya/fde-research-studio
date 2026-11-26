"""把服务端媒体引用转换成各对话协议的内容块，并校验输入能力。"""

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.repositories.media import MediaRepository, decode_media
from prism_server.schemas.media import MAX_MEDIA_BYTES, GenerationMode, MediaAsset
from prism_server.schemas.models import ModelConnection


def validate_media(
    config: ModelConnection, assets: list[MediaAsset], mode: GenerationMode | None = None
) -> None:
    if sum(asset.size for asset in assets) > MAX_MEDIA_BYTES:
        raise RuntimeServiceError(413, "本次上下文的媒体总量超过 64 MB，请新建对话或减少附件。")
    if config.is_generation:
        task = mode or config.generation_mode
        if task not in config.task_modes:
            raise RuntimeServiceError(422, "所选任务不在此模型支持范围内，请切换模型或任务。")
        if any(
            asset.mime_type not in {"image/png", "image/jpeg", "image/webp", "video/mp4"}
            for asset in assets
        ):
            raise RuntimeServiceError(
                422, "生成参考图支持 PNG、JPEG、WebP，Cosmos 视频输入请使用 MP4。"
            )
        expected = {
            "text2image": None,
            "image2image": "image",
            "text2video": None,
            "image2video": "image",
            "video2video": "video",
        }[task]
        limit = 3 if config.provider == "qwen_image" else 1 if config.provider in {"krea", "nvidia_cosmos"} else 2 if config.provider in {"wan", "seedance"} else 6
        if (expected is None and assets) or (expected is not None and (not 1 <= len(assets) <= limit or any(asset.kind != expected for asset in assets))):
            raise RuntimeServiceError(
                422, f"纯文字生成不接收附件；当前参考素材任务需要 1 至 {limit} 个{expected or '对应类型'}文件。"
            )
        return
    if mode is not None:
        raise RuntimeServiceError(422, "当前接入用于对话分析；请在模型接入中选择图片或视频生成服务。")
    if any(asset.kind not in config.input_modalities for asset in assets):
        raise RuntimeServiceError(422, "所选模型未启用此附件类型，请修改接入能力或选择其他模型。")


def chat_content(
    text: str, ids: list[str], config: ModelConnection, media: MediaRepository
) -> str | list[dict]:
    if not ids:
        return text
    blocks: list[dict] = [{"type": "text", "text": text}]
    for media_id in ids:
        asset, uri = media.data_uri(media_id)
        if config.provider == "anthropic":
            blocks.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": asset.mime_type,
                        "data": uri.split(",", 1)[1],
                    },
                }
            )
        elif asset.kind == "image":
            blocks.append({"type": "image_url", "image_url": {"url": uri}})
        else:
            # Qwen 等 OpenAI 兼容视频模型使用 video_url；是否支持由接入配置显式声明。
            blocks.append({"type": "video_url", "video_url": {"url": uri}})
    return blocks


def save_response_media(
    content: str | list, media: MediaRepository
) -> tuple[str, list[MediaAsset]]:
    """保留文本与内嵌图片/视频；未知媒体块明确报错，不伪装成纯文本成功。"""
    if isinstance(content, str):
        return content, []
    texts: list[str] = []
    assets: list[MediaAsset] = []
    for block in content:
        if isinstance(block, str):
            texts.append(block)
            continue
        kind = block.get("type")
        if kind == "text" and isinstance(block.get("text"), str):
            texts.append(block["text"])
        elif kind in {"image", "video", "image_url", "video_url"}:
            nested = block.get(kind)
            value = block.get("base64") or block.get("data") or block.get("url")
            if isinstance(nested, dict):
                value = nested.get("url") or value
            source = block.get("source")
            if isinstance(source, dict):
                value = source.get("data") or value
            if not isinstance(value, str) or value.startswith(("http:", "https:")):
                raise RuntimeServiceError(
                    502, "当前对话接口返回了未支持的媒体引用，请使用对应生成适配器。"
                )
            if len(assets) >= 6:
                raise RuntimeServiceError(502, "模型返回媒体数量超过限制。")
            asset = media.save(decode_media(value), "模型生成结果", generated=True)
            assets.append(asset)
            if sum(item.size for item in assets) > MAX_MEDIA_BYTES:
                raise RuntimeServiceError(502, "模型返回的媒体总量超过 64 MB。")
    return "\n".join(texts), assets
