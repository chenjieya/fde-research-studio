"""Seedance、Wan 3.0、Krea 2：提交一次，持久化任务号后轮询。"""

import asyncio
from time import monotonic
from urllib.parse import quote

import httpx

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.integrations.generation.http import provider_error, request_json, safe_code
from prism_server.integrations.generation.images import alibaba_base
from prism_server.repositories.generation_jobs import GenerationJobRepository
from prism_server.repositories.media import MediaRepository
from prism_server.schemas.media import GenerationMode, MediaAsset
from prism_server.schemas.models import ConnectionRecord

POLL_INTERVAL_SECONDS = 3


async def generate_task(
    client: httpx.AsyncClient, config: ConnectionRecord, api_key: str, prompt: str,
    mode: GenerationMode, assets: list[MediaAsset], media: MediaRepository, request_id: str,
) -> tuple[list[str], dict, str]:
    options = config.generation
    uris = [uri for _, uri in [await asyncio.to_thread(media.data_uri, asset.id) for asset in assets]]
    seed = {"seed": options.seed} if options.seed is not None else {}
    if config.provider == "seedance":
        url = config.base_url + "/contents/generations/tasks"
        content = [{"type": "text", "text": prompt}]
        for index, uri in enumerate(uris):
            content.append({"type": "image_url", "image_url": {"url": uri}, "role": "first_frame" if index == 0 else "last_frame"})
        payload = {"model": config.api_model, "content": content, "duration": options.duration, "resolution": options.video_resolution, "ratio": options.aspect_ratio, "generate_audio": options.audio, **seed}
        model = config.api_model.lower()
        if mode == "image2video" and "seedance-2-5" in model:
            payload["ratio"] = "adaptive"
        if "seedance-1-0" in model:
            payload.pop("generate_audio")
        headers = {}
    elif config.provider == "wan":
        url = alibaba_base(config.base_url) + "/api/v1/services/aigc/video-generation/video-synthesis"
        input_data: dict = {"prompt": prompt}
        if uris:
            input_data["media"] = [{"type": "first_frame" if index == 0 else "last_frame", "url": uri} for index, uri in enumerate(uris)]
        payload = {"model": config.api_model, "input": input_data, "parameters": {"duration": options.duration, "resolution": options.video_resolution.upper(), "ratio": options.aspect_ratio, "audio": options.audio, **seed}}
        headers = {"X-DashScope-Async": "enable"}
    else:
        url = config.base_url + "/generate/image/krea/" + config.api_model
        payload = {"prompt": prompt, "resolution": "1K", "aspect_ratio": options.aspect_ratio, "creativity": options.creativity, **seed}
        if uris:
            payload.update({"image_url": uris[0], "strength": 0.75})
        headers = {}
    jobs = GenerationJobRepository(media.database)
    remote_id = await asyncio.to_thread(jobs.claim, request_id, config)
    if remote_id is None:
        created = await request_json(client, "POST", url, label=config.provider, api_key=api_key, payload=payload, headers=headers)
        remote_id = created.get("output", {}).get("task_id") if config.provider == "wan" else created.get("job_id" if config.provider == "krea" else "id")
        if not safe_code(remote_id, api_key):
            raise RuntimeServiceError(502, "生成请求已提交，但未返回有效任务号；请先到厂商控制台核对，不要重复提交。")
        await asyncio.to_thread(jobs.submitted, request_id, remote_id)
    suffix = quote(remote_id, safe="")
    query = alibaba_base(config.base_url) + "/api/v1/tasks/" + suffix if config.provider == "wan" else config.base_url + ("/jobs/" if config.provider == "krea" else "/contents/generations/tasks/") + suffix
    deadline = monotonic() + config.timeout_seconds
    try:
        while monotonic() < deadline:
            data = await request_json(client, "GET", query, label=config.provider, api_key=api_key)
            result = data.get("output", {}) if config.provider == "wan" else data
            status = result.get("task_status") if config.provider == "wan" else result.get("status")
            if status in {"SUCCEEDED", "succeeded", "completed"}:
                if config.provider == "wan":
                    values = [result.get("video_url")]
                elif config.provider == "seedance":
                    values = [result.get("content", {}).get("video_url")]
                else:
                    values = (result.get("result") or {}).get("urls", [])
                return values, data.get("usage", {}), remote_id
            if status in {"FAILED", "CANCELED", "CANCELLED", "UNKNOWN", "failed", "cancelled", "expired"}:
                raise provider_error(422, result, config.provider, api_key)
            waiting = {"PENDING", "RUNNING", "queued", "running", "backlogged", "scheduled", "processing", "sampling", "intermediate-complete"}
            if status not in waiting:
                raise RuntimeServiceError(502, "厂商返回了未识别的任务状态。")
            await asyncio.sleep(min(POLL_INTERVAL_SECONDS, max(0, deadline - monotonic())))
    except (RuntimeServiceError, httpx.HTTPError) as exc:
        message = str(exc.detail) if isinstance(exc, RuntimeServiceError) else "查询生成结果时网络异常。"
        raise RuntimeServiceError(502, f"{message} 厂商任务号：{remote_id}；任务号已保存，请查询原任务，勿重复提交。") from None
    raise RuntimeServiceError(504, f"等待生成超时，厂商任务号：{remote_id}。任务可能仍在生成；请在厂商控制台查询原任务，勿重复提交。")
