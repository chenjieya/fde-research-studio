"""显式执行的端到端验收；使用真实 Agent Server、SDK、适配器和隔离 PostgreSQL。"""

import asyncio
import os
import time
import unittest

import httpx
from langgraph_sdk import get_client
from runtime_fixture import agent_fixture


@unittest.skipUnless(os.getenv("PRISM_TEST_DATABASE_URL"), "需显式设置 PRISM_TEST_DATABASE_URL")
class AgentServerIntegrationTests(unittest.TestCase):
    def test_model_switch_history_failure_and_confirmed_experiment(self):
        with (
            agent_fixture() as (url, provider_url, requests, _, _),
            httpx.Client(base_url=url, timeout=30) as client,
        ):
            for model_id, provider in (("model-a", "openai"), ("model-b", "anthropic")):
                response = client.put(
                    f"/prism/runtime/models/{model_id}",
                    json={
                        "provider": provider,
                        "api_model": "test-chat",
                        "base_url": provider_url + ("/v1" if provider == "openai" else ""),
                        "api_key": "integration-fake-key",
                        "system_prompt": "集成测试系统提示词",
                    },
                )
                self.assertEqual(response.status_code, 200, response.text)
            session = client.post("/prism/runtime/conversations").json()["id"]

            def send(model_id, prompt):
                response = client.post(
                    "/prism/runtime/runs",
                    json={"model_id": model_id, "conversation_id": session, "prompt": prompt},
                )
                self.assertEqual(response.status_code, 201, response.text)
                run = response.json()
                for _ in range(60):
                    response = client.get(f"/prism/runtime/runs/{run['id']}")
                    self.assertEqual(response.status_code, 200, response.text)
                    run = response.json()
                    if run["status"] not in {"pending", "running"}:
                        return run
                    time.sleep(0.2)
                self.fail("模型运行未按时结束")

            first = send("model-a", "第一轮问题")
            self.assertEqual(first["status"], "success", first)
            second = send("model-b", "切换模型后继续")
            self.assertEqual(second["status"], "success", second)
            self.assertEqual(requests[0]["path"], "/v1/chat/completions")
            self.assertEqual(requests[1]["path"], "/v1/messages")
            self.assertEqual(len(requests[1]["body"]["messages"]), 3)
            self.assertEqual(requests[1]["body"]["messages"][1]["role"], "assistant")
            self.assertEqual(client.get("/prism/workspace").json()["revision"], 1)
            experiment = {
                "id": "ignored",
                "title": "人工确认的结果",
                "modelId": "ignored",
                "task": "识别理解",
                "dataset": "单轮对话",
                "sampleSize": 1,
                "successCount": 1,
                "latency": second["output"]["latency_seconds"],
                "cost": None,
                "conclusion": "接口协议和上下文通过",
                "limitations": "本地模拟接口，未评价外部真实模型质量",
                "date": "2026-11-24",
                "demo": False,
            }
            confirmed = client.post(
                f"/prism/runtime/runs/{second['id']}/experiment", json=experiment
            )
            self.assertEqual(confirmed.status_code, 201, confirmed.text)
            self.assertEqual(confirmed.json()["modelId"], "model-b")
            source = client.get(
                f"/prism/runtime/experiments/{confirmed.json()['id']}/source"
            ).json()
            self.assertEqual(source["output"], second["output"])

            async def check_sdk():
                async with get_client(url=url, api_key=None) as sdk:
                    compiled = await sdk.assistants.get_graph("prism_research")
                    self.assertIn("model", [node["id"] for node in compiled["nodes"]])
                    state = await sdk.threads.get_state(second["thread_id"])
                    self.assertNotIn("integration-fake-key", str(state))
                    assistants = await sdk.assistants.search(graph_id="prism_research")
                    schemas = await sdk.assistants.get_schemas(assistants[0]["assistant_id"])
                    self.assertIn("prompt", schemas["input_schema"]["properties"])
                    self.assertFalse(schemas["context_schema"].get("required"))
                    studio_thread = await sdk.threads.create()
                    studio_result = await sdk.runs.wait(
                        studio_thread["thread_id"],
                        "prism_research",
                        input={"prompt": "Studio 只选择模型 ID，不填写内部配置版本"},
                        context={"model_id": "model-a"},
                    )
                    self.assertEqual(studio_result["execution_mode"], "model")
                    self.assertTrue(studio_result["request_id"])

            asyncio.run(check_sdk())
            changed = client.put(
                "/prism/runtime/models/model-a",
                json={
                    "provider": "openai",
                    "api_model": "reject",
                    "base_url": provider_url + "/v1",
                    "expected_revision": 1,
                },
            )
            self.assertEqual(changed.status_code, 200)
            failed = send("model-a", "验证认证失败")
            self.assertEqual(failed["status"], "error")
            self.assertNotIn("private-provider-error", str(failed))
            self.assertNotIn("integration-fake-key", client.get("/prism/runtime/models").text)
            self.assertNotIn("integration-fake-key", client.get("/prism/workspace").text)
            # Studio 留空 Context：只有一个启用模型时可直接运行，不要求用户填写内部编号。
            restored = client.put(
                "/prism/runtime/models/model-a",
                json={
                    "provider": "openai",
                    "api_model": "test-chat",
                    "base_url": provider_url + "/v1",
                    "expected_revision": 2,
                },
            )
            self.assertEqual(restored.status_code, 200)
            disabled = client.put(
                "/prism/runtime/models/model-b",
                json={
                    "provider": "anthropic",
                    "api_model": "test-chat",
                    "base_url": provider_url,
                    "enabled": False,
                    "expected_revision": 1,
                },
            )
            self.assertEqual(disabled.status_code, 200)

            async def studio_defaults():
                async with get_client(url=url, api_key=None) as sdk:
                    for context in (None, {}):
                        thread = await sdk.threads.create()
                        result = await sdk.runs.wait(
                            thread["thread_id"],
                            "prism_research",
                            input={"prompt": "Studio 默认上下文验证"},
                            context=context,
                        )
                        self.assertEqual(result["execution_mode"], "model")

            asyncio.run(studio_defaults())
