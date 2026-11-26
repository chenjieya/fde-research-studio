import asyncio
from unittest.mock import patch
from uuid import uuid4

import httpx
from prism_server.core.exceptions import RuntimeServiceError
from prism_server.graphs.research.graph import graph
from prism_server.repositories.generation_jobs import GenerationJobRepository
from test_api import ApiFixture


class GenerationApiTests(ApiFixture):
    def test_provider_catalog_and_persisted_task_reservation(self):
        response = self.client.get("/prism/runtime/providers")
        self.assertEqual(response.status_code, 200)
        providers = {item["id"]: item for item in response.json()}
        self.assertEqual(providers["qwen"]["modes"], [])
        self.assertEqual(providers["moss_image"]["modes"], ["text2image"])
        self.assertEqual(providers["seedance"]["modes"], ["text2video", "image2video"])
        saved = self.client.put("/prism/runtime/models/model-a", json={"provider": "seedance", "api_model": "doubao-seedance-2-0-260128", "base_url": "https://ark.cn-beijing.volces.com/api/v3", "api_key": "new-fake-key", "expected_revision": 1})
        self.assertEqual(saved.status_code, 200, saved.text)
        config, _ = self.service.models.resolve("model-a")
        jobs = GenerationJobRepository(self.database)
        request_id = str(uuid4())
        self.assertIsNone(jobs.claim(request_id, config))
        with self.assertRaises(RuntimeServiceError):
            jobs.claim(request_id, config)
        jobs.submitted(request_id, "cgt-fake")
        self.assertEqual(jobs.claim(request_id, config), "cgt-fake")
        with self.assertRaises(RuntimeServiceError):
            jobs.claim(request_id, config.model_copy(update={"revision": 3}))

    def test_switching_vendor_does_not_send_previous_vendors_key(self):
        response = self.client.put("/prism/runtime/models/model-a", json={"provider": "minimax_image", "api_model": "MiniMax-H3-Image", "base_url": "https://api.minimax.cn/v1", "expected_revision": 1})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("test-secret", response.text)
        self.assertEqual(self.service.models.resolve("model-a")[0].provider, "openai")

    def test_safe_provider_error_reaches_run_record_instead_of_generic_studio_error(self):
        configured = self.client.put("/prism/runtime/models/model-a", json={"provider": "openai_image", "api_model": "gpt-image-1.5", "base_url": "https://api.openai.com/v1", "expected_revision": 1})
        self.assertEqual(configured.status_code, 200, configured.text)
        created = self.client.post("/prism/runtime/runs", json={**self.run_payload, "generation_mode": "text2image"}).json()
        client_type = httpx.AsyncClient
        def handler(request):
            return httpx.Response(400, json={"error": {"code": "InvalidParameter", "message": "test-secret"}, "request_id": "request-456"})
        with patch("prism_server.graphs.research.nodes.model.connection_repository", return_value=self.service.models), patch("httpx.AsyncClient", side_effect=lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs)), self.assertRaisesRegex(RuntimeError, "InvalidParameter"):
            asyncio.run(graph.ainvoke({"prompt": "测试图片", "request_id": created["id"], "generation_mode": "text2image"}, context={"model_id": "model-a"}))
        self.sdk.runs.get.return_value = {"status": "error"}
        finished = self.client.get("/prism/runtime/runs/" + created["id"]).json()
        self.assertIn("InvalidParameter", finished["error"])
        self.assertIn("request-456", finished["error"])
        self.assertNotIn("test-secret", str(finished))
