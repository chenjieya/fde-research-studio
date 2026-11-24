"""手动执行 SQL 迁移，也可以导入旧 JSON 备份和 SQLite 运行记录。"""

import argparse
import json
import sqlite3
from pathlib import Path

from psycopg import sql
from psycopg.types.json import Jsonb

from prism_server.core.config import Settings
from prism_server.db.postgres import PostgresDatabase
from prism_server.repositories.workspaces import WorkspaceRepository
from prism_server.schemas.workspace import Workspace


def migrate_sqlite(database: PostgresDatabase, path: Path) -> int:
    """只读旧文件并补入缺少的运行记录，重复执行不会覆盖线上结果。"""
    source = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    try:
        rows = source.execute("SELECT * FROM runtime_runs").fetchall()
    finally:
        source.close()
    count = 0
    with database.connect() as connection:
        for row in rows:
            record = dict(row)
            payload = record.pop("output_json")
            record["output"] = Jsonb(json.loads(payload)) if payload is not None else None
            columns = list(record)
            result = connection.execute(
                sql.SQL("INSERT INTO runtime_runs ({}) VALUES ({}) ON CONFLICT(id) DO NOTHING").format(
                    sql.SQL(", ").join(map(sql.Identifier, columns)),
                    sql.SQL(", ").join(sql.Placeholder() for _ in columns),
                ), list(record.values()),
            )
            count += result.rowcount
    return count


def main() -> None:
    """命令入口：python -m prism_server.db.migrate，导入文件通过参数指定。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, help="旧工作台 JSON 备份")
    parser.add_argument("--source-id", default="bundled-demo-v1", help="幂等迁移编号")
    parser.add_argument("--sqlite", type=Path, help="旧运行记录 SQLite 文件，仅只读导入")
    args = parser.parse_args()
    database = PostgresDatabase(Settings.from_env().database_url)
    database.initialize()
    print("PostgreSQL schema migrations applied.")
    if args.workspace:
        workspace = Workspace.model_validate_json(args.workspace.read_text(encoding="utf-8"))
        snapshot = WorkspaceRepository(database).import_legacy(workspace, args.source_id)
        print("Workspace imported:", {key: len(value) for key, value in snapshot.data.model_dump().items() if isinstance(value, list)})
    if args.sqlite:
        print("Legacy runtime rows imported:", migrate_sqlite(database, args.sqlite))


if __name__ == "__main__":
    main()
