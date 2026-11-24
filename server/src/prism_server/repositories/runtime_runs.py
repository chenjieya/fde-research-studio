"""读写工作台自己的运行记录；Agent Server 的线程数据由它自己管理。"""

from psycopg import sql
from psycopg.types.json import Jsonb

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.db.postgres import PostgresDatabase
from prism_server.schemas.runtime import Conversation, RunRecord


class RunRepository:
    """把运行记录存进 PostgreSQL，不处理 HTTP 请求或 SDK 调用。"""

    def __init__(self, database: PostgresDatabase):
        self.database = database

    def initialize(self) -> None:
        self.database.initialize()

    @staticmethod
    def record(row: dict) -> RunRecord:
        """把数据库行转成接口记录，时间统一转为带时区的字符串。"""
        raw = dict(row)
        raw.pop("workspace_id")
        for field in ("started_at", "finished_at"):
            if raw[field] is not None:
                raw[field] = raw[field].isoformat()
        return RunRecord(**raw)

    def create(self, record: RunRecord) -> RunRecord:
        """先保存本地运行编号，之后再补上远端线程和运行编号。"""
        return self.create_turn(record)[0]

    def create_turn(self, record: RunRecord) -> tuple[RunRecord, list[RunRecord]]:
        """同一会话内原子取得成功历史并预留新一轮，防止并发发送使用过期上下文。"""
        with self.database.connect() as connection:
            history = []
            if record.conversation_id:
                session = connection.execute("SELECT id FROM chat_sessions WHERE id=%s AND workspace_id='default' FOR UPDATE", (record.conversation_id,)).fetchone()
                if session is None:
                    raise RuntimeServiceError(404, "对话不存在")
                active = connection.execute("SELECT id FROM runtime_runs WHERE conversation_id=%s AND status IN ('pending','running')", (record.conversation_id,)).fetchone()
                if active:
                    raise RuntimeServiceError(409, "上一轮仍在运行，请等待结果或中断后再发送")
                previous = connection.execute("SELECT * FROM runtime_runs WHERE conversation_id=%s AND status='success' ORDER BY started_at,id", (record.conversation_id,)).fetchall()
                history = [self.record(item) for item in previous if item["output"] and item["output"].get("execution_mode") == "model"]
                if len(history) > 40 or sum(len(item.input) + len(str(item.output["message"])) for item in history) + len(record.input) > 200000:
                    raise RuntimeServiceError(409, "本段对话较长，请新建对话继续；历史记录会保留。")
                connection.execute("UPDATE chat_sessions SET updated_at=now(), title=CASE WHEN title='新对话' THEN %s ELSE title END WHERE id=%s", (record.input[:48], record.conversation_id))
            row = connection.execute(
                "INSERT INTO runtime_runs(id, graph_id, input, status, started_at, conversation_id, model_id, model_snapshot) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
                (record.id, record.graph_id, record.input, record.status, record.started_at, record.conversation_id, record.model_id, Jsonb(record.model_snapshot) if record.model_snapshot else None),
            ).fetchone()
            return self.record(row), history

    def get(self, run_id: str) -> RunRecord | None:
        """按工作台编号读取一条记录。"""
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM runtime_runs WHERE id=%s AND workspace_id='default'", (run_id,)).fetchone()
        return self.record(row) if row is not None else None

    def list_recent(self, limit: int = 20, offset: int = 0) -> list[RunRecord]:
        """分页读取最近的运行，编号用来稳定同一时间下的排序。"""
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM runtime_runs WHERE workspace_id='default' ORDER BY started_at DESC, id DESC LIMIT %s OFFSET %s",
                (limit, offset),
            ).fetchall()
        return [self.record(row) for row in rows]

    @staticmethod
    def conversation(row: dict) -> Conversation:
        return Conversation(id=row["id"], title=row["title"], created_at=row["created_at"].isoformat(), updated_at=row["updated_at"].isoformat())

    def create_conversation(self, conversation_id: str) -> Conversation:
        with self.database.connect() as connection:
            row = connection.execute("INSERT INTO chat_sessions(id,title) VALUES (%s,'新对话') RETURNING *", (conversation_id,)).fetchone()
        return self.conversation(row)

    def list_conversations(self, offset: int = 0) -> list[Conversation]:
        with self.database.connect() as connection:
            rows = connection.execute("SELECT * FROM chat_sessions WHERE workspace_id='default' ORDER BY updated_at DESC,id DESC LIMIT 40 OFFSET %s", (offset,)).fetchall()
        return [self.conversation(row) for row in rows]

    def conversation_runs(self, conversation_id: str) -> list[RunRecord]:
        with self.database.connect() as connection:
            if not connection.execute("SELECT id FROM chat_sessions WHERE workspace_id='default' AND id=%s", (conversation_id,)).fetchone():
                raise RuntimeServiceError(404, "对话不存在")
            rows = connection.execute("SELECT * FROM runtime_runs WHERE workspace_id='default' AND conversation_id=%s ORDER BY started_at,id", (conversation_id,)).fetchall()
        return [self.record(row) for row in rows]

    def experiment_source(self, experiment_id: str) -> RunRecord | None:
        with self.database.connect() as connection:
            row = connection.execute("SELECT r.* FROM runtime_runs r JOIN experiment_run_links l ON l.run_id=r.id WHERE l.workspace_id='default' AND l.experiment_id=%s", (experiment_id,)).fetchone()
        return self.record(row) if row else None

    def update(self, run_id: str, **updates: object) -> RunRecord:
        """只允许更新白名单字段，较旧的轮询不能把已结束状态改回运行中。"""
        columns = {"status", "thread_id", "agent_run_id", "output", "error", "finished_at", "trace_status", "trace_url"}
        if not updates or not updates.keys() <= columns:
            raise ValueError("运行更新字段不合法")
        normalized = dict(updates)
        if "output" in normalized:
            normalized["output"] = Jsonb(normalized["output"]) if normalized["output"] is not None else None
        guard = " AND status IN ('pending', 'running')" if updates.get("status") in {"pending", "running"} else ""
        with self.database.connect() as connection:
            connection.execute(
                sql.SQL("UPDATE runtime_runs SET {} WHERE id=%s AND workspace_id='default'" + guard).format(
                    sql.SQL(", ").join(sql.SQL("{}=%s").format(sql.Identifier(key)) for key in normalized),
                ), [*normalized.values(), run_id],
            )
            row = connection.execute("SELECT * FROM runtime_runs WHERE id=%s AND workspace_id='default'", (run_id,)).fetchone()
            if row is None:
                raise LookupError("运行记录不存在")
            return self.record(row)
