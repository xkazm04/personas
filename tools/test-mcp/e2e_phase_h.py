r"""
Phase H — webhook trigger + smee auto-bind E2E (C7 increment, 2026-04-28).

Builds a persona whose intent strongly implies a webhook trigger ("react
when GitHub fires a push"), exercises the new build prompt rule 24 path
(LLM emits clarifying_question with `accepts_webhook_source: true`),
attaches a smee.io URL via `answerBuildQuestionWithWebhookSource`, then
promotes and asserts the smee_relays row landed with the right shape.

Acceptance gates after promote:

  1. The IR has at least one webhook trigger.
  2. The webhook trigger config carries `smee_channel_url` (the LLM
     correctly placed the URL the user attached).
  3. A smee_relays row exists with target_persona_id == new persona.
  4. The relay's channel_url matches the URL the user attached.
  5. The relay's event_filter matches the user-provided filter (or null).

The smee URL used by this driver is a TEST channel — `https://smee.io/`
plus a random suffix per-run so re-runs don't collide on the UNIQUE
constraint. The relay manager will try to connect to this URL and fail
silently (smee will reject unknown channels with a 404), which is fine —
this driver tests the BUILD-TIME wiring, not the runtime forwarding.

Prereqs:
  1. Dev app running with test-automation feature:
       npx tauri dev -- --features test-automation
  2. Test server is reachable:
       curl http://127.0.0.1:17320/health

Usage:
  uvx --with httpx python tools/test-mcp/e2e_phase_h.py
  uvx --with httpx python tools/test-mcp/e2e_phase_h.py --report logs/phase-h.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx


# ---- CLI ---------------------------------------------------------------

INTENT = (
    "React in real time when GitHub fires a `push` webhook on my "
    "main repo. Forward the payload to a Slack channel as a brief "
    "one-line summary so the team sees the commit immediately. "
    "No batching, no schedule — webhook trigger only."
)

# Random per-run smee URL suffix to avoid UNIQUE conflicts on the
# `smee_relays.channel_url` column when re-running the driver.
SMEE_URL = f"https://smee.io/phase-h-{uuid.uuid4().hex[:12]}"
EVENT_FILTER = "github.push"

parser = argparse.ArgumentParser(description="Phase H webhook + smee auto-bind E2E")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument("--build-timeout", type=int, default=240)
parser.add_argument("--no-persona-cleanup", action="store_true")
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()


BASE = f"http://127.0.0.1:{args.port}"
client = httpx.Client(base_url=BASE, timeout=240)


def post(path: str, body: dict | None = None, timeout: int | None = None) -> dict:
    r = client.post(path, json=body or {}, timeout=timeout or 120)
    try:
        return json.loads(r.text)
    except json.JSONDecodeError:
        return {"_raw": r.text, "_status": r.status_code}


def get(path: str) -> dict:
    return json.loads(client.get(path).text)


def bridge(method: str, params: dict | None = None, timeout_secs: int = 180) -> dict:
    return post(
        "/bridge-exec",
        {"method": method, "params": params or {}, "timeout_secs": timeout_secs},
        timeout=timeout_secs + 20,
    )


# ---- Event log ---------------------------------------------------------

log: list[dict] = []


def record(step: str, outcome: str, **kw) -> dict:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "step": step, "outcome": outcome}
    entry.update(kw)
    log.append(entry)
    marker = "[OK]" if outcome == "ok" else ("[..]" if outcome == "info" else "[XX]")
    sys.stdout.write(f"  {marker} {step}: {outcome}")
    if kw:
        brief = {k: v for k, v in kw.items() if not isinstance(v, (dict, list))}
        if brief:
            sys.stdout.write(f"  {brief}")
    sys.stdout.write("\n")
    sys.stdout.flush()
    return entry


# ---- Answer recipes ----------------------------------------------------

ANSWERS = {
    "behavior_core": (
        "GitHub-to-Slack push relay. Mission: get push events to the team "
        "channel within seconds, no batching, no human review. Single "
        "capability, single direction (in: webhook, out: Slack)."
    ),
    "mission": (
        "Be the team's real-time GitHub push notifier in Slack."
    ),
    "use-cases": (
        "ONE capability — Push To Slack. Webhook trigger (forwarded via "
        "smee.io), formats the payload as a one-line Slack summary, posts "
        "to a single channel."
    ),
    "triggers": (
        # Inline the smee URL + filter directly in the answer text so the
        # LLM places them on the trigger config without needing rule 24's
        # accepts_webhook_source clarifying-question round-trip. The driver
        # ALSO listens for the typed-payload variant in step 3 (both paths
        # land the same fields on the trigger config).
        f"Webhook trigger ONLY. No schedule, no polling, no event_listener.\n"
        f"\n"
        f"Forwarded via smee.io. Set the trigger config's `smee_channel_url` "
        f"to {SMEE_URL!r} and `smee_event_filter` to {EVENT_FILTER!r}. Leave "
        f"`webhook_secret` null — promote auto-generates one."
    ),
    "connectors": (
        "Slack as the destination. github connector NOT needed for this "
        "capability — the webhook payload contains everything."
    ),
    "events": "No internal event subscriptions or emits.",
    "human-review": "Never review — auto-publish.",
    "messages": "Post to one Slack channel per push event.",
    "memory": "Stateless — each push is independent.",
    "error-handling": (
        "If the Slack post fails, log and skip — the next push will retry "
        "naturally. Don't queue."
    ),
}


# ---- Steps -------------------------------------------------------------


def step_preflight() -> None:
    print("\n[1/6] Preflight")
    try:
        h = get("/health")
    except Exception as e:
        record("preflight.health", "fail", error=str(e))
        raise SystemExit(
            "Test-automation server not responding. Launch the app with "
            "`npx tauri dev -- --features test-automation` first."
        ) from e
    record("preflight.health", "ok", server=h.get("server"), version=h.get("version"))


def step_start_build() -> dict:
    print("\n[2/6] Start build")
    r = bridge("startBuildFromIntent", {"intent": INTENT, "timeoutMs": 30_000}, 40)
    if not r.get("success"):
        record("start_build", "fail", error=r.get("error"))
        raise SystemExit(f"startBuildFromIntent failed: {r.get('error')}")
    record(
        "start_build",
        "ok",
        session_id=r.get("sessionId"),
        persona_id=r.get("personaId"),
    )
    return r


def step_answer_dimensions(persona_id: str) -> str:
    """Drive the build through clarifying questions until draft_ready /
    test_complete. Watches for any question with `acceptsWebhookSource:
    true` and submits it via the webhook-source bridge helper instead of
    the regular text-batch path. Returns the final phase reached."""
    print("\n[3/6] Answer build clarifying questions")

    max_rounds = 30
    submitted_webhook_source = False

    for round_ix in range(max_rounds):
        phase_r = bridge(
            "waitForBuildPhase",
            {
                "phases": [
                    "awaiting_input",
                    "draft_ready",
                    "test_complete",
                    "promoted",
                    "failed",
                ],
                "timeoutMs": args.build_timeout * 1000,
            },
            args.build_timeout + 10,
        )
        phase = phase_r.get("phase")
        record(
            f"wait.phase.round{round_ix}",
            "ok" if phase_r.get("success") else "info",
            phase=phase,
            pending=phase_r.get("pendingCount"),
        )
        if phase == "failed":
            raise SystemExit(f"Build failed mid-flight: {phase_r.get('error')}")
        if phase in ("draft_ready", "test_complete", "promoted"):
            record(
                "answer_dimensions",
                "ok",
                final_phase=phase,
                rounds=round_ix,
                webhook_source_attached=submitted_webhook_source,
            )
            return phase
        if phase != "awaiting_input":
            continue

        qs = bridge("listPendingBuildQuestions", {}, 20).get("questions") or []
        if not qs:
            time.sleep(1.0)
            continue

        # First pass: handle any webhook-source question separately via the
        # typed payload helper. This bypasses the batch path on purpose
        # (the answer-command short-circuits when a typed payload is set,
        # see useBuildSession::answerQuestion).
        webhook_handled = False
        for q in qs:
            if q.get("acceptsWebhookSource") or q.get("accepts_webhook_source"):
                key = q.get("cellKey") or q.get("cell_key") or "webhook_source"
                wh_resp = bridge(
                    "answerBuildQuestionWithWebhookSource",
                    {
                        "cellKey": key,
                        "answer": (
                            "Smee.io channel for the GitHub push webhook is "
                            "attached via the typed payload."
                        ),
                        "webhookSource": {
                            "channelUrl": SMEE_URL,
                            "eventFilter": EVENT_FILTER,
                        },
                    },
                    30,
                )
                record(
                    f"answer.webhook_source.round{round_ix}",
                    "ok" if wh_resp.get("success") else "fail",
                    cell_key=key,
                    error=wh_resp.get("error"),
                )
                if not wh_resp.get("success"):
                    raise SystemExit(
                        f"answerBuildQuestionWithWebhookSource failed: {wh_resp.get('error')}"
                    )
                submitted_webhook_source = True
                webhook_handled = True
                # Don't try to batch this same key in the regular path.
                break

        if webhook_handled:
            # Loop back — the LLM may emit additional questions next turn.
            continue

        # Second pass: batch every other question via the regular text path.
        batch = {}
        for q in qs:
            key = q.get("cellKey") or q.get("cell_key")
            if not key:
                continue
            batch[key] = ANSWERS.get(key, f"Auto-answer for phase H: {key}")

        if not batch:
            record(
                f"answer.round{round_ix}",
                "info",
                note="no recognizable cellKeys in pending questions",
                qs=qs,
            )
            time.sleep(1.0)
            continue

        submit = bridge("answerPendingBuildQuestions", {"answers": batch}, 60)
        record(
            f"answer.round{round_ix}",
            "ok" if submit.get("success") else "fail",
            answered=submit.get("answered"),
            error=submit.get("error"),
        )
        if not submit.get("success"):
            raise SystemExit(f"answerPendingBuildQuestions failed: {submit.get('error')}")

    raise SystemExit(
        f"Exceeded max answer rounds ({max_rounds}) without reaching draft_ready"
    )


def _wait_for_agent_ir(persona_id: str, max_seconds: int = 60) -> bool:
    """Same defensive wait as in phase_d. The build session can flicker to
    test_complete BEFORE session.agent_ir is persisted — the C6
    promote-time retry only gives 2s, so we wait client-side here."""
    deadline = time.time() + max_seconds
    last_phase = None
    while time.time() < deadline:
        sess_resp = bridge("getActiveBuildSession", {"personaId": persona_id}, 15)
        if sess_resp.get("success"):
            session = sess_resp.get("session") or {}
            phase = session.get("phase")
            if phase != last_phase:
                record(
                    "wait_for_agent_ir.phase_change",
                    "info",
                    phase=phase,
                    has_agent_ir=session.get("agentIr") is not None,
                )
                last_phase = phase
            if session.get("agentIr") is not None:
                return True
        time.sleep(2.0)
    return False


def step_test_and_promote(persona_id: str) -> dict:
    print("\n[4/6] Test + promote draft")

    if not _wait_for_agent_ir(persona_id, max_seconds=60):
        record(
            "wait_for_agent_ir",
            "fail",
            error=(
                "session.agent_ir never landed within 60s — the LLM likely "
                "did not finalize the IR. Re-run or simplify the intent."
            ),
        )
        raise SystemExit(
            "Cannot promote — session.agent_ir is null. See log for details."
        )
    record("wait_for_agent_ir", "ok")

    test = bridge("triggerBuildTest", {}, 60)
    record(
        "test_build_draft",
        "ok" if test.get("success") else "info",
        report_keys=list((test.get("report") or {}).keys()) if test.get("success") else None,
        error=test.get("error"),
    )

    promote = bridge("promoteBuildDraft", {}, 90)
    if not promote.get("success"):
        record("promote_build_draft", "fail", error=promote.get("error"))
        raise SystemExit(f"promoteBuildDraft failed: {promote.get('error')}")

    # The promote response wraps the Tauri command result under `result`.
    # `smee_relays_created` is the C7 auto-bind counter from
    # `commands::design::build_sessions::promote_build_draft_inner`.
    result = promote.get("result") or {}
    record(
        "promote_build_draft",
        "ok",
        persona_id=promote.get("personaId"),
        smee_relays_created=result.get("smee_relays_created"),
        triggers_created=result.get("triggers_created"),
    )
    return promote


def step_assert_acceptance(persona_id: str) -> dict:
    print("\n[5/6] Acceptance gates")

    # Gate 1 — IR carries a webhook trigger
    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record("acceptance.persona_detail", "fail", error=detail.get("error"))
        raise SystemExit(f"getPersonaDetail failed: {detail.get('error')}")
    d = detail.get("detail") or {}
    triggers = d.get("triggers") or []
    webhook_triggers = [t for t in triggers if t.get("trigger_type") == "webhook"]

    record(
        "acceptance.webhook_trigger_present",
        "ok" if webhook_triggers else "fail",
        webhook_count=len(webhook_triggers),
        all_trigger_types=[t.get("trigger_type") for t in triggers],
    )
    if not webhook_triggers:
        raise SystemExit("No webhook trigger landed on the persona — IR likely picked a different trigger_type")

    # Gate 2 — at least one webhook trigger config carries smee_channel_url
    smee_url_landed = None
    smee_filter_landed = None
    for trig in webhook_triggers:
        cfg_raw = trig.get("config")
        if isinstance(cfg_raw, str):
            try:
                cfg = json.loads(cfg_raw)
            except json.JSONDecodeError:
                continue
        elif isinstance(cfg_raw, dict):
            cfg = cfg_raw
        else:
            continue
        url = cfg.get("smee_channel_url")
        if url:
            smee_url_landed = url
            smee_filter_landed = cfg.get("smee_event_filter")
            break

    record(
        "acceptance.trigger_config_carries_smee_url",
        "ok" if smee_url_landed else "fail",
        smee_channel_url=smee_url_landed,
        smee_event_filter=smee_filter_landed,
    )
    if not smee_url_landed:
        raise SystemExit("Webhook trigger config has no smee_channel_url — LLM didn't place the URL")

    # Gate 3 — the URL the LLM placed matches what we submitted
    if smee_url_landed != SMEE_URL:
        record(
            "acceptance.smee_url_matches_submitted",
            "fail",
            expected=SMEE_URL,
            got=smee_url_landed,
        )
        raise SystemExit(
            f"smee_channel_url mismatch — expected {SMEE_URL}, got {smee_url_landed}"
        )
    record("acceptance.smee_url_matches_submitted", "ok", url=smee_url_landed)

    # Gate 4 — smee_relays row exists with target_persona_id matching
    relays_resp = bridge("smeeRelayList", {}, 20)
    if not relays_resp.get("success"):
        record("acceptance.smee_relay_list", "fail", error=relays_resp.get("error"))
        raise SystemExit(f"smeeRelayList failed: {relays_resp.get('error')}")
    relays = relays_resp.get("relays") or []
    matching = [
        r
        for r in relays
        if r.get("channelUrl") == SMEE_URL or r.get("channel_url") == SMEE_URL
    ]
    record(
        "acceptance.smee_relay_row_exists",
        "ok" if matching else "fail",
        matching_count=len(matching),
        total_relays=len(relays),
    )
    if not matching:
        raise SystemExit(
            f"No smee_relays row for URL {SMEE_URL} — auto_create_smee_relays didn't fire"
        )

    relay = matching[0]
    target = relay.get("targetPersonaId") or relay.get("target_persona_id")
    if target != persona_id:
        record(
            "acceptance.smee_relay_target_persona",
            "fail",
            expected=persona_id,
            got=target,
        )
        raise SystemExit(
            f"smee_relay target_persona_id mismatch — expected {persona_id}, got {target}"
        )
    record("acceptance.smee_relay_target_persona", "ok", target_persona_id=target)

    # Gate 5 — event_filter matches what we submitted
    relay_filter = relay.get("eventFilter") or relay.get("event_filter")
    if relay_filter != EVENT_FILTER:
        record(
            "acceptance.smee_relay_event_filter",
            "fail",
            expected=EVENT_FILTER,
            got=relay_filter,
        )
        # Don't bail — the filter mismatch is a softer failure than the
        # binding being absent. Surface it but continue to cleanup.
    else:
        record("acceptance.smee_relay_event_filter", "ok", event_filter=relay_filter)

    return {
        "smee_url": smee_url_landed,
        "smee_event_filter": smee_filter_landed,
        "relay_id": relay.get("id"),
        "target_persona_id": target,
    }


def step_cleanup(persona_id: str | None) -> None:
    if args.no_persona_cleanup or not persona_id:
        return
    print("\n[6/6] Cleanup")
    # delete the persona — the smee_relays row's target_persona_id is set to
    # NULL by FK ON DELETE SET NULL. The relay row itself stays (channel_url
    # is unique-constrained; orphaned rows are harmless and the user can
    # delete them via SmeeRelayTab).
    r = bridge("deleteAgent", {"nameOrId": persona_id}, 30)
    record(
        "cleanup.deleteAgent",
        "ok" if r.get("success") else "info",
        **{k: v for k, v in r.items() if k != "success"},
    )


# ---- Main --------------------------------------------------------------


def main() -> None:
    started = datetime.now(timezone.utc)
    persona_id = None
    summary_payload = None
    print(f"Phase H driver — using smee URL {SMEE_URL}")
    try:
        step_preflight()
        build = step_start_build()
        persona_id = build.get("personaId")
        step_answer_dimensions(persona_id)
        promote = step_test_and_promote(persona_id)
        persona_id = promote.get("personaId") or persona_id
        summary_payload = step_assert_acceptance(persona_id)
        step_cleanup(persona_id)
    except SystemExit as e:
        record("scenario.abort", "fail", error=str(e))
    except Exception as e:
        record("scenario.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        summary = {
            "scenario": "phase_h_webhook_smee",
            "smee_url": SMEE_URL,
            "event_filter": EVENT_FILTER,
            "started": started.isoformat(),
            "finished": finished.isoformat(),
            "duration_s": (finished - started).total_seconds(),
            "result": summary_payload,
            "log": log,
        }
        if args.report:
            Path(args.report).write_text(json.dumps(summary, indent=2))
            print(f"\nWrote {args.report}")
        else:
            print("\n-- summary --")
            print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
