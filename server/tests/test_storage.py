import psycopg
from postgres_case import PostgresTestCase
from prism_server.core.clock import utc_now
from prism_server.repositories.runtime_runs import RunRepository
from prism_server.schemas.runtime import RunRecord


class StorageTests(PostgresTestCase):
    def setUp(self):
        super().setUp()
        self.repo = RunRepository(self.database)
        self.repo.initialize()

    def test_records_survive_reopening_and_output_roundtrips(self):
        self.repo.create(RunRecord(id="test", graph_id="prism_research", input="输入", status="running", started_at=utc_now()))
        self.repo.update("test", status="success", output={"echo": "中文", "execution_mode": "connection_check"})
        reopened = RunRepository(self.database)
        self.assertEqual(reopened.get("test").output["echo"], "中文")
        self.assertEqual(len(reopened.list_recent(1)), 1)
        self.assertEqual(reopened.list_recent(1, 1), [])

    def test_outdated_poll_cannot_regress_terminal_status(self):
        self.repo.create(RunRecord(id="test", graph_id="g", input="x", status="running", started_at=utc_now()))
        self.repo.update("test", status="success", output={"echo": "done"})
        result = self.repo.update("test", status="running", output=None)
        self.assertEqual(result.status, "success")
        self.assertEqual(result.output["echo"], "done")

    def test_startup_does_not_mark_another_instance_pending_runs_as_failed(self):
        for run_id in ["local", "remote"]:
            self.repo.create(RunRecord(id=run_id, graph_id="g", input="x", status="pending", started_at=utc_now()))
        self.repo.update("remote", agent_run_id="remote-run")
        self.repo.initialize()
        self.assertEqual(self.repo.get("local").status, "pending")
        self.assertEqual(self.repo.get("remote").status, "pending")

    def test_arbitrary_columns_and_invalid_statuses_are_rejected(self):
        self.repo.create(RunRecord(id="test", graph_id="g", input="x", status="running", started_at=utc_now()))
        with self.assertRaises(ValueError):
            self.repo.update("test", **{"status='success' WHERE 1=1 --": "bad"})
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.repo.update("test", status="invented")
