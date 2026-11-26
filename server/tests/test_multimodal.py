"""真实 HTTP 适配器、媒体持久化与图输入的回归，不调用收费提供方。"""

import asyncio
import base64
from unittest.mock import AsyncMock, MagicMock, patch

from mock_provider import mock_provider
from prism_server.core.exceptions import RuntimeServiceError
from prism_server.graphs.research.graph import graph
from prism_server.integrations.multimodal import save_response_media
from prism_server.integrations.nvidia_cosmos import generate_cosmos
from prism_server.repositories.media import MediaRepository, decode_media
from prism_server.schemas.models import ConnectionRecord
from test_api import ApiFixture

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII="
)
VIDEO = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 20


class MultimodalTests(ApiFixture):
    def upload(self, content=PNG, mime="image/png", filename="素材.png"):
        response = self.client.post(
            "/prism/runtime/media",
            params={"filename": filename},
            content=content,
            headers={"Content-Type": mime},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_upload_binary_roundtrip_head_range_and_signature_validation(self):
        asset = self.upload()
        path = f"/prism/runtime/media/{asset['id']}"
        response = self.client.get(path)
        self.assertEqual(response.content, PNG)
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(self.client.head(path).headers["content-length"], str(len(PNG)))
        self.assertEqual(self.client.head(path).content, b"")
        partial = self.client.get(path, headers={"Range": "bytes=1-4"})
        self.assertEqual(partial.status_code, 206)
        self.assertEqual(partial.content, PNG[1:5])
        self.assertEqual(self.client.get(path, headers={"Range": "bytes=-4"}).content, PNG[-4:])
        for value in ("bytes=999999-", "bytes=3-2", "bytes=-0", "bytes=0-1,4-5"):
            self.assertEqual(self.client.get(path, headers={"Range": value}).status_code, 416)
        for content, mime in ((b"not-a-file", "image/png"), (PNG, "video/mp4")):
            self.assertEqual(
                self.client.post(
                    "/prism/runtime/media?filename=test",
                    content=content,
                    headers={"Content-Type": mime},
                ).status_code,
                422,
            )
        self.assertEqual(
            self.client.post(
                "/prism/runtime/media?filename=test",
                content=b"<svg/>",
                headers={"Content-Type": "image/svg+xml"},
            ).status_code,
            415,
        )

    def test_attachment_reference_and_history_survive_api_roundtrip(self):
        asset = self.upload()
        created = self.client.post(
            "/prism/runtime/runs", json={**self.run_payload, "attachment_ids": [asset["id"]]}
        ).json()
        self.assertEqual(created["input_media"], [asset])
        self.assertEqual(
            self.sdk.runs.create.call_args.kwargs["input"]["attachment_ids"], [asset["id"]]
        )
        self.assertNotIn(base64.b64encode(PNG).decode(), str(self.sdk.runs.create.call_args))
        self.client.get(f"/prism/runtime/runs/{created['id']}")
        self.client.post("/prism/runtime/runs", json=self.run_payload)
        history = self.sdk.runs.create.call_args.kwargs["input"]["history"]
        self.assertEqual(history[0]["attachment_ids"], [asset["id"]])
        restored = self.client.get(
            f"/prism/runtime/conversations/{self.conversation_id}/runs"
        ).json()
        self.assertEqual(restored[0]["input_media"], [asset])

    def test_unsupported_attachment_and_forged_reference_rejected_before_sdk(self):
        video = self.upload(VIDEO, "video/mp4", "clip.mp4")
        response = self.client.post(
            "/prism/runtime/runs", json={**self.run_payload, "attachment_ids": [video["id"]]}
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            self.client.post(
                "/prism/runtime/runs",
                json={
                    **self.run_payload,
                    "attachment_ids": ["00000000-0000-0000-0000-000000000000"],
                },
            ).status_code,
            404,
        )
        self.sdk.runs.create.assert_not_awaited()
        result = self.client.put(
            "/prism/runtime/models/model-a",
            json={
                **self.connection_payload,
                "provider": "anthropic",
                "input_modalities": ["video"],
                "expected_revision": 1,
            },
        )
        self.assertEqual(result.status_code, 422)
        self.assertNotIn("test-secret", result.text)

    def graph_run(self, config, key, attachment_ids, history=None, mode=None):
        with (
            patch(
                "prism_server.graphs.research.nodes.model.connection_repository",
                return_value=self.service.models,
            ),
            patch.object(self.service.models, "resolve", return_value=(config, key)),
        ):
            return asyncio.run(
                graph.ainvoke(
                    {
                        "prompt": "分析或生成",
                        "attachment_ids": attachment_ids,
                        "history": history or [],
                        "generation_mode": mode,
                    },
                    context={"model_id": "model-a"},
                )
            )

    def test_both_chat_adapters_receive_real_image_content_and_prior_media(self):
        asset = self.upload()
        with mock_provider() as (url, requests):
            for provider in ("openai", "qwen", "anthropic"):
                config = ConnectionRecord(
                    model_id="model-a",
                    name="视觉模型",
                    provider=provider,
                    api_model="test-chat",
                    base_url=url + ("/v1" if provider != "anthropic" else ""),
                    revision=1,
                    api_key_configured=True,
                )
                output = self.graph_run(
                    config,
                    "fake-key",
                    [asset["id"]],
                    [
                        {"role": "user", "content": "上一张图", "attachment_ids": [asset["id"]]},
                        {"role": "assistant", "content": "已看到"},
                    ],
                )
                self.assertEqual(output["execution_mode"], "model")
                current = requests[-1]["body"]["messages"][-1]["content"]
                self.assertEqual(current[0]["type"], "text")
                image = current[1]
                data = (
                    image["image_url"]["url"].split(",", 1)[1]
                    if provider != "anthropic"
                    else image["source"]["data"]
                )
                self.assertEqual(base64.b64decode(data), PNG)
                self.assertEqual(output["media"], [])

    def test_openai_compatible_video_is_sent_as_video_not_filename(self):
        asset = self.upload(VIDEO, "video/mp4", "clip.mp4")
        with mock_provider() as (url, requests):
            config = ConnectionRecord(
                model_id="model-a",
                name="视频理解",
                provider="qwen",
                api_model="test-chat",
                base_url=url + "/v1",
                revision=1,
                api_key_configured=True,
                input_modalities=["image", "video"],
            )
            self.graph_run(config, "fake-key", [asset["id"]])
            video = requests[-1]["body"]["messages"][-1]["content"][1]
            self.assertEqual(video["type"], "video_url")
            self.assertEqual(base64.b64decode(video["video_url"]["url"].split(",", 1)[1]), VIDEO)

    def test_cosmos_all_four_modes_use_native_endpoint_and_persist_media(self):
        image, video = self.upload(), self.upload(VIDEO, "video/mp4", "clip.mp4")
        with mock_provider() as (url, requests):
            config = ConnectionRecord(
                model_id="model-a",
                name="Cosmos",
                provider="nvidia_cosmos",
                api_model="nvidia/cosmos3-nano",
                base_url=url + "/v1/cosmos/nvidia/cosmos3-nano",
                revision=1,
                api_key_configured=True,
            )
            for mode, ids, kind in (
                ("text2image", [], "image"),
                ("text2video", [], "video"),
                ("image2video", [image["id"]], "video"),
                ("video2video", [video["id"]], "video"),
            ):
                output = self.graph_run(config, "nvidia-fake-key", ids, mode=mode)
                body = requests[-1]["body"]
                self.assertEqual(body["model_mode"], mode)
                self.assertNotIn("messages", body)
                self.assertNotIn("nvidia-fake-key", str(output))
                result_asset = output["media"][0].model_dump()
                self.assertEqual(result_asset["kind"], kind)
                saved = self.client.get("/prism/runtime/media/" + result_asset["id"])
                self.assertEqual(saved.status_code, 200)
                self.assertEqual(saved.content, PNG if kind == "image" else VIDEO)
                if ids:
                    self.assertTrue(body["input_reference"].startswith("data:"))
                if mode == "text2image":
                    self.assertEqual(body["num_frames"], 1)

    def test_native_failures_do_not_expose_credentials_or_provider_body(self):
        config = ConnectionRecord(
            model_id="model-a",
            name="Cosmos",
            provider="nvidia_cosmos",
            api_model="nvidia/cosmos3-nano",
            base_url="https://example.test/infer",
            revision=1,
            api_key_configured=True,
        )
        response = MagicMock(is_success=False, status_code=401)
        context = MagicMock(
            __aenter__=AsyncMock(return_value=response), __aexit__=AsyncMock(return_value=False)
        )
        with patch(
            "prism_server.integrations.nvidia_cosmos.httpx.AsyncClient.stream", return_value=context
        ):
            with self.assertRaisesRegex(RuntimeServiceError, "认证失败") as caught:
                asyncio.run(
                    generate_cosmos(
                        config, "secret-key", "test", "text2video", [], self.service.media
                    )
                )
            self.assertNotIn("secret-key", str(caught.exception.detail))

    def test_embedded_model_image_output_is_saved_without_returning_base64(self):
        uri = "data:image/png;base64," + base64.b64encode(PNG).decode()
        text, assets = save_response_media(
            [{"type": "text", "text": "结果"}, {"type": "image_url", "image_url": {"url": uri}}],
            MediaRepository(self.database),
        )
        self.assertEqual(text, "结果")
        self.assertEqual(len(assets), 1)
        self.assertNotIn(uri, str(assets))
        with self.assertRaises(RuntimeServiceError):
            decode_media("not-valid-base64")
