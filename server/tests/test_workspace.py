from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import psycopg
from fastapi.testclient import TestClient
from postgres_case import PostgresTestCase
from prism_server.app import create_app
from prism_server.core.config import Settings
from prism_server.core.exceptions import RuntimeServiceError
from prism_server.repositories.runtime_runs import RunRepository
from prism_server.repositories.workspaces import WorkspaceRepository
from prism_server.schemas.workspace import Workspace
from prism_server.services.runtime import RuntimeService


def sample_workspace() -> Workspace:
    return Workspace.model_validate({
        "version": 1,
        "models": [{
            "id": "model-a", "name": "测试模型", "vendor": "测试", "domain": "图片", "capabilities": ["识别理解", "生成编辑"],
            "stage": "研究中", "summary": "测试", "route": "VLM", "access": "API", "license": "待核实", "source": "",
            "updated": "2026-11-24", "notes": "中文笔记", "demo": False, "favorite": True,
        }],
        "experiments": [{
            "id": "exp-a", "title": "样本验证", "modelId": "model-a", "task": "识别", "dataset": "测试集", "sampleSize": 10,
            "successCount": 8, "latency": None, "cost": 0, "conclusion": "测试", "limitations": "测试", "date": "2026-11-24", "demo": False,
        }],
        "notes": [{"id": "note-a", "title": "手记", "domain": "图片", "stage": "待调研", "body": "测试", "source": "", "date": "2026-11-24", "demo": False}],
        "artifacts": [{"id": "artifact-a", "title": "交付物", "kind": "研究周报", "modelIds": ["model-a"], "content": "# 正文", "date": "2026-11-24"}],
    })


class WorkspaceTests(PostgresTestCase):
    def setUp(self):
        super().setUp()
        self.repo = WorkspaceRepository(self.database)
        self.sample = sample_workspace()

    def test_normalized_roundtrip_and_reopen_preserve_order_links_zero_and_null(self):
        self.repo.save(self.sample, 0)
        reopened = WorkspaceRepository(self.database).get()
        self.assertEqual(reopened.data, self.sample)
        self.assertEqual(reopened.revision, 1)
        with self.database.connect() as connection:
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM model_capabilities").fetchone()["n"], 2)
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM artifact_models").fetchone()["n"], 1)

    def test_language_text_models_and_notes_roundtrip_through_api(self):
        payload = self.sample.model_dump(mode="json")
        payload["models"][0]["domain"] = "语言文本"
        payload["notes"][0]["domain"] = "语言文本"
        service = RuntimeService(Settings.from_env(), RunRepository(self.database))
        with TestClient(create_app(service)) as client:
            saved = client.put("/prism/workspace", json={"expected_revision": 0, "data": payload})
            self.assertEqual(saved.status_code, 200, saved.text)
            restored = client.get("/prism/workspace").json()["data"]
            self.assertEqual(restored, payload)
            payload["models"][0]["domain"] = "未知领域"
            rejected = client.put("/prism/workspace", json={"expected_revision": 1, "data": payload})
            self.assertEqual(rejected.status_code, 422)
            self.assertEqual(client.get("/prism/workspace").json()["revision"], 1)

    def test_stale_writer_cannot_overwrite_cloud_data(self):
        self.repo.save(self.sample, 0)
        with self.assertRaises(RuntimeServiceError) as error:
            self.repo.save(Workspace(models=[], experiments=[], notes=[], artifacts=[]), 0)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.repo.get().data, self.sample)

    def test_failure_rolls_back_entire_save_and_revision(self):
        self.repo.save(self.sample, 0)
        changed = self.sample.model_copy(deep=True)
        changed.models[0].name = "不应保存"
        write = self.repo._write

        def fail_after_write(connection, workspace):
            write(connection, workspace)
            raise psycopg.OperationalError("simulated failure")

        with patch.object(self.repo, "_write", side_effect=fail_after_write), self.assertRaises(psycopg.OperationalError):
            self.repo.save(changed, 1)
        self.assertEqual(self.repo.get().data, self.sample)
        self.assertEqual(self.repo.get().revision, 1)

    def test_import_is_idempotent_and_conflicts_preserve_existing_records(self):
        imported = self.repo.import_legacy(self.sample, "browser:test")
        self.assertEqual(self.repo.import_legacy(self.sample, "browser:test").revision, imported.revision)
        changed = self.sample.model_copy(deep=True)
        changed.models[0].name = "旧版本不同内容"
        with self.assertRaises(RuntimeServiceError):
            self.repo.import_legacy(changed, "browser:other")
        self.assertEqual(self.repo.get().data, self.sample)
        with self.database.connect() as connection:
            self.assertEqual(connection.execute("SELECT count(*) AS n FROM workspace_imports").fetchone()["n"], 1)

    def test_first_browser_import_overrides_untouched_seed_and_preserves_demo_flags(self):
        self.sample.models[0].demo = True
        self.repo.import_legacy(self.sample, "bundled-demo-v1")
        changed = self.sample.model_copy(deep=True)
        changed.models[0].favorite = False
        result = self.repo.import_legacy(changed, "browser:old-workspace")
        self.assertFalse(result.data.models[0].favorite)
        self.assertTrue(result.data.models[0].demo)

    def test_concurrent_saves_only_one_writer_succeeds(self):
        def attempt(_):
            try:
                return self.repo.save(self.sample, 0).revision
            except RuntimeServiceError as exc:
                return exc.status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertCountEqual(list(executor.map(attempt, range(2))), [1, 409])

    def test_first_browser_snapshot_does_not_resurrect_removed_seed_records(self):
        self.repo.import_legacy(self.sample, "bundled-demo-v1")
        empty = Workspace(models=[], experiments=[], notes=[], artifacts=[])
        result = self.repo.import_legacy(empty, "browser:empty-workspace")
        self.assertEqual(result.data, empty)
        self.assertEqual(self.repo.get().data, empty)

    def test_api_rejects_invalid_references_and_handles_database_failure(self):
        service = RuntimeService(Settings.from_env(), RunRepository(self.database))
        with TestClient(create_app(service)) as client:
            snapshot = client.get("/prism/workspace").json()
            payload = {"expected_revision": snapshot["revision"], "data": self.sample.model_dump(mode="json")}
            payload["data"]["experiments"][0]["modelId"] = "missing"
            self.assertEqual(client.put("/prism/workspace", json=payload).status_code, 422)
            self.assertEqual(client.get("/prism/workspace").json()["revision"], 0)
            with patch.object(self.database, "connect", side_effect=psycopg.OperationalError("secret-password")):
                response = client.get("/prism/workspace")
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("secret", response.text)

    def test_database_constraints_reject_dangling_experiment(self):
        self.repo.save(self.sample, 0)
        with self.assertRaises(psycopg.errors.ForeignKeyViolation), self.database.connect() as connection:
            connection.execute("UPDATE experiments SET model_id='missing'")
        self.assertEqual(self.repo.get().data, self.sample)
