#!/usr/bin/env python
"""uat/driver/drive_ai.py — AI-surface L2 driver for Character-driven UAT.

Every high-value surface in this app is an AI surface (build sessions,
companion turns, executions, design analysis). Testing them means the
**drive → wait-for-settle → capture → judge-grounding** pattern, not a
single click+assert. This is the personas equivalent of the source skill's
`drive-ai.mjs`.

Canonical reference for the pattern: `tools/test-mcp/athena_uc_drive.py`
(companion_reset -> openCompanion -> fill composer -> send ->
companionWaitForTurnFinish -> companionCaptureLastTurn). This wrapper makes
that reusable for any Character x AI-journey and adds an optional grounding
assertion (does the captured output actually NAME the supplied real entity?).

Usage (run from repo root):
    # Drive the companion with a prompt, capture the settled turn:
    python uat/driver/drive_ai.py companion "Summarize my GitHub PRs every morning"
    # ...and assert the output is grounded (echoes a real entity you supplied):
    python uat/driver/drive_ai.py companion "Check my latest Sentry issue" --expect Sentry

Preflight: app running with `npm run tauri:dev:test` (server on :17320).
NOTE: this resets companion conversation state for isolation — run against an
instance you're allowed to mutate, never the user's working app.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "tools", "test-mcp"))

from lib import Client, Bridge  # noqa: E402


def invoke(bridge: Bridge, command: str, params: dict | None = None) -> dict:
    return bridge.exec("invokeCommand", {"command": command, "params": params or {}}, timeout_secs=30)


def drive_companion(prompt: str, pinned: list[str] | None, expect: str | None) -> dict:
    c = Client()
    c.health()
    b = Bridge(c)

    # Isolation: wipe prior conversation so the judge sees only this turn.
    invoke(b, "companion_reset_conversation", {"wipeTranscript": True})
    time.sleep(1)
    if pinned:
        invoke(b, "companion_set_active_connectors", {"connectorNames": pinned})
        time.sleep(1)

    b.exec("openCompanion", {}, timeout_secs=10)
    c.post("/fill-field", {"test_id": "companion-composer", "value": prompt}, timeout=20)
    c.post("/click-testid", {"test_id": "companion-send"}, timeout=20)

    # AI surfaces take 30–215s — wait for the turn to actually settle.
    finish = b.exec("companionWaitForTurnFinish", {"timeoutMs": 200000}, timeout_secs=215)
    time.sleep(2)
    capture = b.exec("companionCaptureLastTurn", {}, timeout_secs=30)

    text = json.dumps(capture)  # crude flatten for the grounding check
    grounded = None
    if expect:
        grounded = expect.lower() in text.lower()

    return {
        "prompt": prompt,
        "pinned": pinned,
        "elapsed_ms": (finish or {}).get("elapsedMs"),
        "finish": finish,
        "capture": capture,
        "expect": expect,
        "grounded": grounded,  # True/False/None — feed the senior-quality + grounding criteria
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="AI-surface UAT driver")
    ap.add_argument("surface", choices=["companion"], help="which AI surface to drive")
    ap.add_argument("prompt", help="the in-Character prompt")
    ap.add_argument("--pin", nargs="*", default=None, help="connector names to pin (real-context grounding)")
    ap.add_argument("--expect", default=None, help="entity the grounded output should name")
    args = ap.parse_args()

    if args.surface == "companion":
        result = drive_companion(args.prompt, args.pin, args.expect)
    else:  # pragma: no cover
        print("unsupported surface", file=sys.stderr)
        return 2

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
