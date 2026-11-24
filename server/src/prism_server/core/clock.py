from datetime import UTC, datetime


def utc_now() -> str:
    """返回带时区的 UTC 时间字符串，供数据库和接口统一使用。"""
    return datetime.now(UTC).isoformat()
