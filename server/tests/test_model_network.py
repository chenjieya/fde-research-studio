import ssl
import unittest
from unittest.mock import patch

import httpx
from langchain_core.messages import HumanMessage
from langchain_openai.chat_models.base import OpenAIConnectionError, OpenAITimeoutError
from mock_provider import mock_provider
from prism_server.integrations.chat_models import invoke_chat_model
from prism_server.integrations.model_network import (
    client_options,
    exception_types,
    inherits_proxy,
    model_failure_message,
)
from prism_server.schemas.models import ModelConnection


def connection(url, **kwargs):
    return ModelConnection(provider="qwen", api_model="qwen3.8-max", base_url=url, **kwargs)


class ModelNetworkTests(unittest.IsolatedAsyncioTestCase):
    def test_domestic_and_loopback_bypass_proxy_without_matching_lookalikes(self):
        for url in ("https://dashscope.aliyuncs.com/compatible-mode/v1", "https://ws-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "https://ark.cn-beijing.volces.com/api/v3", "http://127.0.0.1:19325/v1"):
            with self.subTest(url=url):
                config = connection(url)
                self.assertFalse(inherits_proxy(config))
                self.assertFalse(client_options(config)["trust_env"])
                self.assertEqual(client_options(config)["timeout"].connect, 15)
        for url in ("https://api.openai.com/v1", "https://api.krea.ai", "https://ws.cn-beijing.maas.aliyuncs.com.other.example/v1", "https://my-gateway.example/v1"):
            self.assertTrue(inherits_proxy(connection(url)))

    def test_wrapped_tls_and_timeouts_have_distinct_sanitized_messages(self):
        request = httpx.Request("POST", "https://example.com/v1/chat/completions")
        sdk = OpenAIConnectionError(message="secret-key", request=request)
        transport = httpx.ConnectError("secret-key")
        transport.__cause__ = ssl.SSLError("secret-key")
        sdk.__cause__ = transport
        config = connection("https://dashscope.aliyuncs.com/compatible-mode/v1")
        message = model_failure_message(sdk, config, "secret-key")
        self.assertIn("TLS", message)
        self.assertIn("OpenAIConnectionError", message)
        self.assertIn("SSLError", message)
        self.assertNotIn("secret-key", message)
        timeout = OpenAITimeoutError(request)
        timeout.__cause__ = httpx.ReadTimeout("secret-key")
        message = model_failure_message(timeout, config, "secret-key")
        self.assertIn("超时", message)
        self.assertIn("ReadTimeout", message)
        self.assertNotIn("secret-key", message)
        self.assertEqual(exception_types(sdk), ["OpenAIConnectionError", "ConnectError", "SSLError"])

    async def test_qwen_streams_usage_honors_thinking_mode_and_closes_http_client(self):
        client_type = httpx.AsyncClient
        clients = []
        def create_client(config):
            client = client_type(**client_options(config))
            clients.append(client)
            return client
        with mock_provider() as (url, requests), patch("prism_server.integrations.chat_models.create_model_client", side_effect=create_client):
            for mode in ("off", "on", "default"):
                response = await invoke_chat_model(connection(url + "/v1", qwen_thinking=mode), "fake-key", [HumanMessage(content="分析视频")], {})
                self.assertIn("模拟接口验证成功", response.content)
                self.assertEqual(response.usage_metadata["total_tokens"], 20)
                body = requests[-1]["body"]
                self.assertTrue(body["stream"])
                self.assertTrue(body["stream_options"]["include_usage"])
                if mode == "default":
                    self.assertNotIn("enable_thinking", body)
                else:
                    self.assertEqual(body["enable_thinking"], mode == "on")
                self.assertTrue(clients[-1].is_closed)

    async def test_http_client_is_closed_on_error_and_not_retried(self):
        client_type = httpx.AsyncClient
        clients, requests = [], []
        def handler(request):
            requests.append(request)
            return httpx.Response(401, json={"error": {"code": "InvalidApiKey", "message": "fake-key"}}, headers={"x-request-id": "request-safe-123"})
        def create_client(config):
            client = client_type(transport=httpx.MockTransport(handler), **client_options(config))
            clients.append(client)
            return client
        config = connection("https://dashscope.aliyuncs.com/compatible-mode/v1")
        with patch("prism_server.integrations.chat_models.create_model_client", side_effect=create_client), self.assertRaises(Exception) as caught:
            await invoke_chat_model(config, "fake-key", [HumanMessage(content="分析")], {})
        self.assertTrue(clients[0].is_closed)
        self.assertEqual(len(requests), 1)
        message = model_failure_message(caught.exception, config, "fake-key")
        self.assertIn("401", message)
        self.assertIn("request-safe-123", message)
        self.assertNotIn("fake-key", message)
