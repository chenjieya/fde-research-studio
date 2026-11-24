from collections.abc import Awaitable
from typing import TypeVar

from fastapi import HTTPException

from prism_server.core.exceptions import RuntimeServiceError

T = TypeVar("T")


async def service_response(operation: Awaitable[T]) -> T:
    """把业务错误转成 HTTP 错误，业务服务里不用直接写 FastAPI 代码。"""
    try:
        return await operation
    except RuntimeServiceError as exc:
        raise HTTPException(exc.status_code, exc.detail) from None
