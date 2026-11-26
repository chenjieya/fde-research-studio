"""异步生成任务号独立保存；不存密钥、签名 URL 或 Base64。"""

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.db.postgres import PostgresDatabase
from prism_server.schemas.models import ConnectionRecord


class GenerationJobRepository:
    def __init__(self, database: PostgresDatabase):
        self.database = database

    def claim(self, request_id: str, config: ConnectionRecord) -> str | None:
        """首次占位后才允许提交；请求结果未知时禁止自动重发，防止重复计费。"""
        with self.database.connect() as connection:
            created = connection.execute(
                "INSERT INTO generation_jobs(request_id,provider,model_id,model_revision) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING request_id",
                (request_id, config.provider, config.model_id, config.revision),
            ).fetchone()
            if created:
                return None
            row = connection.execute("SELECT * FROM generation_jobs WHERE request_id=%s", (request_id,)).fetchone()
        if (row["provider"], row["model_id"], row["model_revision"]) != (config.provider, config.model_id, config.revision):
            raise RuntimeServiceError(409, "此请求已有其他模型的生成任务，请查询原运行。")
        if not row["remote_id"]:
            raise RuntimeServiceError(409, "此生成请求已提交但尚未取得任务号，请先到厂商控制台核对，系统不会自动重复提交。")
        return row["remote_id"]

    def submitted(self, request_id: str, remote_id: str) -> None:
        with self.database.connect() as connection:
            connection.execute("UPDATE generation_jobs SET remote_id=%s WHERE request_id=%s AND remote_id IS NULL", (remote_id, request_id))
