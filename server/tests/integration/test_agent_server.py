"""真实 Agent Server 测试；显式指定本目录运行，不进入默认的单元测试发现范围。"""

import os
import unittest
from uuid import uuid4

import httpx
from langgraph_sdk import get_client


class AgentServerIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_compiled_graph_and_real_sdk_execution(self):
        url = os.getenv("PRISM_AGENT_API_URL", "http://127.0.0.1:2024")
        graph_id = os.getenv("PRISM_GRAPH_ID", "prism_research")
        async with get_client(url=url, api_key=None, timeout=httpx.Timeout(30)) as client:
            compiled = await client.assistants.get_graph(graph_id)
            self.assertTrue(any(node["id"] == "connection_check" for node in compiled["nodes"]))
            thread = await client.threads.create(metadata={"purpose": "prism-sdk-integration"})
            result = await client.runs.wait(
                thread["thread_id"], graph_id,
                input={"prompt": "Prism SDK 联通验证", "request_id": str(uuid4())},
            )
        self.assertIsInstance(result, dict)
        self.assertEqual(result["execution_mode"], "connection_check")
        self.assertEqual(result["echo"], "Prism SDK 联通验证")
