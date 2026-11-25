from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from postgres_case import PostgresTestCase
from prism_server.app import create_app
from prism_server.core.config import Settings
from prism_server.repositories.runtime_runs import RunRepository
from prism_server.repositories.workspaces import WorkspaceRepository
from prism_server.services.runtime import RuntimeService
from test_workspace import sample_workspace


class ApiTests(PostgresTestCase):
    def setUp(self):
        super().setUp()
        repo = RunRepository(self.database)
        self.sdk = SimpleNamespace(
            assistants=SimpleNamespace(get_graph=AsyncMock(return_value={"nodes": [], "edges": []})),
            threads=SimpleNamespace(create=AsyncMock(return_value={"thread_id": str(uuid4())}), get_state=AsyncMock(return_value={"values": {"message": "模拟模型结果", "execution_mode": "model", "latency_seconds": 0.12, "usage": {"total_tokens": 25}}})),
            runs=SimpleNamespace(create=AsyncMock(return_value={"run_id": str(uuid4())}), get=AsyncMock(return_value={"status": "success"}), cancel=AsyncMock()),
        )
        self.sdk_context = MagicMock()
        self.sdk_context.__aenter__ = AsyncMock(return_value=self.sdk)
        self.sdk_context.__aexit__ = AsyncMock(return_value=False)
        self.service = RuntimeService(
            Settings.from_env().model_copy(update={"model_encryption_key": Fernet.generate_key().decode()}), repo,
            client_factory=lambda: self.sdk_context,
        )
        self.client = TestClient(create_app(self.service))
        self.client.__enter__()
        WorkspaceRepository(self.database).save(sample_workspace(), 0)
        self.connection_payload = {"provider": "openai", "api_model": "test-chat", "base_url": "http://127.0.0.1:19325/v1", "api_key": "test-secret"}
        configured = self.client.put("/prism/runtime/models/model-a", json=self.connection_payload)
        self.assertEqual(configured.status_code, 200, configured.text)
        self.conversation_id = self.client.post("/prism/runtime/conversations").json()["id"]
        self.run_payload = {"prompt": "验证", "model_id": "model-a", "conversation_id": self.conversation_id}

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_sdk_graph_and_run_lifecycle(self):
        self.assertTrue(self.client.get("/prism/runtime/graph").json()["compiled"])
        created = self.client.post("/prism/runtime/runs", json=self.run_payload)
        self.assertEqual(created.status_code, 201)
        record = created.json()
        self.assertEqual(record["status"], "running")
        self.sdk.runs.create.assert_awaited_once()
        self.assertTrue(self.sdk_context.__aexit__.await_count >= 2)
        self.assertEqual(self.sdk.runs.create.call_args.kwargs["input"]["request_id"], record["id"])
        finished = self.client.get(f"/prism/runtime/runs/{record['id']}").json()
        self.assertEqual(finished["status"], "success")
        self.assertEqual(finished["output"]["message"], "模拟模型结果")
        self.assertEqual(self.client.get("/prism/runtime/runs").json()[0]["status"], "success")

    def test_invalid_inputs_and_unknown_runs(self):
        for payload in [{"prompt": " "}, {"prompt": "x" * 20001}, {"prompt": "x", "api_key": "should-not-be-accepted"}]:
            self.assertEqual(self.client.post("/prism/runtime/runs", json={**self.run_payload, **payload}).status_code, 422)
        self.assertEqual(self.client.get(f"/prism/runtime/runs/{uuid4()}").status_code, 404)
        self.assertEqual(self.client.get("/prism/runtime/runs?limit=101").status_code, 422)

    def test_sdk_failure_is_logged_without_returning_secrets(self):
        self.sdk.runs.create.side_effect = httpx.ConnectError("secret-value https://private.example?token=secret")
        result = self.client.post("/prism/runtime/runs", json=self.run_payload)
        self.assertEqual(result.status_code, 502)
        self.assertNotIn("secret", result.text)
        record = self.client.get("/prism/runtime/runs").json()[0]
        self.assertEqual(record["status"], "error")
        self.assertIsNotNone(record["finished_at"])
        self.assertNotIn("secret", str(record))

    def test_unconfigured_langsmith_is_not_reported_as_verified(self):
        health = self.client.get("/prism/runtime/health").json()
        self.assertFalse(health["tracing"]["verified"])
        created = self.client.post("/prism/runtime/runs", json=self.run_payload).json()
        with patch.object(self.service, "settings", self.service.settings.model_copy(update={"tracing_enabled": False, "tracing_key_configured": False})):
            self.assertEqual(self.client.post(f"/prism/runtime/runs/{created['id']}/trace").status_code, 409)

    def test_query_failure_preserves_remote_running_state(self):
        created = self.client.post("/prism/runtime/runs", json=self.run_payload).json()
        self.sdk.runs.get.side_effect = httpx.ConnectError("temporary disconnect")
        self.assertEqual(self.client.get(f"/prism/runtime/runs/{created['id']}").status_code, 502)
        saved = self.client.get("/prism/runtime/runs").json()[0]
        self.assertEqual(saved["status"], "running")
        self.assertIsNone(saved["finished_at"])

    def test_cancel_uses_sdk_and_records_actual_remote_status(self):
        created = self.client.post("/prism/runtime/runs", json=self.run_payload).json()
        self.sdk.runs.get.return_value = {"status": "interrupted"}
        result = self.client.post(f"/prism/runtime/runs/{created['id']}/cancel")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["status"], "interrupted")
        self.sdk.runs.cancel.assert_awaited_once_with(created["thread_id"], created["agent_run_id"], action="interrupt")

    def test_trace_is_verified_only_after_monitoring_lookup_succeeds(self):
        created = self.client.post("/prism/runtime/runs", json=self.run_payload).json()
        trace_url = "https://smith.langchain.com/public/test-run/r"
        with (
            patch.object(self.service, "settings", self.service.settings.model_copy(update={"tracing_enabled": True, "tracing_key_configured": True})),
            patch.object(self.service, "trace_reader", side_effect=RuntimeError("not-yet-reported")),
        ):
            self.assertEqual(self.client.post(f"/prism/runtime/runs/{created['id']}/trace").status_code, 502)
        self.assertEqual(self.client.get("/prism/runtime/runs").json()[0]["trace_status"], "unverified")
        with (
            patch.object(self.service, "settings", self.service.settings.model_copy(update={"tracing_enabled": True, "tracing_key_configured": True})),
            patch.object(self.service, "trace_reader", return_value=trace_url),
        ):
            result = self.client.post(f"/prism/runtime/runs/{created['id']}/trace")
        self.assertEqual(result.json()["trace_status"], "verified")
        self.assertEqual(result.json()["trace_url"], trace_url)

    def test_credentials_are_encrypted_retained_cleared_and_excluded_from_backups(self):
        configs = self.client.get("/prism/runtime/models").json()
        self.assertTrue(configs[0]["api_key_configured"])
        self.assertNotIn("test-secret", str(configs))
        self.assertNotIn("test-secret", self.client.get("/prism/workspace").text)
        with self.database.connect() as connection:
            encrypted = connection.execute("SELECT api_key_ciphertext FROM model_connections").fetchone()["api_key_ciphertext"]
            self.assertNotEqual(encrypted, "test-secret")
        retained = self.client.put("/prism/runtime/models/model-a", json={**self.connection_payload, "api_key": "", "expected_revision": 1})
        self.assertTrue(retained.json()["api_key_configured"])
        self.assertEqual(self.service.models.resolve("model-a")[1], "test-secret")
        self.assertEqual(self.client.put("/prism/runtime/models/model-a", json=self.connection_payload).status_code, 409)
        cleared = self.client.put("/prism/runtime/models/model-a", json={**self.connection_payload, "api_key": "", "clear_api_key": True, "expected_revision": 2})
        self.assertFalse(cleared.json()["api_key_configured"])

    def test_dynamic_model_configuration_and_successful_history_pass_through_context(self):
        first = self.client.post("/prism/runtime/runs", json=self.run_payload).json()
        self.client.get(f"/prism/runtime/runs/{first['id']}")
        self.client.put("/prism/runtime/models/model-a", json={**self.connection_payload, "provider": "anthropic", "api_model": "second-model", "expected_revision": 1})
        second = self.client.post("/prism/runtime/runs", json={**self.run_payload, "prompt": "继续"})
        self.assertEqual(second.status_code, 201, second.text)
        call = self.sdk.runs.create.call_args.kwargs
        self.assertEqual(call["input"]["history"], [{"role": "user", "content": "验证"}, {"role": "assistant", "content": "模拟模型结果"}])
        self.assertEqual(call["context"]["model_revision"], 2)
        self.assertEqual(call["context"]["tools"], [])
        self.assertNotIn("test-secret", str(call))
        self.assertEqual(first["model_snapshot"]["provider"], "openai")
        self.assertEqual(second.json()["model_snapshot"]["provider"], "anthropic")

    def test_running_turn_prevents_parallel_send_and_reopening_reconciles(self):
        self.sdk.runs.get.return_value = {"status": "running"}
        self.client.post("/prism/runtime/runs", json=self.run_payload)
        self.assertEqual(self.client.post("/prism/runtime/runs", json=self.run_payload).status_code, 409)
        self.sdk.runs.get.return_value = {"status": "success"}
        reopened = self.client.get(f"/prism/runtime/conversations/{self.conversation_id}/runs").json()
        self.assertEqual(reopened[0]["status"], "success")
        self.assertEqual(self.client.get("/prism/runtime/conversations").json()[0]["title"], "验证")

    def test_experiment_requires_confirmation_is_idempotent_and_preserves_source(self):
        run = self.client.post("/prism/runtime/runs", json=self.run_payload).json()
        payload = sample_workspace().experiments[0].model_dump(mode="json")
        endpoint = f"/prism/runtime/runs/{run['id']}/experiment"
        self.assertEqual(self.client.post(endpoint, json=payload).status_code, 409)
        self.assertEqual(len(WorkspaceRepository(self.database).get().data.experiments), 1)
        self.client.get(f"/prism/runtime/runs/{run['id']}")
        confirmed = self.client.post(endpoint, json={**payload, "modelId": "forged-model", "demo": True})
        self.assertEqual(confirmed.status_code, 201, confirmed.text)
        experiment = confirmed.json()
        self.assertEqual(experiment["modelId"], "model-a")
        self.assertFalse(experiment["demo"])
        self.assertEqual(self.client.post(endpoint, json=payload).json()["id"], experiment["id"])
        self.assertEqual(WorkspaceRepository(self.database).get().revision, 2)
        source = self.client.get(f"/prism/runtime/experiments/{experiment['id']}/source").json()
        self.assertEqual(source["output"]["message"], "模拟模型结果")

    def test_disabled_unknown_and_changed_model_connections_are_rejected(self):
        missing = self.client.post("/prism/runtime/runs", json={**self.run_payload, "model_id": "missing"})
        self.assertEqual(missing.status_code, 409)
        self.client.put("/prism/runtime/models/model-a", json={**self.connection_payload, "enabled": False, "expected_revision": 1})
        self.assertEqual(self.client.post("/prism/runtime/runs", json=self.run_payload).status_code, 409)
        with self.assertRaises(Exception) as caught:
            self.service.models.resolve("model-a", 1)
        self.assertNotIn("test-secret", str(caught.exception))
