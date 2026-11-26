"""模型接入参数和加密凭据的数据库边界。"""

from psycopg.types.json import Jsonb

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.core.secrets import CredentialCipher
from prism_server.db.postgres import PostgresDatabase
from prism_server.schemas.models import ConnectionInput, ConnectionRecord, ModelConnection


class ModelConnectionRepository:
    def __init__(self, database: PostgresDatabase, cipher: CredentialCipher):
        self.database = database
        self.cipher = cipher

    @staticmethod
    def record(row: dict) -> ConnectionRecord:
        return ConnectionRecord(
            **row["config"],
            model_id=row["model_id"],
            name=row["name"],
            revision=row["revision"],
            api_key_configured=bool(row["api_key_ciphertext"]),
        )

    def list(self) -> list[ConnectionRecord]:
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT c.*, m.name FROM model_connections c JOIN models m ON m.workspace_id=c.workspace_id AND m.id=c.model_id WHERE c.workspace_id='default' ORDER BY m.position, m.id"
            ).fetchall()
        return [self.record(row) for row in rows]

    def save(self, model_id: str, payload: ConnectionInput) -> ConnectionRecord:
        secret = payload.api_key.get_secret_value().strip() if payload.api_key else ""
        if len(secret) > 8192:
            raise RuntimeServiceError(422, "API Key 过长")
        if payload.clear_api_key and secret:
            raise RuntimeServiceError(422, "清除密钥时请留空 API Key")
        config = ModelConnection(
            **payload.model_dump(include=set(ModelConnection.model_fields))
        ).model_dump()
        with self.database.connect() as connection:
            # 同一模型串行保存；锁顺序与工作空间保存一致，避免删除档案时发生死锁。
            connection.execute("SELECT id FROM workspaces WHERE id='default' FOR UPDATE")
            model = connection.execute(
                "SELECT name FROM models WHERE workspace_id='default' AND id=%s", (model_id,)
            ).fetchone()
            if model is None:
                raise RuntimeServiceError(404, "请先保存模型档案")
            existing = connection.execute(
                "SELECT * FROM model_connections WHERE workspace_id='default' AND model_id=%s",
                (model_id,),
            ).fetchone()
            if (existing["revision"] if existing else 0) != payload.expected_revision:
                raise RuntimeServiceError(409, "接入配置已被修改，请重新打开后再保存")
            encrypted = existing["api_key_ciphertext"] if existing else None
            if encrypted and not secret and not payload.clear_api_key:
                previous = self.record({**existing, "name": model["name"]})
                families = {"openai_image": "openai", "qwen_image": "qwen", "wan": "qwen"}
                if families.get(previous.provider, previous.provider) != families.get(payload.provider, payload.provider):
                    raise RuntimeServiceError(422, "切换厂商时请填写新厂商的 API Key，或勾选清除旧密钥；系统不会把旧密钥发给其他厂商。")
            if payload.clear_api_key:
                encrypted = None
            elif secret:
                encrypted = self.cipher.encrypt(secret)
            row = connection.execute(
                "INSERT INTO model_connections(workspace_id,model_id,config,api_key_ciphertext) VALUES ('default',%s,%s,%s) ON CONFLICT (workspace_id,model_id) DO UPDATE SET config=EXCLUDED.config, api_key_ciphertext=EXCLUDED.api_key_ciphertext, revision=model_connections.revision+1, updated_at=now() RETURNING *",
                (model_id, Jsonb(config), encrypted),
            ).fetchone()
            return self.record({**row, "name": model["name"]})

    def resolve(self, model_id: str, revision: int | None = None) -> tuple[ConnectionRecord, str]:
        """运行准备与模型节点在服务端检查凭据；公开查询不走这里。"""
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT c.*, m.name FROM model_connections c JOIN models m ON m.workspace_id=c.workspace_id AND m.id=c.model_id WHERE c.workspace_id='default' AND c.model_id=%s",
                (model_id,),
            ).fetchone()
        if row is None or not row["config"].get("enabled"):
            raise RuntimeServiceError(409, "请先在模型档案中配置并启用该模型")
        if revision is not None and row["revision"] != revision:
            raise RuntimeServiceError(409, "模型配置在提交后发生了变化，请重新发送")
        encrypted = row["api_key_ciphertext"]
        api_key = self.cipher.decrypt(encrypted) if encrypted else "not-needed"
        return self.record(row), api_key
