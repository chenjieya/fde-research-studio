from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient
from postgres_case import PostgresTestCase
from prism_server.app import create_app
from prism_server.core.config import Settings
from prism_server.repositories.runtime_runs import RunRepository
from prism_server.services.runtime import RuntimeService


class ApiTests(PostgresTestCase):
    def setUp(self):
        super().setUp()
        repo = RunRepository(self.database)
        self.sdk = SimpleNamespace(
            assistants=SimpleNamespace(get_graph=AsyncMock(return_value={"nodes": [], "edges": []})),
            threads=SimpleNamespace(create=AsyncMock(return_value={"thread_id": str(uuid4())}), get_state=AsyncMock(return_value={"values": {"message": "未调用 AI", "echo": "验证", "execution_mode": "connection_check"}})),
            runs=SimpleNamespace(create=AsyncMock(return_value={"run_id": str(uuid4())}), get=AsyncMock(return_value={"status": "success"}), cancel=AsyncMock()),
        )
        self.sdk_context = MagicMock()
        self.sdk_context.__aenter__ = AsyncMock(return_value=self.sdk)
        self.sdk_context.__aexit__ = AsyncMock(return_value=False)
        self.service = RuntimeService(
            Settings.from_env(), repo,
            client_factory=lambda: self.sdk_context,
        )
        self.client = TestClient(create_app(self.service))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_sdk_graph_and_run_lifecycle(self):
        self.assertTrue(self.client.get("/prism/runtime/graph").json()["compiled"])
        created = self.client.post("/prism/runtime/runs", json={"prompt": "验证"})
        self.assertEqual(created.status_code, 201)
        record = created.json()
        self.assertEqual(record["status"], "running")
        self.sdk.runs.create.assert_awaited_once()
        self.assertTrue(self.sdk_context.__aexit__.await_count >= 2)
        self.assertEqual(self.sdk.runs.create.call_args.kwargs["input"]["request_id"], record["id"])
        finished = self.client.get(f"/prism/runtime/runs/{record['id']}").json()
        self.assertEqual(finished["status"], "success")
        self.assertEqual(finished["output"]["echo"], "验证")
        self.assertEqual(self.client.get("/prism/runtime/runs").json()[0]["status"], "success")

    def test_invalid_inputs_and_unknown_runs(self):
        for payload in [{"prompt": " "}, {"prompt": "x" * 4001}, {"prompt": "x", "api_key": "should-not-be-accepted"}]:
            self.assertEqual(self.client.post("/prism/runtime/runs", json=payload).status_code, 422)
        self.assertEqual(self.client.get(f"/prism/runtime/runs/{uuid4()}").status_code, 404)
        self.assertEqual(self.client.get("/prism/runtime/runs?limit=101").status_code, 422)

    def test_sdk_failure_is_logged_without_returning_secrets(self):
        self.sdk.runs.create.side_effect = httpx.ConnectError("secret-value https://private.example?token=secret")
        result = self.client.post("/prism/runtime/runs", json={"prompt": "验证"})
        self.assertEqual(result.status_code, 502)
        self.assertNotIn("secret", result.text)
        record = self.client.get("/prism/runtime/runs").json()[0]
        self.assertEqual(record["status"], "error")
        self.assertIsNotNone(record["finished_at"])
        self.assertNotIn("secret", str(record))

    def test_unconfigured_langsmith_is_not_reported_as_verified(self):
        health = self.client.get("/prism/runtime/health").json()
        self.assertFalse(health["tracing"]["verified"])
        created = self.client.post("/prism/runtime/runs", json={"prompt": "验证"}).json()
        with patch.object(self.service, "settings", replace(self.service.settings, tracing_enabled=False, tracing_key_configured=False)):
            self.assertEqual(self.client.post(f"/prism/runtime/runs/{created['id']}/trace").status_code, 409)

    def test_query_failure_preserves_remote_running_state(self):
        created = self.client.post("/prism/runtime/runs", json={"prompt": "验证"}).json()
        self.sdk.runs.get.side_effect = httpx.ConnectError("temporary disconnect")
        self.assertEqual(self.client.get(f"/prism/runtime/runs/{created['id']}").status_code, 502)
        saved = self.client.get("/prism/runtime/runs").json()[0]
        self.assertEqual(saved["status"], "running")
        self.assertIsNone(saved["finished_at"])

    def test_cancel_uses_sdk_and_records_actual_remote_status(self):
        created = self.client.post("/prism/runtime/runs", json={"prompt": "验证"}).json()
        self.sdk.runs.get.return_value = {"status": "interrupted"}
        result = self.client.post(f"/prism/runtime/runs/{created['id']}/cancel")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["status"], "interrupted")
        self.sdk.runs.cancel.assert_awaited_once_with(created["thread_id"], created["agent_run_id"], action="interrupt")

    def test_trace_is_verified_only_after_monitoring_lookup_succeeds(self):
        created = self.client.post("/prism/runtime/runs", json={"prompt": "验证"}).json()
        trace_url = "https://smith.langchain.com/public/test-run/r"
        with (
            patch.object(self.service, "settings", replace(self.service.settings, tracing_enabled=True, tracing_key_configured=True)),
            patch.object(self.service, "trace_reader", side_effect=RuntimeError("not-yet-reported")),
        ):
            self.assertEqual(self.client.post(f"/prism/runtime/runs/{created['id']}/trace").status_code, 502)
        self.assertEqual(self.client.get("/prism/runtime/runs").json()[0]["trace_status"], "unverified")
        with (
            patch.object(self.service, "settings", replace(self.service.settings, tracing_enabled=True, tracing_key_configured=True)),
            patch.object(self.service, "trace_reader", return_value=trace_url),
        ):
            result = self.client.post(f"/prism/runtime/runs/{created['id']}/trace")
        self.assertEqual(result.json()["trace_status"], "verified")
        self.assertEqual(result.json()["trace_url"], trace_url)
