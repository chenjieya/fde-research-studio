"""读写研究空间；一整次保存放在同一个事务里，失败就全部回滚。"""

import hashlib
import json

from psycopg import Connection, sql
from psycopg.types.json import Jsonb

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.db.postgres import PostgresDatabase
from prism_server.schemas.workspace import Workspace, WorkspaceSnapshot

WORKSPACE_ID = "default"
# 左侧是前端字段，右侧是数据库列名；保留原来的 JSON 备份格式。
MODEL_COLUMNS = {key: key for key in (
    "id", "name", "vendor", "domain", "stage", "summary", "route", "access", "license",
    "source", "updated", "notes", "demo", "favorite",
)}
EXPERIMENT_COLUMNS = {
    "id": "id", "title": "title", "modelId": "model_id", "task": "task", "dataset": "dataset",
    "sampleSize": "sample_size", "successCount": "success_count", "latency": "latency",
    "cost": "cost", "conclusion": "conclusion", "limitations": "limitations", "date": "date", "demo": "demo",
}
NOTE_COLUMNS = {key: key for key in ("id", "title", "domain", "stage", "body", "source", "date", "demo")}
ARTIFACT_COLUMNS = {key: key for key in ("id", "title", "kind", "content", "date")}


class WorkspaceRepository:
    """把模型、实验、手记和交付物分别存表，读取时重新组装成整份记录。"""

    def __init__(self, database: PostgresDatabase):
        self.database = database

    @staticmethod
    def _read(connection: Connection, revision: int) -> WorkspaceSnapshot:
        """使用同一连接读取各张表，恢复展示顺序以及模型关联。"""
        def records(table: str, columns: dict[str, str]) -> list[dict[str, object]]:
            rows = connection.execute(
                sql.SQL("SELECT {} FROM {} WHERE workspace_id=%s ORDER BY position, id").format(
                    sql.SQL(", ").join(map(sql.Identifier, columns.values())), sql.Identifier(table),
                ), (WORKSPACE_ID,),
            ).fetchall()
            return [{name: row[column] for name, column in columns.items()} for row in rows]

        models = records("models", MODEL_COLUMNS)
        capabilities = connection.execute(
            "SELECT model_id, capability FROM model_capabilities WHERE workspace_id=%s ORDER BY position", (WORKSPACE_ID,),
        ).fetchall()
        for model in models:
            model["capabilities"] = [row["capability"] for row in capabilities if row["model_id"] == model["id"]]
        artifacts = records("artifacts", ARTIFACT_COLUMNS)
        links = connection.execute(
            "SELECT artifact_id, model_id FROM artifact_models WHERE workspace_id=%s ORDER BY position", (WORKSPACE_ID,),
        ).fetchall()
        for artifact in artifacts:
            artifact["modelIds"] = [row["model_id"] for row in links if row["artifact_id"] == artifact["id"]]
        return WorkspaceSnapshot(data=Workspace.model_validate({
            "version": 1, "models": models, "experiments": records("experiments", EXPERIMENT_COLUMNS),
            "notes": records("research_notes", NOTE_COLUMNS), "artifacts": artifacts,
        }), revision=revision)

    def get(self) -> WorkspaceSnapshot:
        """读取当前记录和版本号，读取过程中不允许其他保存插进来。"""
        with self.database.connect() as connection:
            # 防止跨表读取时穿插另一个保存事务，保证快照一致。
            root = connection.execute("SELECT revision FROM workspaces WHERE id=%s FOR SHARE", (WORKSPACE_ID,)).fetchone()
            return self._read(connection, root["revision"])

    @staticmethod
    def _write(connection: Connection, workspace: Workspace) -> None:
        """先保存实体，再更新关联；提交和回滚由调用方控制。"""
        groups = (
            ("models", MODEL_COLUMNS, workspace.models),
            ("experiments", EXPERIMENT_COLUMNS, workspace.experiments),
            ("research_notes", NOTE_COLUMNS, workspace.notes),
            ("artifacts", ARTIFACT_COLUMNS, workspace.artifacts),
        )
        for table, mapping, records in groups:
            columns = ["workspace_id", *mapping.values(), "position"]
            updates = [column for column in columns if column not in {"workspace_id", "id"}]
            statement = sql.SQL(
                "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT(workspace_id, id) DO UPDATE SET {}, updated_at=now()"
            ).format(
                sql.Identifier(table), sql.SQL(", ").join(map(sql.Identifier, columns)),
                sql.SQL(", ").join(sql.Placeholder() for _ in columns),
                sql.SQL(", ").join(sql.SQL("{}=EXCLUDED.{}").format(sql.Identifier(key), sql.Identifier(key)) for key in updates),
            )
            for position, record in enumerate(records):
                payload = record.model_dump()
                connection.execute(statement, [WORKSPACE_ID, *(payload[key] for key in mapping), position])

        connection.execute("DELETE FROM model_capabilities WHERE workspace_id=%s", (WORKSPACE_ID,))
        connection.execute("DELETE FROM artifact_models WHERE workspace_id=%s", (WORKSPACE_ID,))
        for model in workspace.models:
            for position, capability in enumerate(model.capabilities):
                connection.execute(
                    "INSERT INTO model_capabilities(workspace_id, model_id, capability, position) VALUES (%s, %s, %s, %s)",
                    (WORKSPACE_ID, model.id, capability, position),
                )
        for artifact in workspace.artifacts:
            for position, model_id in enumerate(artifact.modelIds):
                connection.execute(
                    "INSERT INTO artifact_models(workspace_id, artifact_id, model_id, position) VALUES (%s, %s, %s, %s)",
                    (WORKSPACE_ID, artifact.id, model_id, position),
                )
        # 按引用反向顺序清理被移除记录，不影响其他工作空间。
        for table, _, records in reversed(groups):
            connection.execute(
                sql.SQL("DELETE FROM {} WHERE workspace_id=%s AND NOT(id=ANY(%s::text[]))").format(sql.Identifier(table)),
                (WORKSPACE_ID, [record.id for record in records]),
            )

    def save(self, workspace: Workspace, expected_revision: int) -> WorkspaceSnapshot:
        """页面带来的版本号仍然一致才保存，成功后把版本号加一。"""
        with self.database.connect() as connection:
            root = connection.execute("SELECT revision FROM workspaces WHERE id=%s FOR UPDATE", (WORKSPACE_ID,)).fetchone()
            if root["revision"] != expected_revision:
                raise RuntimeServiceError(409, "线上记录已被其他页面更新。请刷新后重试；当前未保存内容仍保留在编辑窗口中。")
            self._write(connection, workspace)
            connection.execute("UPDATE workspaces SET revision=revision+1, updated_at=now() WHERE id=%s", (WORKSPACE_ID,))
            return WorkspaceSnapshot(data=workspace, revision=expected_revision + 1)

    def import_legacy(self, workspace: Workspace, source_id: str) -> WorkspaceSnapshot:
        """同一份旧记录只导入一次；遇到已改过的同 ID 记录时停止，不覆盖。"""
        payload = workspace.model_dump(mode="json")
        digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        with self.database.connect() as connection:
            root = connection.execute("SELECT revision FROM workspaces WHERE id=%s FOR UPDATE", (WORKSPACE_ID,)).fetchone()
            imported = connection.execute(
                "SELECT payload_hash FROM workspace_imports WHERE workspace_id=%s AND source_id=%s", (WORKSPACE_ID, source_id),
            ).fetchone()
            if imported:
                if imported["payload_hash"] != digest:
                    raise RuntimeServiceError(409, "同一迁移编号的数据已变化，请使用新的迁移编号。")
                return self._read(connection, root["revision"])
            current = self._read(connection, root["revision"]).data.model_dump(mode="json")
            seed = connection.execute(
                "SELECT payload_hash FROM workspace_imports WHERE workspace_id=%s AND source_id='bundled-demo-v1'", (WORKSPACE_ID,),
            ).fetchone()
            current_hash = hashlib.sha256(json.dumps(current, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            seed_only = bool(seed) and current_hash == seed["payload_hash"]
            for group in ("models", "experiments", "notes", "artifacts"):
                if seed_only:
                    # 线上还只有原始示例时，用本地整份记录替换，避免把删掉的示例补回来。
                    current[group] = payload[group]
                    continue
                existing = {item["id"]: item for item in current[group]}
                incoming_ids = {item["id"] for item in payload[group]}
                for incoming in payload[group]:
                    old = existing.get(incoming["id"])
                    if old and old != incoming:
                        raise RuntimeServiceError(409, "本地与线上存在同 ID 的不同记录，本地数据已保留。请先导出备份，再人工核对恢复。")
                current[group] = payload[group] + [item for item in current[group] if item["id"] not in incoming_ids]
            merged = Workspace.model_validate(current)
            self._write(connection, merged)
            connection.execute("UPDATE workspaces SET revision=revision+1, updated_at=now() WHERE id=%s", (WORKSPACE_ID,))
            connection.execute(
                "INSERT INTO workspace_imports(workspace_id, source_id, payload_hash, counts) VALUES (%s, %s, %s, %s)",
                (WORKSPACE_ID, source_id, digest, Jsonb({group: len(payload[group]) for group in ("models", "experiments", "notes", "artifacts")})),
            )
            return WorkspaceSnapshot(data=merged, revision=root["revision"] + 1)
