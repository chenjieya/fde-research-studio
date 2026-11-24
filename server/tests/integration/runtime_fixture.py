"""真实 Agent Server 验收夹具：隔离 schema、临时配置、无持久化进程，退出后清理。"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack, contextmanager
from pathlib import Path
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet
from prism_server.db.postgres import PostgresDatabase
from prism_server.repositories.workspaces import WorkspaceRepository
from psycopg import sql

TESTS = Path(__file__).resolve().parents[1]
ROOT = TESTS.parents[1]
sys.path.insert(0, str(TESTS))
from mock_provider import mock_provider  # noqa: E402
from test_workspace import sample_workspace  # noqa: E402


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


@contextmanager
def agent_fixture(*, tracing: bool = False):
    url = os.environ["PRISM_TEST_DATABASE_URL"]
    database = PostgresDatabase(url, schema="test_" + uuid4().hex)
    database.initialize()
    workspace = sample_workspace()
    second = workspace.models[0].model_copy(update={"id": "model-b", "name": "Anthropic 测试模型"})
    workspace.models.append(second)
    WorkspaceRepository(database).save(workspace, 0)
    process = None
    try:
        with (
            tempfile.TemporaryDirectory(prefix="prism-agent-acceptance-") as folder,
            mock_provider() as (provider_url, requests),
            ExitStack() as processes,
        ):
            temp = Path(folder)
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            api_url = f"http://127.0.0.1:{port}"
            module = """import os
from prism_server.core.config import Settings
from prism_server.db.postgres import PostgresDatabase
from prism_server.repositories.runtime_runs import RunRepository
from prism_server.services.runtime import RuntimeService
from prism_server.app import create_app
from prism_server.graphs.research.graph import graph
import prism_server.graphs.research.nodes.model as node
service = RuntimeService(Settings.from_env(), RunRepository(PostgresDatabase(os.environ['PRISM_DATABASE_URL'], schema=os.environ['PRISM_ACCEPTANCE_SCHEMA'])))
node.connection_repository = lambda: service.models
app = create_app(service)
"""
            (temp / "_prism_acceptance.py").write_text(module, encoding="utf-8")
            config = {
                "dependencies": [str(ROOT)],
                "graphs": {"prism_research": "_prism_acceptance:graph"},
                "http": {"app": "_prism_acceptance:app"},
                "env": {},
                "disable_persistence": True,
            }
            (temp / "langgraph.json").write_text(json.dumps(config), encoding="utf-8")
            env = {
                **os.environ,
                "PYTHONPATH": str(temp) + os.pathsep + str(ROOT / "server/src"),
                "PYTHONUTF8": "1",
                "LOG_COLOR": "false",
                "PRISM_DATABASE_URL": url,
                "PRISM_ACCEPTANCE_SCHEMA": database.schema,
                "PRISM_AGENT_API_URL": api_url,
                "PRISM_AGENT_PUBLIC_URL": api_url,
                "PRISM_MODEL_ENCRYPTION_KEY": Fernet.generate_key().decode(),
                "LANGSMITH_TRACING": "true" if tracing else "false",
                "LANGSMITH_API_KEY": os.environ.get("LANGSMITH_API_KEY", "") if tracing else "",
                "LANGSMITH_ENDPOINT": os.environ.get(
                    "LANGSMITH_ENDPOINT", "https://api.smith.langchain.com"
                ),
            }
            with (temp / "agent.log").open("w", encoding="utf-8") as log:
                process = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "langgraph_cli",
                        "dev",
                        "--config",
                        str(temp / "langgraph.json"),
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(port),
                        "--no-browser",
                        "--no-reload",
                    ],
                    cwd=temp,
                    env=env,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                )
                processes.callback(stop_process, process)
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError(
                            "验收 Agent Server 启动失败：\n"
                            + (temp / "agent.log").read_text(encoding="utf-8")[-5000:]
                        )
                    try:
                        if httpx.get(api_url + "/prism/runtime/health", timeout=1).is_success:
                            break
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.3)
                else:
                    raise RuntimeError("验收 Agent Server 启动超时")
                try:
                    yield api_url, provider_url, requests, database, env
                finally:
                    stop_process(process)
                    process = None
    finally:
        if process and process.poll() is None:
            stop_process(process)
        if not database.schema.startswith("test_") or len(database.schema) != 37:
            raise ValueError("拒绝清理非验收 schema")
        with database.connect() as connection:
            connection.execute(
                sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(database.schema))
            )
