"""Shared helpers for live-app e2e test scripts in tools/test-mcp/.

See lib/README.md for the migration policy and design rationale.

Canonical usage:

    from lib import Client, Bridge, DB, wait_until, EventLog

    client = Client()                 # defaults to 127.0.0.1:17320
    bridge = Bridge(client)
    db     = DB()                     # APPDATA-resolved path on Windows
    log    = EventLog()

    log.record("preflight.health", "ok", **client.get("/health"))
    r = bridge.exec("startBuildFromIntent", {"intent": "..."}, timeout_secs=40)

The lib is opt-in. Existing scripts retain their inline helpers; new scripts
should import from lib instead of copy-pasting.
"""

from .client import Client
from .bridge import Bridge
from .db import DB
from .wait import wait_until, WaitTimeout
from .event_log import EventLog
from .snapshot import snapshot

__all__ = ["Client", "Bridge", "DB", "wait_until", "WaitTimeout", "EventLog", "snapshot"]
