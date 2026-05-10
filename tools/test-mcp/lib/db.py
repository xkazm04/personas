"""SQLite wrapper for direct DB inspection in e2e scripts.

The personas app stores its database under the OS app-data dir.
Scripts read it directly to verify side-effects (persona rows,
execution rows, manual review rows) — there is no /db HTTP route.
"""
from __future__ import annotations

import os
import sqlite3
from typing import Any


def default_db_path() -> str:
    """Resolve the canonical personas.db path on the current host.

    Windows: %APPDATA%/com.personas.desktop/personas.db
    macOS:   ~/Library/Application Support/com.personas.desktop/personas.db
    Linux:   ~/.local/share/com.personas.desktop/personas.db
    """
    if "APPDATA" in os.environ:
        return os.path.join(os.environ["APPDATA"], "com.personas.desktop", "personas.db")
    if os.path.exists(os.path.expanduser("~/Library")):
        return os.path.expanduser("~/Library/Application Support/com.personas.desktop/personas.db")
    return os.path.expanduser("~/.local/share/com.personas.desktop/personas.db")


class DB:
    """Lightweight read-mostly wrapper around personas.db."""

    def __init__(self, path: str | None = None) -> None:
        self.path = path or default_db_path()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def query(self, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
        conn = self._connect()
        conn.row_factory = sqlite3.Row
        try:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()

    def scalar(self, sql: str, params: tuple = ()) -> Any:
        conn = self._connect()
        try:
            row = conn.execute(sql, params).fetchone()
            return row[0] if row else None
        finally:
            conn.close()

    def find_persona_by_name(self, name: str) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM personas WHERE name = ? LIMIT 1", (name,))
        return rows[0] if rows else None

    def latest_execution(self, persona_id: str) -> dict[str, Any] | None:
        rows = self.query(
            "SELECT * FROM persona_executions WHERE persona_id = ? "
            "ORDER BY created_at DESC LIMIT 1",
            (persona_id,),
        )
        return rows[0] if rows else None
