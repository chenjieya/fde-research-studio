"""读写工作台自己的运行记录；Agent Server 的线程数据由它自己管理。"""

from psycopg import sql
from psycopg.types.json import Jsonb

from prism_server.db.postgres import PostgresDatabase
from prism_server.schemas.runtime import RunRecord


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
        with self.database.connect() as connection:
            row = connection.execute(
                "INSERT INTO runtime_runs(id, graph_id, input, status, started_at) VALUES (%s, %s, %s, %s, %s) RETURNING *",
                (record.id, record.graph_id, record.input, record.status, record.started_at),
            ).fetchone()
            return self.record(row)

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
