"""生成接口共用的有界 HTTP、错误提示和结果下载；下载请求不携带模型密钥。"""

import asyncio
import ipaddress
import json
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.repositories.media import MediaRepository, decode_media, detect_media
from prism_server.schemas.media import MAX_MEDIA_BYTES, MediaAsset


def safe_code(value: object, secret: str = "") -> str:
    """只展示错误码 / 请求号，不回显上游可能带凭据的 message、URL 或请求体。"""
    return value if isinstance(value, str) and re.fullmatch(r"[\w.-]{1,100}", value, re.ASCII) and (not secret or secret not in value) else ""


def provider_error(status: int, data: dict, label: str, secret: str) -> RuntimeServiceError:
    nested = data.get("error")
    error = nested if isinstance(nested, dict) else data
    code = safe_code(error.get("code") or error.get("type"), secret)
    request_id = safe_code(data.get("request_id") or data.get("RequestId"), secret)
    message = {
        400: "请求被拒绝，请核对模型版本、生成参数及接口地域。",
        401: "认证失败，请检查此厂商的 API Key。",
        403: "访问被拒绝，请检查模型开通状态与账号权限。",
        404: "接口或模型不存在，请核对官方地址及 Model ID / Endpoint ID。",
        422: "输入素材或生成参数不符合模型要求。",
        429: "请求限流或额度不足，请到厂商控制台核对。",
    }.get(status, "服务暂时不可用，请到厂商控制台查询任务状态后再决定是否重试。")
    detail = f"{label}：{message}（HTTP {status}"
    if code:
        detail += f"，错误码 {code}"
    if request_id:
        detail += f"，请求号 {request_id}"
    return RuntimeServiceError(502, detail + "）")


async def request_json(
    client: httpx.AsyncClient, method: str, url: str, *, label: str, api_key: str,
    payload: dict | None = None, headers: dict | None = None, **kwargs,
) -> dict:
    """计费 POST 不重试；流式读取限制响应体，避免大段 Base64 无界入内存。"""
    async with client.stream(method, url, headers={"Authorization": f"Bearer {api_key}", **(headers or {})}, json=payload, **kwargs) as response:
        raw = bytearray()
        limit = MAX_MEDIA_BYTES * 2 if response.is_success else 64 * 1024
        async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
            raw.extend(chunk)
            if len(raw) > limit:
                raise RuntimeServiceError(502, f"{label}响应超过体积限制，请到厂商控制台查询结果。")
        try:
            data = await asyncio.to_thread(json.loads, raw)
        except (ValueError, UnicodeDecodeError):
            data = {}
        if not response.is_success:
            raise provider_error(response.status_code, data if isinstance(data, dict) else {}, label, api_key)
        if not isinstance(data, dict) or not data:
            raise RuntimeServiceError(502, f"{label}返回了无法识别的 JSON 结果。")
        if data.get("code") and not data.get("output") and not data.get("data"):
            raise provider_error(400, data, label, api_key)
        return data


def public_addresses(host: str, port: int) -> list[str]:
    """解析一次并固定连接地址，禁止结果链接读取内网或借 DNS 重绑定访问内网。"""
    try:
        addresses = list(dict.fromkeys(info[4][0] for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)))
    except OSError:
        raise RuntimeServiceError(502, "无法解析生成结果的下载域名，请到厂商控制台查询结果。") from None
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise RuntimeServiceError(502, "生成结果地址指向非公网网络，已拒绝下载。")
    return addresses


async def download_media(url: str, timeout_seconds: int) -> bytes:
    """跟随最多三次经校验的 HTTPS 跳转；独立客户端不携带 Authorization 或 Cookie。"""
    async with httpx.AsyncClient(timeout=min(timeout_seconds, 120), follow_redirects=False, trust_env=False) as client:
        for _ in range(4):
            parsed = urlparse(url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
                raise RuntimeServiceError(502, "生成结果必须为不含登录凭据的公网 HTTPS 地址。")
            addresses = await asyncio.to_thread(public_addresses, parsed.hostname, 443)
            # URL 使用已校验 IP，TLS SNI 及证书验证仍使用原域名。
            target = httpx.URL(url).copy_with(host=addresses[0])
            async with client.stream("GET", target, headers={"Host": parsed.hostname, "Accept-Encoding": "identity"}, extensions={"sni_hostname": parsed.hostname}) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        break
                    url = urljoin(url, location)
                    continue
                if not response.is_success:
                    raise RuntimeServiceError(502, "生成已经完成，但结果下载失败；请到厂商控制台取回原任务结果。")
                raw = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                    raw.extend(chunk)
                    if len(raw) > MAX_MEDIA_BYTES:
                        raise RuntimeServiceError(502, "生成结果超过 64 MB，请到厂商控制台下载原文件。")
                return bytes(raw)
    raise RuntimeServiceError(502, "生成结果下载跳转过多，请到厂商控制台查询。")


async def store_results(values: list[str], kind: str, media: MediaRepository, timeout_seconds: int) -> list[MediaAsset]:
    """临时 URL 及时转存；验文件签名，只向图状态返回本系统的媒体引用。"""
    if not values or len(values) > 6 or any(not isinstance(value, str) or not value for value in values):
        raise RuntimeServiceError(502, "模型没有返回有效媒体结果，或结果数量超过 6 个。")
    contents: list[bytes] = []
    total = 0
    for value in values:
        content = await download_media(value, timeout_seconds) if value.startswith(("https:", "http:")) else await asyncio.to_thread(decode_media, value)
        total += len(content)
        if total > MAX_MEDIA_BYTES:
            raise RuntimeServiceError(502, "模型生成的媒体总量超过 64 MB。")
        if detect_media(content).split("/")[0] != kind:
            raise RuntimeServiceError(502, "模型返回的媒体格式与任务不符。")
        contents.append(content)
    return [await asyncio.to_thread(media.save, content, "生成结果", generated=True) for content in contents]
