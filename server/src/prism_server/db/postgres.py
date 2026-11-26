"""连接 PostgreSQL，并按顺序执行还没应用过的 SQL 迁移。"""

import hashlib
import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import psycopg
from psycopg import Connection, sql
from psycopg.rows import dict_row


class PostgresDatabase:
    """管理数据库连接；schema 参数也用于把每条测试的数据隔离开。"""

    def __init__(self, url: str, *, schema: str = "public"):
        if not re.fullmatch(r"[a-z][a-z0-9_]*", schema):
            raise ValueError("数据库 schema 名称不合法")
        self.url = url
        self.schema = schema

    @contextmanager
    def connect(self) -> Iterator[Connection[dict[str, Any]]]:
        """正常退出时提交，出错时回滚，最后关闭连接。"""
        # SSH 隧道上的连接握手允许短暂网络波动；连接串不写入日志或响应。
        with psycopg.connect(
            self.url, row_factory=dict_row, connect_timeout=15,
            options=f"-c search_path={self.schema} -c statement_timeout=15000 -c lock_timeout=10000",
        ) as connection:
            yield connection

    def initialize(self) -> None:
        """检查迁移记录并执行新文件；已执行过的文件不能改动。"""
        with self.connect() as connection:
            connection.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(self.schema)))
            # 多个服务同时启动时，排队执行迁移，避免一起创建同一张表。
            connection.execute("SELECT pg_advisory_xact_lock(hashtext(current_database() || current_schema()))")
            connection.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            for path in sorted(Path(__file__).with_name("migrations").glob("*.sql")):
                source = path.read_text(encoding="utf-8")
                checksum = hashlib.sha256(source.encode()).hexdigest()
                # 注释也算文件内容，修改历史 SQL 会导致校验失败；改表时要新增文件。
                applied = connection.execute(
                    "SELECT checksum FROM schema_migrations WHERE version=%s", (path.name,),
                ).fetchone()
                if applied:
                    if applied["checksum"] != checksum:
                        raise ValueError(f"已应用的迁移不允许修改：{path.name}")
                    continue
                connection.execute(source, prepare=False)
                connection.execute(
                    "INSERT INTO schema_migrations(version, checksum) VALUES (%s, %s)", (path.name, checksum),
                )
