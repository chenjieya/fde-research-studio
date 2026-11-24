"""验证 Studio 的跨域请求能通过，同时继续限制允许的网页来源。"""

import json
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]


class StudioCorsTests(unittest.TestCase):
    def setUp(self):
        self.cors = json.loads((ROOT / "langgraph.json").read_text(encoding="utf-8"))["http"]["cors"]
        self.client = TestClient(CORSMiddleware(FastAPI(), **self.cors))
        self.addCleanup(self.client.close)

    def preflight(self, *, origin="https://smith.langchain.com", method="POST"):
        return self.client.options("/assistants/search", headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "content-type,x-api-key,x-auth-scheme,x-langgraph-api-variant,baggage,sentry-trace",
        })

    def test_studio_auth_and_trace_headers_pass_preflight(self):
        response = self.preflight()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "https://smith.langchain.com")
        self.assertIn("x-auth-scheme", response.headers["access-control-allow-headers"])
        self.assertEqual(response.headers["access-control-allow-credentials"], "true")

    def test_agent_api_patch_delete_and_get_are_allowed(self):
        for method in ("GET", "PATCH", "DELETE"):
            with self.subTest(method=method):
                self.assertEqual(self.preflight(method=method).status_code, 200)

    def test_unknown_origin_is_still_rejected(self):
        response = self.preflight(origin="https://untrusted.example")
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_production_cors_matches_local_configuration(self):
        line = next(line for line in (ROOT / "deploy/Agent.Dockerfile").read_text(encoding="utf-8").splitlines() if line.startswith("ENV LANGGRAPH_HTTP="))
        production = json.loads(line.removeprefix("ENV LANGGRAPH_HTTP=").strip("'"))
        self.assertEqual(production["cors"], self.cors)
