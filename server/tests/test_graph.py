import unittest

from prism_server.graphs.research.graph import graph


class GraphTests(unittest.TestCase):
    def test_graph_has_only_connection_node_and_returns_explicit_non_model_output(self):
        compiled = graph.get_graph().to_json()
        self.assertEqual(
            [node["id"] for node in compiled["nodes"]],
            ["__start__", "connection_check", "__end__"],
        )
        result = graph.invoke({"prompt": "  测试图执行  ", "request_id": "test-request"})
        self.assertEqual(result["echo"], "测试图执行")
        self.assertEqual(result["request_id"], "test-request")
        self.assertEqual(result["execution_mode"], "connection_check")
        self.assertIn("未调用 AI", result["message"])

    def test_empty_and_oversize_inputs_are_rejected(self):
        for prompt in [" ", "x" * 4001]:
            with self.assertRaises(ValueError):
                graph.invoke({"prompt": prompt, "request_id": "test-request"})
