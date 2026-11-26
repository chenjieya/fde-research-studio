"""官方协议契约、任务防重、临时结果下载与错误脱敏回归。"""

import base64
import json
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

import httpx
from prism_server.core.exceptions import RuntimeServiceError
from prism_server.integrations.generation.http import download_media, public_addresses
from prism_server.integrations.generation.service import generate
from prism_server.integrations.multimodal import validate_media
from prism_server.schemas.media import MediaAsset
from prism_server.schemas.models import ConnectionRecord, ModelConnection

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=")
VIDEO = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 20


class FakeMedia:
    def __init__(self):
        self.database = object()
        self.saved = []

    def get(self, media_id, *, content=False):
        return MediaAsset(id=media_id, kind="image", mime_type="image/png", filename="参考图.png", size=len(PNG), url=f"/api/runtime/media/{media_id}"), PNG if content else b""

    def data_uri(self, media_id):
        asset, content = self.get(media_id, content=True)
        return asset, "data:image/png;base64," + base64.b64encode(content).decode()

    def save(self, content, filename, *, generated=False):
        self.saved.append(content)
        media_id = str(uuid4())
        video = content == VIDEO
        return MediaAsset(id=media_id, kind="video" if video else "image", mime_type="video/mp4" if video else "image/png", filename="result.mp4" if video else "result.png", size=len(content), url=f"/api/runtime/media/{media_id}")


def connection(provider, **kwargs):
    defaults = {
        "qwen_image": "qwen-image-2.0-pro", "moss_image": "moss-image-sft-1.0",
        "openai_image": "gpt-image-1.5", "minimax_image": "MiniMax-H3-Image",
        "seedance": "doubao-seedance-2-0-260128", "wan": "wan3.0-video-prime", "krea": "krea-2/medium",
    }
    return ConnectionRecord(provider=provider, api_model=defaults[provider], base_url="https://provider.example/v1" if provider in {"openai_image", "minimax_image", "moss_image"} else "https://provider.example", model_id="model-a", name="测试模型", revision=1, api_key_configured=True, **kwargs)


