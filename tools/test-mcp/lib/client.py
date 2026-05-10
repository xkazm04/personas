"""HTTP client wrapper for the test-automation server.

Replaces the per-script post/get/api_post helpers duplicated across
~34 e2e scripts. Honors the same response-shape contract callers
expect today: when the server returns non-JSON or HTTP errors, the
result is `{"_raw": <text>, "_status": <code>}` so callers can
detect the failure without an exception.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 17320
DEFAULT_TIMEOUT = 120


class Client:
    """Thin httpx.Client wrapper sharing the test-automation conventions."""

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int | None = None,
        default_timeout: int = DEFAULT_TIMEOUT,
    ) -> None:
        if port is None:
            port = int(os.environ.get("PERSONAS_TEST_PORT", DEFAULT_PORT))
        self.base_url = f"http://{host}:{port}"
        self.default_timeout = default_timeout
        self._client = httpx.Client(base_url=self.base_url, timeout=default_timeout)

    def post(self, path: str, body: dict | None = None, timeout: int | None = None) -> dict[str, Any]:
        r = self._client.post(path, json=body or {}, timeout=timeout or self.default_timeout)
        try:
            return json.loads(r.text)
        except json.JSONDecodeError:
            return {"_raw": r.text, "_status": r.status_code}

    def get(self, path: str, timeout: int | None = None) -> dict[str, Any]:
        r = self._client.get(path, timeout=timeout or self.default_timeout)
        try:
            return json.loads(r.text)
        except json.JSONDecodeError:
            return {"_raw": r.text, "_status": r.status_code}

    def health(self) -> dict[str, Any]:
        """Preflight check. Raises SystemExit with actionable message on failure."""
        try:
            return self.get("/health")
        except Exception as e:
            raise SystemExit(
                f"Test-automation server at {self.base_url} not responding ({e}). "
                "Launch the app with `npm run tauri:dev:test`."
            ) from e

    def close(self) -> None:
        self._client.close()
