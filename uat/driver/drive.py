#!/usr/bin/env python
"""uat/driver/drive.py — thin L2 driver for Character-driven UAT.

This is a *thin wrapper* over the existing test-automation harness in
`tools/test-mcp/lib/`. It does NOT reimplement the harness — it imports it.
It exists only to give the UAT skill a stable, in-Character entry point for
the non-AI mechanics: reach a section, snapshot, click, fill, read state.

For AI surfaces (build sessions, companion turns, executions) use
`drive_ai.py` instead — those need the wait-for-settle + capture pattern.

Usage (run from the repo root; the lib lives under tools/test-mcp/):
    python uat/driver/drive.py health
    python uat/driver/drive.py snapshot
    python uat/driver/drive.py nav personas
    python uat/driver/drive.py fill agent-intent-input "Summarize my GitHub PRs"
    python uat/driver/drive.py click agent-launch-btn

Preflight: the app must be running with the test server —
    npm run tauri:dev:test    # -> http://127.0.0.1:17320
    curl http://127.0.0.1:17320/health
"""
from __future__ import annotations

import json
import os
import sys

# Make tools/test-mcp/ importable so `from lib import ...` resolves.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "tools", "test-mcp"))

from lib import Client, snapshot  # noqa: E402


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 0

    c = Client()  # 127.0.0.1:17320, honors PERSONAS_TEST_PORT
    cmd = args[0]

    if cmd == "health":
        print(json.dumps(c.health(), indent=2))
    elif cmd == "snapshot":
        print(json.dumps(snapshot(c), indent=2))
    elif cmd == "state":
        print(json.dumps(c.get("/state"), indent=2))
    elif cmd == "nav":
        print(json.dumps(c.post("/navigate", {"section": args[1]}), indent=2))
    elif cmd == "fill":
        print(json.dumps(c.post("/fill-field", {"test_id": args[1], "value": args[2]}), indent=2))
    elif cmd == "click":
        print(json.dumps(c.post("/click-testid", {"test_id": args[1]}), indent=2))
    elif cmd == "find":
        print(json.dumps(c.post("/find-text", {"text": args[1]}), indent=2))
    else:
        print(f"unknown command: {cmd}\n{__doc__}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
