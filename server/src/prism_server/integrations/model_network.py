"""模型请求的网络策略与脱敏诊断；国内官方服务不绕行本机全局代理。"""

import re
from urllib.parse import urlparse

import httpx

from prism_server.integrations.generation.http import provider_error
from prism_server.schemas.models import ModelConnection


def inherits_proxy(config: ModelConnection) -> bool:
    """仅为已知国内端点和回环地址直连；海外及自定义服务沿用环境代理。"""
    host = (urlparse(config.base_url).hostname or "").lower()
    direct = {
        "localhost", "127.0.0.1", "::1", "dashscope.aliyuncs.com",
        "ark.cn-beijing.volces.com", "api.minimax.cn", "api.minimaxi.com",
        "api.mosi.cn", "api.moss.cn",
    }
    return not (host in direct or host.endswith(".cn-beijing.maas.aliyuncs.com"))


def client_options(config: ModelConnection) -> dict:
    """连接阶段限时 15 秒；推理读取沿用档案超时，且不关闭证书校验。"""
    return {
        "trust_env": inherits_proxy(config),
        "timeout": httpx.Timeout(config.timeout_seconds, connect=min(15, config.timeout_seconds)),
        "follow_redirects": False,
    }


def create_model_client(config: ModelConnection) -> httpx.AsyncClient:
    """调用方使用 async with 持有客户端，退出即关闭连接。"""
    return httpx.AsyncClient(**client_options(config))


def exception_types(exc: BaseException) -> list[str]:
    """保留 SDK 包装后的底层类型；不记录请求体、文件、URL、密钥或原始异常文本。"""
    result = []
    seen = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen and len(result) < 10:
        seen.add(id(current))
        name = type(current).__name__
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", name):
            result.append(name)
        current = current.__cause__ or (None if current.__suppress_context__ else current.__context__)
    return result


def model_failure_message(exc: Exception, config: ModelConnection, api_key: str) -> str:
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        body = getattr(exc, "body", None)
        data = dict(body) if isinstance(body, dict) else {}
        request_id = getattr(exc, "request_id", None)
        if request_id and not data.get("request_id"):
            data["request_id"] = request_id
        return str(provider_error(status, data, config.provider, api_key).detail)
    names = exception_types(exc)
    chain = " → ".join(names) or "UnknownError"
    if any("Certificate" in name or name in {"SSLError", "SSLCertVerificationError"} for name in names):
        message = "模型 HTTPS 证书或 TLS 握手失败，请检查本机代理和证书配置。"
    elif "ConnectTimeout" in names:
        message = f"连接模型接口超时（连接上限 {min(15, config.timeout_seconds)} 秒），请检查代理、TLS 连接或接口可达性。"
    elif "WriteTimeout" in names:
        message = "发送模型请求或上传素材超时，请检查网络、代理及素材体积。"
    elif "PoolTimeout" in names:
        message = "等待模型 HTTP 连接池超时，请稍后查询运行状态。"
    elif any("Timeout" in name for name in names):
        message = f"等待模型接口超时（读取上限 {config.timeout_seconds} 秒、连接上限 {min(15, config.timeout_seconds)} 秒）。模型可能仍在推理，请核对思考模式、视频长度及厂商状态。"
    elif any(name == "ProxyError" for name in names):
        message = "连接本机代理失败，请检查代理服务、端口和路由。"
    elif "gaierror" in names:
        message = "模型接口域名解析失败，请检查 DNS 或接口地址。"
    elif any("ConnectionError" in name or name in {"ConnectError", "ConnectionRefusedError", "ConnectionResetError"} for name in names):
        route = "继承环境代理" if inherits_proxy(config) else "直连"
        message = f"模型网络连接失败，HTTPS/TLS 连接未完成（当前{route}）。请检查网络、代理或服务可达性。"
    else:
        message = "模型适配器执行失败，请按异常类型检查对应追踪记录。"
    return f"{message} 异常链：{chain}"
