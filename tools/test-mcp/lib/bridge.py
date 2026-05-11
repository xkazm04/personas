"""Bridge dispatcher — thin layer over /bridge-exec.

Replaces the per-script `bridge()` function defined identically in
~12+ e2e scripts. The HTTP layer adds a small headroom to the
caller-supplied timeout so the server has time to format errors
before httpx times out.
"""
from __future__ import annotations

from typing import Any

from .client import Client


HTTP_HEADROOM_SECS = 20


class Bridge:
    """Wraps `/bridge-exec` so test scripts don't reinvent the dispatcher."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def exec(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        timeout_secs: int = 180,
    ) -> dict[str, Any]:
        """Dispatch any bridge method via the generic `/bridge-exec` route.

        Returns the bridge's JSON response. Failures show up as
        `{"success": false, "error": "..."}` — callers must check, never
        assume success.
        """
        return self._client.post(
            "/bridge-exec",
            {"method": method, "params": params or {}, "timeout_secs": timeout_secs},
            timeout=timeout_secs + HTTP_HEADROOM_SECS,
        )
