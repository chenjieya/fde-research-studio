"""模型凭据仅在服务端解密；加密根密钥由环境提供，不能与数据库一起丢失。"""

from cryptography.fernet import Fernet, InvalidToken

from prism_server.core.exceptions import RuntimeServiceError


class CredentialCipher:
    def __init__(self, key: str):
        self.key = key

    def _fernet(self) -> Fernet:
        try:
            return Fernet(self.key.encode())
        except (ValueError, TypeError):
            raise RuntimeServiceError(
                503, "请在服务端配置有效的 PRISM_MODEL_ENCRYPTION_KEY 后重启。"
            ) from None

    def encrypt(self, value: str) -> str:
        return self._fernet().encrypt(value.encode()).decode()

    def decrypt(self, value: str) -> str:
        try:
            return self._fernet().decrypt(value.encode()).decode()
        except InvalidToken:
            raise RuntimeServiceError(
                503, "模型密钥无法解密，请恢复原加密密钥，或重新填写该模型的 API Key。"
            ) from None
