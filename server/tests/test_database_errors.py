"""数据库异常分类回归：SQL 错误不能伪装成隧道故障，也不能泄露凭据。"""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import psycopg
from fastapi.testclient import TestClient
from prism_server.app import create_app
from prism_server.repositories.workspaces import WorkspaceRepository


class DatabaseErrorTests(unittest.TestCase):
    def test_database_errors_are_classified_and_logged_without_sensitive_details(self):
        service = SimpleNamespace(repository=SimpleNamespace(database=MagicMock()), initialize=AsyncMock())
        cases = (
            (psycopg.OperationalError, 503, "连接失败"),
            (psycopg.errors.QueryCanceled, 504, "超时"),
            (psycopg.errors.LockNotAvailable, 409, "并发冲突"),
            (psycopg.errors.UniqueViolation, 409, "约束冲突"),
            (psycopg.errors.ForeignKeyViolation, 409, "约束冲突"),
            (psycopg.errors.InvalidPassword, 503, "认证失败"),
            (psycopg.errors.UndefinedTable, 500, "数据库操作失败"),
        )
        with TestClient(create_app(service)) as client:
            for error_type, status, message in cases:
                with self.subTest(error_type=error_type.__name__):
                    error = error_type("secret-password postgresql://private-host/private-db")
                    with patch.object(WorkspaceRepository, "get", side_effect=error), self.assertLogs("prism_server.app", level="ERROR") as logs:
                        response = client.get("/prism/workspace")
                    self.assertEqual(response.status_code, status)
                    self.assertIn(message, response.json()["detail"])
                    combined = response.text + " ".join(logs.output)
                    self.assertIn(error_type.__name__, " ".join(logs.output))
                    self.assertIn("/prism/workspace", " ".join(logs.output))
                    self.assertNotIn("secret-password", combined)
                    self.assertNotIn("postgresql://", combined)
                    if error.sqlstate:
                        self.assertIn(error.sqlstate, response.text)
