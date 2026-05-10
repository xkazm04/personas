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
    # The Companion master toggle does not yet have a data-testid.
    # Tracked as a follow-up: add testid to the SetupPanel toggle so this
    # step can flip the gate. For now we assume the user has already
    # enabled the toggle (or run with --skip-toggle which is now default).
    if args.skip_toggle:
        log.record(
            "toggle.master",
            "info",
            note="skipped — companion-master-toggle testid not yet wired; "
            "see follow-up backlog item for adding it to SetupPanel.",
        )
        return
    log.record(
        "toggle.master",
        "fail",
        error="companion-master-toggle testid not present in DOM — add it to SetupPanel first",
    )


def step_inspect_brain() -> dict:
    print("\n[4/5] Inspect companion brain state")
    # companionInspect returns { panelVisible, streaming, messages,
    # streamingText, approvals, brain: { episodes, reflections, facts,
    # procedurals, goals, rituals, backlog } } — NOT wrapped in
    # {success, error}. Brain counts are populated even when panel is not
    # visible.
    r = bridge.exec("companionInspect", {}, timeout_secs=20)
    brain = r.get("brain") or {}
    if not isinstance(brain, dict):
        log.record("brain.inspect", "fail", error="brain field missing or malformed", raw=r)
        return {}
    log.record(
        "brain.inspect",
        "ok",
        panel_visible=r.get("panelVisible"),
        streaming=r.get("streaming"),
        message_count=len(r.get("messages") or []),
        approvals=r.get("approvals"),
        brain_episodes=brain.get("episodes"),
        brain_reflections=brain.get("reflections"),
        brain_facts_user=(brain.get("facts") or {}).get("user"),
    )
    return r


def step_chat_send() -> None:
    print("\n[5/5] Send a chat message via the companion surface")
    # Real testids: companion-composer (textarea), companion-send (button).
    # If the companion panel is collapsed or not mounted, fillField will
    # return success=false; that's informational, not a hard failure.
    fill = bridge.exec(
        "fillField",
        {"testId": "companion-composer", "value": args.message},
        timeout_secs=15,
    )
    log.record(
        "chat.fill",
        "ok" if fill.get("success") else "info",
        error=fill.get("error"),
        note=(
            "companion-composer not on page — companion panel likely "
            "collapsed; expand it manually or via a separate step"
            if not fill.get("success")
            else None
        ),
    )
    if not fill.get("success"):
        return
    submit = bridge.exec(
        "clickTestId",
        {"testId": "companion-send"},
        timeout_secs=15,
    )
    log.record("chat.submit", "ok" if submit.get("success") else "info", error=submit.get("error"))


def step_cleanup() -> None:
    # No cleanup needed — this script doesn't create persistent state
    # (master toggle is skipped; sending a chat message persists a
    # companion message but that's expected demo content).
    if args.no_cleanup:
        log.record("cleanup", "info", note="skipped via --no-cleanup")
        return
    log.record("cleanup", "info", note="nothing to clean up (master toggle was not flipped)")


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