class GenerationTests(unittest.IsolatedAsyncioTestCase):
    def transport(self, handler):
        client_type = httpx.AsyncClient
        return patch("httpx.AsyncClient", side_effect=lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs))

    async def test_four_official_image_protocols_and_safe_download(self):
        for provider in ("openai_image", "qwen_image", "moss_image", "minimax_image"):
            with self.subTest(provider=provider):
                requests = []
                media = FakeMedia()
                def handler(request, provider=provider, requests=requests):
                    requests.append(request)
                    if request.method == "GET":
                        self.assertNotIn("authorization", request.headers)
                        self.assertNotIn("cookie", request.headers)
                        self.assertEqual(request.headers["host"], "cdn.example")
                        self.assertEqual(request.url.host, "93.184.216.34")
                        self.assertEqual(request.extensions["sni_hostname"], "cdn.example")
                        return httpx.Response(200, content=PNG)
                    payload = json.loads(request.content)
                    self.assertEqual(request.headers["authorization"], "Bearer test-secret")
                    self.assertNotIn("num_frames", payload)
                    self.assertNotIn("max_tokens", payload)
                    self.assertNotIn("temperature", payload)
                    if provider == "qwen_image":
                        self.assertEqual(request.url.path, "/api/v1/services/aigc/multimodal-generation/generation")
                        self.assertEqual(payload["input"]["messages"][0]["content"], [{"text": "画一只猫"}])
                        self.assertEqual(payload["parameters"]["size"], "1024*1024")
                        return httpx.Response(200, json={"output": {"choices": [{"message": {"content": [{"image": "https://cdn.example/result.png?signature=private"}]}}]}, "usage": {"image_count": 1}})
                    self.assertEqual(request.url.path, "/v1/images/generations")
                    if provider == "moss_image":
                        self.assertEqual(payload["response_format"], "url")
                        return httpx.Response(200, json={"data": [{"url": "https://cdn.example/result.png?signature=private"}]})
                    if provider == "openai_image":
                        self.assertNotIn("response_format", payload)
                        self.assertEqual(payload["quality"], "auto")
                    return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}], "usage": {"total_tokens": 4}})
                with self.transport(handler), patch("prism_server.integrations.generation.http.public_addresses", return_value=["93.184.216.34"]):
                    result = await generate(connection(provider), "test-secret", "画一只猫", "text2image", [], media, str(uuid4()))
                self.assertEqual(media.saved, [PNG])
                self.assertEqual(result.media[0].kind, "image")
                self.assertNotIn("signature", result.model_dump_json())
                self.assertEqual(sum(request.method == "POST" for request in requests), 1)

    async def test_reference_images_use_native_edit_contract(self):
        for provider in ("openai_image", "qwen_image", "minimax_image"):
            with self.subTest(provider=provider):
                media = FakeMedia()
                assets = [media.get(str(uuid4()))[0], media.get(str(uuid4()))[0]]
                def handler(request, provider=provider):
                    if provider == "openai_image":
                        self.assertEqual(request.url.path, "/v1/images/edits")
                        self.assertIn("multipart/form-data", request.headers["content-type"])
                        self.assertEqual(request.content.count(b'name="image[]"'), 2)
                        self.assertIn(PNG, request.content)
                    else:
                        payload = json.loads(request.content)
                        if provider == "minimax_image":
                            self.assertEqual(request.url.path, "/v1/images/edits")
                            self.assertEqual(len(payload["images"]), 2)
                            self.assertTrue(payload["images"][0]["image_url"].startswith("data:image/png;base64,"))
                        else:
                            content = payload["input"]["messages"][0]["content"]
                            self.assertEqual(len(content), 3)
                            self.assertEqual(content[-1], {"text": "换成蓝色"})
                            self.assertTrue(content[0]["image"].startswith("data:image/png;base64,"))
                            return httpx.Response(200, json={"output": {"choices": [{"message": {"content": [{"image": "data:image/png;base64," + base64.b64encode(PNG).decode()}]}}]}})
                    return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
                with self.transport(handler):
                    result = await generate(connection(provider), "test-secret", "换成蓝色", "image2image", assets, media, str(uuid4()))
                self.assertEqual(result.media[0].kind, "image")

    async def test_async_video_and_krea_submit_once_then_resume_saved_job(self):
        for provider in ("seedance", "wan", "krea"):
            with self.subTest(provider=provider):
                media = FakeMedia()
                assets = [media.get(str(uuid4()))[0]]
                task_id = "job-test-123"
                jobs = MagicMock()
                jobs.claim.side_effect = [None, task_id]
                posts, polls = [], []
                def handler(request, provider=provider, posts=posts, polls=polls, task_id=task_id):
                    if request.method == "POST":
                        payload = json.loads(request.content)
                        posts.append(payload)
                        self.assertNotIn("max_tokens", payload)
                        self.assertNotIn("num_inference_steps", payload)
                        if provider == "seedance":
                            self.assertEqual(request.url.path, "/contents/generations/tasks")
                            self.assertEqual(payload["content"][1]["role"], "first_frame")
                            self.assertTrue(payload["content"][1]["image_url"]["url"].startswith("data:image/png;base64,"))
                            self.assertEqual(payload["duration"], 5)
                            return httpx.Response(200, json={"id": task_id})
                        if provider == "wan":
                            self.assertEqual(request.headers["x-dashscope-async"], "enable")
                            self.assertEqual(request.url.path, "/api/v1/services/aigc/video-generation/video-synthesis")
                            self.assertEqual(payload["parameters"]["resolution"], "720P")
                            self.assertEqual(payload["input"]["media"][0]["type"], "first_frame")
                            return httpx.Response(200, json={"output": {"task_id": task_id, "task_status": "PENDING"}})
                        self.assertEqual(request.url.path, "/generate/image/krea/krea-2/medium")
                        self.assertEqual(payload["resolution"], "1K")
                        self.assertTrue(payload["image_url"].startswith("data:image/png;base64,"))
                        return httpx.Response(200, json={"job_id": task_id, "status": "queued"})
                    polls.append(str(request.url))
                    value = "data:" + ("image/png" if provider == "krea" else "video/mp4") + ";base64," + base64.b64encode(PNG if provider == "krea" else VIDEO).decode()
                    if provider == "wan":
                        self.assertTrue(request.url.path.endswith("/api/v1/tasks/" + task_id))
                        return httpx.Response(200, json={"output": {"task_status": "SUCCEEDED", "video_url": value}})
                    if provider == "seedance":
                        return httpx.Response(200, json={"status": "succeeded", "content": {"video_url": value}})
                    return httpx.Response(200, json={"status": "completed", "result": {"urls": [value]}})
                with self.transport(handler), patch("prism_server.integrations.generation.tasks.GenerationJobRepository", return_value=jobs):
                    for _ in range(2):
                        result = await generate(connection(provider), "test-secret", "生成测试", "image2image" if provider == "krea" else "image2video", assets, media, "same-request")
                        self.assertEqual(result.provider_task_id, task_id)
                self.assertEqual(len(posts), 1)
                self.assertEqual(len(polls), 2)
                jobs.submitted.assert_called_once_with("same-request", task_id)

    async def test_upstream_error_has_code_but_no_body_or_credentials(self):
        def handler(request):
            return httpx.Response(400, json={"error": {"code": "InvalidParameter", "message": "Authorization Bearer secret-value https://private?key=secret-value"}, "request_id": "request-123"})
        with self.transport(handler), self.assertRaises(RuntimeServiceError) as error:
            await generate(connection("openai_image"), "secret-value", "测试", "text2image", [], FakeMedia(), str(uuid4()))
        message = str(error.exception.detail)
        self.assertIn("InvalidParameter", message)
        self.assertIn("request-123", message)
        self.assertNotIn("secret-value", message)
        self.assertNotIn("https://", message)

    async def test_pending_task_is_polled_until_success_and_timeout_keeps_id(self):
        for timed_out in (False, True):
            with self.subTest(timed_out=timed_out):
                counts = {"post": 0, "get": 0}
                jobs = MagicMock()
                jobs.claim.return_value = None
                def handler(request, counts=counts):
                    if request.method == "POST":
                        counts["post"] += 1
                        return httpx.Response(200, json={"output": {"task_id": "task-polling"}})
                    counts["get"] += 1
                    if counts["get"] < 3:
                        return httpx.Response(200, json={"output": {"task_status": "PENDING" if counts["get"] == 1 else "RUNNING"}})
                    return httpx.Response(200, json={"output": {"task_status": "SUCCEEDED", "video_url": "data:video/mp4;base64," + base64.b64encode(VIDEO).decode()}})
                with self.transport(handler), patch("prism_server.integrations.generation.tasks.GenerationJobRepository", return_value=jobs), patch("prism_server.integrations.generation.tasks.POLL_INTERVAL_SECONDS", 0):
                    if timed_out:
                        with patch("prism_server.integrations.generation.tasks.monotonic", side_effect=[0, 1, 2, 6]), self.assertRaisesRegex(RuntimeServiceError, "task-polling"):
                            await generate(connection("wan", timeout_seconds=5), "fake-key", "测试", "text2video", [], FakeMedia(), "request-poll")
                    else:
                        result = await generate(connection("wan"), "fake-key", "测试", "text2video", [], FakeMedia(), "request-poll")
                        self.assertEqual(result.provider_task_id, "task-polling")
                        self.assertEqual(counts["get"], 3)
                self.assertEqual(counts["post"], 1)

    async def test_timeout_does_not_retry_paid_submission(self):
        requests = []
        def handler(request):
            requests.append(request)
            raise httpx.ReadTimeout("secret-value")
        jobs = MagicMock()
        jobs.claim.return_value = None
        with self.transport(handler), patch("prism_server.integrations.generation.tasks.GenerationJobRepository", return_value=jobs), self.assertRaises(RuntimeServiceError) as error:
            await generate(connection("wan"), "secret-value", "测试", "text2video", [], FakeMedia(), "request-one")
        self.assertEqual(len(requests), 1)
        self.assertNotIn("secret-value", str(error.exception))

    async def test_download_blocks_private_destinations_and_redirects(self):
        for ip in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1"):
            with patch("socket.getaddrinfo", return_value=[(None, None, None, None, (ip, 443))]), self.assertRaises(RuntimeServiceError):
                public_addresses("example.com", 443)
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(302, headers={"location": "http://127.0.0.1/secret"})
        with self.transport(handler), patch("prism_server.integrations.generation.http.public_addresses", return_value=["93.184.216.34"]), self.assertRaises(RuntimeServiceError):
            await download_media("https://cdn.example/a", 10)
        self.assertEqual(len(calls), 1)

    def test_known_official_connections_migrate_without_losing_workspace(self):
        config = ModelConnection(provider="openai", api_model="wan3.0-video-prime", base_url="https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(config.provider, "wan")
        self.assertTrue(config.is_generation)
        self.assertEqual(config.base_url, "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")
        from prism_server.integrations.generation.images import alibaba_base
        self.assertEqual(alibaba_base(config.base_url), "https://workspace.cn-beijing.maas.aliyuncs.com")
        qwen = ModelConnection(provider="qwen", api_model="qwen3-vl-plus", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1", input_modalities=["image", "video"])
        self.assertFalse(qwen.is_generation)
        self.assertEqual(qwen.task_modes, [])

    def test_media_limits_are_per_task_and_provider(self):
        media = FakeMedia()
        asset = media.get(str(uuid4()))[0]
        for provider, mode, assets in (("moss_image", "image2image", [asset]), ("krea", "image2image", [asset, asset]), ("qwen_image", "image2image", [asset] * 4), ("wan", "text2video", [asset]), ("seedance", "video2video", [asset])):
            with self.subTest(provider=provider), self.assertRaises(RuntimeServiceError):
                validate_media(connection(provider), assets, mode)


if __name__ == "__main__":
    unittest.main()
