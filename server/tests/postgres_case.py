"""显式配置测试连接串后，每条测试使用独立 schema，结束只删除该测试 schema。"""

import os
import unittest
from uuid import uuid4

from prism_server.db.postgres import PostgresDatabase
from psycopg import sql


class PostgresTestCase(unittest.TestCase):
    def setUp(self):
        url = os.getenv("PRISM_TEST_DATABASE_URL")
        if not url:
            self.skipTest("需设置 PRISM_TEST_DATABASE_URL；测试只读写自动创建的 test_<uuid> schema")
        self.database = PostgresDatabase(url, schema="test_" + uuid4().hex)
        self.database.initialize()
        self.addCleanup(self.drop_test_schema)

    def drop_test_schema(self):
        self.assertRegex(self.database.schema, r"^test_[0-9a-f]{32}$")
        with self.database.connect() as connection:
            connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(self.database.schema)))
