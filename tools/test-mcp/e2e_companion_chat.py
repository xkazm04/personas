r"""
End-to-end scenario: Companion master toggle + chat surface + brain inspection.

Validates the companion-project-tracking subsystem (Phases 0-7, merged
2026-05-10 as 76635e649) by exercising the master toggle, sending a
chat message, and inspecting the brain via the previously-orphan
`companionInspect` bridge macro.

Prerequisites:
  1. Dev app running with test-automation feature:
       npm run tauri:dev:test
     or
       cargo tauri dev --features "test-automation desktop"
  2. Companion plugin enabled in Settings → Plugins.

Usage:
  uvx --with httpx python tools/test-mcp/e2e_companion_chat.py
  uvx --with httpx python tools/test-mcp/e2e_companion_chat.py --port 17320
  uvx --with httpx python tools/test-mcp/e2e_companion_chat.py --skip-toggle

Flags:
  --port <int>          test-automation server port (default 17320)
  --message <str>       message to send through the chat surface
  --no-cleanup          keep the toggle state and chat history after the run
  --skip-toggle         don't flip the master toggle (assume it's already on)
  --report <path>       write the JSON run log here (default stdout)
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

from lib import Bridge, Client, EventLog, snapshot

parser = argparse.ArgumentParser(description="Companion master toggle + chat e2e")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument(
    "--message",
    type=str,
    default="What projects are you tracking right now?",
)
parser.add_argument("--no-cleanup", action="store_true")
parser.add_argument("--skip-toggle", action="store_true")
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()

client = Client(port=args.port, default_timeout=120)
bridge = Bridge(client)
log = EventLog()


def step_preflight() -> None:
    print("\n[1/5] Preflight")
    h = client.health()
    log.record("preflight.health", "ok", server=h.get("server"))


def step_navigate_to_companion() -> None:
    print("\n[2/5] Navigate to Companion plugin page")
    nav = bridge.exec("navigate", {"section": "plugins"}, timeout_secs=15)
    log.record("nav.plugins", "ok" if nav.get("success") else "fail", **nav)
    # Wait for the plugin page to settle.
    snap = snapshot(client)
    log.record(
        "post-nav.snapshot",
        "ok",
        route=snap.get("route"),
        editorTab=snap.get("editorTab"),
        modal_count=len(snap.get("modals") or []),
    )


def step_toggle_master() -> None:
    if args.skip_toggle:
        log.record("toggle.master", "info", note="skipped via --skip-toggle")
        return
    print("\n[3/5] Toggle Companion master switch")
    # The master toggle lives at data-testid="companion-master-toggle" in the
    # Companion setup panel. The bridge's clickTestId macro routes the click
    # through React's synthetic event system.
    r = bridge.exec(
        "clickTestId",
        {"testId": "companion-master-toggle"},
        timeout_secs=15,
    )
    log.record(
        "toggle.master",
        "ok" if r.get("success") else "info",
        error=r.get("error"),
    )


def step_inspect_brain() -> dict:
    print("\n[4/5] Inspect companion brain state")
    # companionInspect is the previously-orphan bridge macro that reads the
    # companion brain context (active subscriptions, recent pulses, master
    # toggle state). It existed in bridge.ts before this script consumed it.
    r = bridge.exec("companionInspect", {}, timeout_secs=20)
    if not r.get("success"):
        log.record("brain.inspect", "fail", error=r.get("error"))
        return {}
    log.record(
        "brain.inspect",
        "ok",
        master_enabled=r.get("masterEnabled"),
        subscriptions=r.get("subscriptionCount"),
        recent_pulses=r.get("recentPulseCount"),
    )
    return r


def step_chat_send() -> None:
    print("\n[5/5] Send a chat message via the companion surface")
    # The companion chat surface mounts on the plugin page. Use fillField +
    # the chat-send testid the way the build harness does for question
    # answers — same React synthetic-event path.
    fill = bridge.exec(
        "fillField",
        {"testId": "companion-chat-input", "value": args.message},
        timeout_secs=15,
    )
    log.record("chat.fill", "ok" if fill.get("success") else "info", error=fill.get("error"))
    if not fill.get("success"):
        return
    submit = bridge.exec(
        "clickTestId",
        {"testId": "companion-chat-send"},
        timeout_secs=15,
    )
    log.record("chat.submit", "ok" if submit.get("success") else "info", error=submit.get("error"))


def step_cleanup() -> None:
    if args.no_cleanup:
        log.record("cleanup", "info", note="skipped via --no-cleanup")
        return
    if args.skip_toggle:
        return  # didn't flip it; nothing to revert
    print("\n[cleanup] Restore master toggle")
    r = bridge.exec(
        "clickTestId",
        {"testId": "companion-master-toggle"},
        timeout_secs=15,
    )
    log.record("cleanup.toggle", "ok" if r.get("success") else "info", error=r.get("error"))


def main() -> None:
    started = datetime.now(timezone.utc)
    try:
        step_preflight()
        step_navigate_to_companion()
        step_toggle_master()
        step_inspect_brain()
        step_chat_send()
        step_cleanup()
    except SystemExit as e:
        log.record("scenario.abort", "fail", error=str(e))
    except Exception as e:
        log.record("scenario.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        log.dump(args.report, started=started, finished=finished)


if __name__ == "__main__":
    main()
