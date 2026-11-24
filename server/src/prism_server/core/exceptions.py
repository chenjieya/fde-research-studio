class RuntimeServiceError(Exception):
    """保存可以展示给用户的错误；API 层再把它转成 HTTP 响应。"""

    def __init__(self, status_code: int, detail: str | dict[str, str]):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail
