"""Rich snapshot helper.

Wraps `GET /test/snapshot` (added in F6.1). Replaces the ad-hoc
`_check_*.py`, `_probe_*.py`, `_root_cause.py` diagnostic scripts
that each manually inspected app state during e2e flake debugging.

Returned shape (subject to extension; new fields are additive):
    {
      "route": "personas",
      "editorTab": "matrix",
      "selectedPersonaId": "...",
      "personaCount": 12,
      "personasByStatus": {"promoted": 8, "draft_ready": 1, ...},
      "personaCountByStatus": {...},      # alias of personasByStatus
      "buildSession": {
          "phase": "awaiting_input" | null,
          "sessionId": "..." | null,
          "personaId": "..." | null,
          "error": "..." | null,
          "outputLineCount": 0,
          "testPassed": null,
      },
      "modals": [...],
      "toasts": [...],
      "errors": [...],
      "forms": [...],
      "pageTitle": "...",
      "isCreatingPersona": bool,
      "isLoading": bool,
      "error": "..." | null,
    }
"""
from __future__ import annotations

from typing import Any

from .client import Client


def snapshot(client: Client) -> dict[str, Any]:
    """Fetch the rich snapshot. Returns {} on transport error to keep
    diagnostic callers from raising mid-test-failure."""
    try:
        return client.get("/test/snapshot")
    except Exception as e:  # pragma: no cover — diagnostic path
        return {"_error": str(e)}
