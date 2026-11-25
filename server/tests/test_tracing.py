"""追踪客户端的首次初始化必须避开 ASGI 事件循环。"""

import unittest
from threading import get_ident
from unittest.mock import MagicMock, patch

from prism_server.core.config import Settings
from prism_server.repositories.runtime_runs import RunRepository
from prism_server.services.runtime import RuntimeService


class TracingStartupTests(unittest.IsolatedAsyncioTestCase):
    async def test_tracing_client_initializes_off_the_event_loop(self):
        settings = Settings.from_env().model_copy(
            update={"tracing_enabled": True, "tracing_key_configured": True}
        )
        repository = MagicMock(spec=RunRepository)
        repository.database = MagicMock()
        service = RuntimeService(settings, repository)
        event_loop_thread = get_ident()
        initialization_threads = []
        with patch(
            "prism_server.integrations.langsmith.get_tracing_client",
            side_effect=lambda: initialization_threads.append(get_ident()),
        ):
            await service.initialize()
        repository.initialize.assert_called_once()
        self.assertEqual(len(initialization_threads), 1)
        self.assertNotEqual(initialization_threads[0], event_loop_thread)

    async def test_disabled_or_unconfigured_tracing_does_not_initialize_a_client(self):
        for enabled, configured in ((False, True), (True, False)):
            with self.subTest(enabled=enabled, configured=configured):
                settings = Settings.from_env().model_copy(
                    update={"tracing_enabled": enabled, "tracing_key_configured": configured}
                )
                repository = MagicMock(spec=RunRepository)
                repository.database = MagicMock()
                with patch("prism_server.integrations.langsmith.get_tracing_client") as client:
                    await RuntimeService(settings, repository).initialize()
                client.assert_not_called()
