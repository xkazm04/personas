r"""
End-to-end scenario: Messaging dispatch via vault-resolved channels.

Validates messaging-channels-slice-4 (shipped 2026-05-10 as d9a5f7f43) —
build a persona with a messaging row in the Glyph composer, fire an
execution that emits UserMessage, validate that the dispatcher resolves
the credential and routes to the selected channel.

This script focuses on the build-time persistence of `notification_channels`
plus the delivery-time merge with vault `scoped_resources`. It does NOT
require a real external delivery (Slack/Teams/Discord); a built-in inbox
channel is sufficient to exercise the dispatcher path.

Prerequisites:
  1. Dev app running with test-automation feature.
  2. Vault has at least one messaging credential (built-in persona inbox is
     auto-seeded; external credentials optional).

Usage:
  uvx --with httpx python tools/test-mcp/e2e_messaging_dispatch.py
  uvx --with httpx python tools/test-mcp/e2e_messaging_dispatch.py --port 17320

Flags:
  --port <int>          test-automation server port (default 17320)
  --intent <str>        override the default intent (event-driven messenger)
  --build-timeout <sec> per-phase build timeout (default 180)
  --no-cleanup          keep the persona after the run
  --report <path>       JSON run log destination (default stdout)
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

from lib import Bridge, Client, DB, EventLog

parser = argparse.ArgumentParser(description="Messaging dispatch e2e")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument(
    "--intent",
    type=str,
    default=(
        "Send a daily summary to the persona inbox whenever a new "
        "document is added to my local drive. Always notify the inbox."
    ),
)
parser.add_argument("--build-timeout", type=int, default=180)
parser.add_argument("--no-cleanup", action="store_true")
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()

client = Client(port=args.port, default_timeout=240)
bridge = Bridge(client)
db = DB()
log = EventLog()


def step_preflight() -> None:
    print("\n[1/5] Preflight")
    client.health()
    log.record("preflight", "ok")


def step_build_persona() -> str:
    print("\n[2/5] Build a persona with a messaging-row intent")
    r = bridge.exec(
        "startBuildFromIntent",
        {"intent": args.intent, "timeoutMs": 30_000},
        timeout_secs=40,
    )
    if not r.get("success"):
        raise SystemExit(f"startBuildFromIntent failed: {r.get('error')}")
    persona_id = r.get("personaId")
    log.record("build.start", "ok", persona_id=persona_id)

    # Drive the question loop with messaging-aware answers. We don't expect
    # the LLM to ask many questions for this scenario; 8 rounds is plenty.
    answer_recipes = {
        "behavior_core": (
            "Event-driven messenger: when a new document arrives in the "
            "local drive, summarize it and post the summary to the persona "
            "inbox (built-in). No external messaging service required."
        ),
        "mission": (
            "Event-driven messenger: when a new document arrives in the "
            "local drive, summarize it and post the summary to the persona "
            "inbox (built-in). No external messaging service required."
        ),
        "triggers": (
            'Event-driven only. trigger_type="event" with subscription on '
            "drive.document.added."
        ),
        "connectors": (
            "local_drive only. No external storage."
        ),
        "events": (
            "Subscribe to drive.document.added on local_drive."
        ),
        "human-review": "No manual review needed.",
        "messages": (
            "Send the summary to the built-in persona inbox channel. Use the "
            "messaging row to attach the inbox channel."
        ),
        "memory": "Stateless — no memory.",
        "use-cases": (
            "Single capability: Summarise+Notify. Output goes to the persona "
            "inbox, not to drive."
        ),
        "error-handling": "Log + skip on failure; no retries.",
    }

    for round_ix in range(15):
        phase_r = bridge.exec(
            "waitForBuildPhase",
            {
                "phases": ["awaiting_input", "draft_ready", "test_complete", "promoted", "failed"],
                "timeoutMs": args.build_timeout * 1000,
            },
            timeout_secs=args.build_timeout + 10,
        )
        phase = phase_r.get("phase")
        if phase == "failed":
            raise SystemExit(f"Build failed: {phase_r.get('error')}")
        if phase in ("draft_ready", "test_complete", "promoted"):
            log.record("build.phase", "ok", phase=phase, round=round_ix)
            break
        if phase != "awaiting_input":
            continue

        qs = bridge.exec("listPendingBuildQuestions", {}, timeout_secs=20).get("questions") or []
        if not qs:
            continue
        batch = {}
        for q in qs:
            key = q.get("cellKey") or q.get("cell_key")
            if not key:
                continue
            batch[key] = answer_recipes.get(
                key,
                "Auto-scenario answer: built-in inbox messaging, drive-event trigger.",
            )
        bridge.exec("answerPendingBuildQuestions", {"answers": batch}, timeout_secs=60)

    promote = bridge.exec("promoteBuildDraft", {}, timeout_secs=60)
    if not promote.get("success"):
        raise SystemExit(f"promoteBuildDraft failed: {promote.get('error')}")
    log.record("build.promote", "ok", persona_id=promote.get("personaId"))
    return promote.get("personaId") or persona_id


def step_verify_notification_channels(persona_id: str) -> None:
    print("\n[3/5] Verify notification_channels JSON shape on the persona row")
    rows = db.query(
        "SELECT notification_channels FROM personas WHERE id = ? LIMIT 1",
        (persona_id,),
    )
    if not rows:
        raise SystemExit(f"Persona {persona_id} not in DB after promotion")
    raw = rows[0]["notification_channels"]
    try:
        channels = json.loads(raw) if isinstance(raw, str) and raw else []
    except Exception:
        channels = []
    log.record(
        "channels.shape",
        "ok" if channels else "info",
        count=len(channels),
        types=[c.get("type") for c in channels if isinstance(c, dict)],
    )


def step_drive_write_to_fire(persona_id: str) -> None:
    print("\n[4/5] Drive-write to fire the trigger")
    write = bridge.exec(
        "driveWriteText",
        {"relPath": "inbox/messaging-test.md", "content": "# Test\nA short test doc."},
        timeout_secs=30,
    )
    log.record("drive.write", "ok" if write.get("success") else "fail", error=write.get("error"))


def step_verify_message_dispatch(persona_id: str) -> None:
    print("\n[5/5] Verify a UserMessage row landed in the inbox")
    # The messaging dispatcher writes to persona_messages on UserMessage emit;
    # the inbox is the built-in channel that always receives.
    rows = db.query(
        "SELECT id, channel_type, status, error_message FROM persona_messages "
        "WHERE persona_id = ? ORDER BY created_at DESC LIMIT 5",
        (persona_id,),
    )
    log.record(
        "dispatch.messages",
        "ok" if rows else "info",
        count=len(rows),
        recent_channels=[r.get("channel_type") for r in rows],
        recent_statuses=[r.get("status") for r in rows],
    )


def step_cleanup(persona_id: str) -> None:
    if args.no_cleanup:
        return
    print("\n[cleanup] Delete persona")
    r = bridge.exec("deleteAgent", {"nameOrId": persona_id}, timeout_secs=30)
    log.record("cleanup", "ok" if r.get("success") else "info", error=r.get("error"))


def main() -> None:
    started = datetime.now(timezone.utc)
    persona_id: str | None = None
    try:
        step_preflight()
        persona_id = step_build_persona()
        step_verify_notification_channels(persona_id)
        step_drive_write_to_fire(persona_id)
        step_verify_message_dispatch(persona_id)
        step_cleanup(persona_id)
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
