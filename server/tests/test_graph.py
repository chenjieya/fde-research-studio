import asyncio
import unittest
from unittest.mock import MagicMock, patch

from mock_provider import mock_provider
from prism_server.graphs.research.context import ResearchContext
from prism_server.graphs.research.graph import graph
from prism_server.schemas.models import ConnectionRecord


class GraphTests(unittest.TestCase):
    def invoke(self, provider, base_url, **changes):
        config = ConnectionRecord(
            model_id="model-test",
            name="测试模型",
            provider=provider,
            api_model="test-chat",
            base_url=base_url + ("/v1" if provider == "openai" else ""),
            revision=1,
            api_key_configured=True,
            **changes,
        )
        repo = MagicMock()
        repo.resolve.return_value = (config, "fake-test-key")
        with patch(
            "prism_server.graphs.research.nodes.model.connection_repository", return_value=repo
        ):
            return asyncio.run(
                graph.ainvoke(
                    {
                        "prompt": "继续比较",
                        "request_id": "test-request",
                        "history": [
                            {"role": "user", "content": "第一问"},
                            {"role": "assistant", "content": "第一答"},
                        ],
                    },
                    context=ResearchContext(
                        model_id=config.model_id, model_revision=1, system_prompt="测试系统提示词"
                    ),
                )
            )

    def test_both_real_adapters_send_system_history_and_current_message(self):
        self.assertEqual(
            [n["id"] for n in graph.get_graph().to_json()["nodes"]],
            ["__start__", "model", "__end__"],
        )
        with mock_provider() as (url, requests):
            for provider in ("openai", "anthropic"):
                with self.subTest(provider=provider):
                    result = self.invoke(provider, url)
                    self.assertEqual(result["execution_mode"], "model")
                    self.assertEqual(result["usage"]["total_tokens"], 20)
                    self.assertGreater(result["latency_seconds"], 0)
                    self.assertEqual(result["request_id"], "test-request")
                    self.assertNotIn("fake-test-key", str(result))
                    body = requests[-1]["body"]
                    messages = body["messages"]
                    self.assertEqual(messages[-1]["content"], "继续比较")
                    self.assertEqual(messages[-2]["role"], "assistant")
                    system = messages[0]["content"] if provider == "openai" else body["system"]
                    self.assertIn("测试系统提示词", str(system))

    def test_provider_error_is_sanitized(self):
        with mock_provider() as (url, _):
            config = ConnectionRecord(
                model_id="test",
                name="测试",
                provider="openai",
                api_model="reject",
                base_url=url + "/v1",
                revision=1,
                api_key_configured=True,
            )
            repo = MagicMock()
            repo.resolve.return_value = (config, "fake-key")
            with (
                patch(
                    "prism_server.graphs.research.nodes.model.connection_repository",
                    return_value=repo,
                ),
                self.assertRaisesRegex(RuntimeError, "认证失败"),
            ):
                asyncio.run(
                    graph.ainvoke(
                        {"prompt": "测试", "request_id": "test"}, context=ResearchContext("test", 1)
                    )
                )

    def test_tools_are_rejected_until_registered(self):
        with self.assertRaisesRegex(ValueError, "尚未接入工具"):
            asyncio.run(
                graph.ainvoke(
                    {"prompt": "测试", "request_id": "test"},
                    context=ResearchContext("test", 1, tools=["unknown"]),
                )
            )

    def test_studio_direct_inputs_are_validated_before_any_provider_request(self):
        for prompt in (" ", "x" * 20001):
            with self.assertRaises(ValueError):
                asyncio.run(
                    graph.ainvoke(
                        {"prompt": prompt, "request_id": "test"}, context=ResearchContext("test", 1)
                    )
                )
