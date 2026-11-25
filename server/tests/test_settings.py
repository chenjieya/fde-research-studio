"""环境配置的类型、边界、来源优先级与敏感值保护。"""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet
from prism_server.core.config import Settings
from pydantic import ValidationError


class SettingsTests(unittest.TestCase):
    def test_environment_aliases_types_and_public_url_fallback(self):
        with patch.dict(
            os.environ,
            {
                "PRISM_AGENT_API_URL": "http://127.0.0.1:2050/",
                "PRISM_REQUEST_TIMEOUT_SECONDS": "12.5",
                "LANGSMITH_TRACING": "false",
                "LANGSMITH_API_KEY": "test-key",
            },
            clear=True,
        ):
            settings = Settings.from_env()
        self.assertEqual(settings.agent_api_url, "http://127.0.0.1:2050")
        self.assertEqual(settings.public_api_url, settings.agent_api_url)
        self.assertEqual(settings.timeout_seconds, 12.5)
        self.assertFalse(settings.tracing_enabled)
        self.assertTrue(settings.tracing_key_configured)

    def test_invalid_settings_fail_validation_without_printing_secrets(self):
        cases = [
            {"PRISM_REQUEST_TIMEOUT_SECONDS": "0"},
            {"PRISM_REQUEST_TIMEOUT_SECONDS": "nan"},
            {"LANGSMITH_TRACING": "not-a-bool"},
            {"PRISM_AGENT_API_URL": "http://user:sensitive-password@example.com"},
            {"PRISM_AGENT_API_URL": "http://bad host:2024"},
            {"LANGSMITH_ENDPOINT": "file:///tmp/traces"},
            {"PRISM_DATABASE_URL": "not-a-postgres-url-sensitive-password"},
            {"PRISM_MODEL_ENCRYPTION_KEY": "sensitive-password"},
        ]
        for values in cases:
            with self.subTest(variables=list(values)), patch.dict(os.environ, values, clear=True):
                with self.assertRaises(ValidationError) as caught:
                    Settings.from_env()
                self.assertNotIn("sensitive-password", str(caught.exception))

    def test_environment_overrides_explicit_dotenv_and_unknown_variables_are_ignored(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text(
                "PRISM_REQUEST_TIMEOUT_SECONDS=8\nLANGSMITH_TRACING=true\nUNRELATED_VARIABLE=unused\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"PRISM_REQUEST_TIMEOUT_SECONDS": "15"}, clear=True):
                settings = Settings(_env_file=path)
                overridden = Settings(_env_file=path, timeout_seconds=20)
            self.assertEqual(settings.timeout_seconds, 15)
            self.assertTrue(settings.tracing_enabled)
            self.assertEqual(overridden.timeout_seconds, 20)

    def test_secret_values_are_not_in_repr_or_serialized_settings(self):
        encryption = Fernet.generate_key().decode()
        with patch.dict(
            os.environ,
            {
                "PRISM_DATABASE_URL": "postgresql://user:sensitive-password@localhost/research",
                "PRISM_MODEL_ENCRYPTION_KEY": encryption,
                "LANGSMITH_API_KEY": "sensitive-api-key",
            },
            clear=True,
        ):
            settings = Settings.from_env()
        for rendered in (repr(settings), settings.model_dump_json()):
            self.assertNotIn("sensitive-password", rendered)
            self.assertNotIn("sensitive-api-key", rendered)
            self.assertNotIn(encryption, rendered)

    def test_settings_are_immutable_and_do_not_load_dotenv_implicitly(self):
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings.from_env()
        self.assertFalse(settings.tracing_enabled)
        with self.assertRaises(ValidationError):
            settings.timeout_seconds = 45
