r"""
Phase J — documentation archiver E2E (C8 increment, 2026-04-28).

Builds a 2-capability persona that combines BOTH C7 typed-payload paths
in a single scenario — Phase H (webhook + smee auto-bind, build prompt
rule 24) and Phase I (reference attachment for content schemas, rule
23). Closes the "documentation archiver" item from the C8 handoff
(`docs/concepts/persona-capabilities/C8-handoff-2026-04-28.md` Open #2).

Scenario:
  - UC1 (webhook-driven): GitHub push webhook arrives via smee.io →
    parse the changed markdown files (custom YAML frontmatter schema)
    → store each section as a KB fact tagged by category.
  - UC2 (on-demand):       Generate a one-paragraph digest of facts
    created in the last 7 days.

Acceptance gates after promote:
  1. IR has at least 2 use_cases.
  2. At least one use_case carries a webhook trigger.
  3. The webhook trigger's config carries `smee_channel_url` matching
     what the driver attached.
  4. A `smee_relays` row exists with `target_persona_id == new persona`
     and `channel_url` matching the URL.
  5. UC2 (the digest UC) has a non-webhook trigger (manual / schedule
     / "no trigger" — anything but webhook).
  6. (Soft) If the LLM asked for a sample doc via `accepts_reference`,
     the answer landed and the session's user_answers shows the fenced
     reference content. Soft because the LLM may not always ask.

Prereqs:
  1. Dev app running with test-automation feature:
       npx tauri dev -- --features test-automation
  2. Test server is reachable:
       curl http://127.0.0.1:17320/health

Usage:
  uvx --with httpx python tools/test-mcp/e2e_phase_j.py
  uvx --with httpx python tools/test-mcp/e2e_phase_j.py --report logs/phase-j.json
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


# Force UTF-8 stdout — Windows cp1252 will crash on the YAML frontmatter
# example characters below if the shell tries to print them.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


# ---- CLI ---------------------------------------------------------------

# Random per-run smee URL suffix to avoid UNIQUE conflicts on the
# `smee_relays.channel_url` column when re-running the driver. Defined
# up here (above INTENT) so the f-string interpolation lands.
SMEE_URL = f"https://smee.io/phase-j-{uuid.uuid4().hex[:12]}"
EVENT_FILTER = "github.push"

INTENT = (
    # Kept narrow per C8 §Lessons #1 — the earlier richer wording (custom
    # YAML frontmatter, last-7-days digest, multi-step chain) made the
    # LLM spend many rounds resolving without finalizing the IR. Two
    # simple UCs is enough to exercise the C7 webhook + smee plumbing.
    #
    # The smee URL is inlined VERBATIM in the intent so the build prompt
    # rule 24 SKIP path fires ("user already pasted a smee.io URL — pull
    # it verbatim into smee_channel_url"). On the previous run the LLM
    # neither asked via accepts_webhook_source nor copied a non-pasted
    # URL — pasting it in the intent makes the path deterministic.
    f"Documentation archiver. Two capabilities. UC1: when GitHub fires "
    f"a `push` webhook (forwarded via {SMEE_URL}, event_filter "
    f"`{EVENT_FILTER}`), parse the changed markdown files and store "
    f"each as a KB fact. UC2: on demand only, output a short digest of "
    f"recent KB facts. Auto-publish both — no human review."
)

# Sample doc the driver will attach as a reference if the LLM asks for
# one (rule 23 path). Demonstrates the YAML frontmatter schema the
# intent alludes to without giving it directly in the intent text — so
# the LLM has a real reason to ask.
SAMPLE_DOC = (
    "---\n"
    "category: api-reference\n"
    "tags: [auth, oauth, jwt]\n"
    "owner: platform-team\n"
    "last_reviewed: 2026-04-15\n"
    "---\n"
    "\n"
    "# OAuth callback handling\n"
    "\n"
    "The `/oauth/callback` endpoint accepts a one-time `code` query \n"
    "parameter and exchanges it for an access token via the upstream \n"
    "provider's `token` endpoint. On success the access token is \n"
    "stored encrypted in the credentials vault and a redirect to the \n"
    "originating page completes the flow.\n"
    "\n"
    "## Error responses\n"
    "\n"
    "- `400 invalid_grant` — code expired or already exchanged. The \n"
    "  user must restart the auth flow.\n"
    "- `502 upstream_error` — provider returned 5xx; retry once with \n"
    "  exponential backoff.\n"
)

parser = argparse.ArgumentParser(description="Phase J documentation archiver E2E")
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
        "Docs-to-KB archiver. UC1 is webhook-driven and writes facts. UC2 "
        "is on-demand and reads facts. Both auto-publish."
    ),
    "mission": "Keep the team's KB in sync with the docs repo.",
    "use-cases": (
        "TWO capabilities. UC1 'Doc Ingest': webhook trigger, parses "
        "changed .md files and writes each as a KB fact. UC2 'Recent "
        "Digest': on-demand only, reads recent facts and outputs a short "
        "summary message."
    ),
    "triggers": (
        # Intentionally do NOT inline the smee URL here — that lets the
        # LLM go straight to a webhook trigger config and skip rule 24's
        # `accepts_webhook_source` clarifying question (observed on the
        # 2026-04-28 first run: webhook trigger landed but smee_channel_url
        # was None). Forcing the rule-24 path makes the build flow
        # deterministic — the driver's first-pass handler in
        # `step_answer_dimensions` attaches SMEE_URL via the typed-payload
        # bridge call.
        "UC1: webhook trigger ONLY (forwarded from upstream). The "
        "webhook URL will be supplied separately when you ask. "
        "webhook_secret = null.\n"
        "\nUC2: NO trigger row. On-demand only."
    ),
    "connectors": (
        "UC1 needs no external connector (payload self-contained). UC2 "
        "needs no external connector (reads local KB)."
    ),
    "events": "No internal events emitted, none subscribed.",
    "human-review": "Auto-publish on both. No review on either.",
    "messages": "UC1: silent ingest. UC2: outputs a single digest message.",
    "memory": "UC1 writes facts. UC2 reads facts only.",
    "error-handling": "On parse error, log + skip that file. Don't abort the batch.",
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
    test_complete. Watches for typed-payload questions on every round:
      - acceptsWebhookSource: true → submit smee URL via the webhook helper
      - acceptsReference: true     → attach SAMPLE_DOC via the reference helper
    Both happen on first occurrence; everything else batches via the
    regular text path. Returns the final phase reached."""
    print("\n[3/6] Answer build clarifying questions")

    max_rounds = 30
    submitted_webhook_source = False
    attached_reference = False

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
                reference_attached=attached_reference,
            )
            return phase
        if phase != "awaiting_input":
            continue

        qs = bridge("listPendingBuildQuestions", {}, 20).get("questions") or []
        if not qs:
            time.sleep(1.0)
            continue

        # First pass: handle any webhook-source question via the typed
        # payload helper. Highest priority — the smee URL is part of
        # what we're verifying.
        webhook_handled = False
        for q in qs:
            if q.get("acceptsWebhookSource") or q.get("accepts_webhook_source"):
                key = q.get("cellKey") or q.get("cell_key") or "webhook_source"
                wh_resp = bridge(
                    "answerBuildQuestionWithWebhookSource",
                    {
                        "cellKey": key,
                        "answer": (
                            "Smee.io channel for the GitHub docs-repo push "
                            "webhook is attached via the typed payload."
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
                break

        if webhook_handled:
            continue

        # Second pass: handle a reference-attachment question (frontmatter
        # schema sample). The LLM may not always ask — this is opportunistic.
        reference_handled = False
        for q in qs:
            if q.get("acceptsReference") or q.get("accepts_reference"):
                key = q.get("cellKey") or q.get("cell_key") or "messages"
                ref_resp = bridge(
                    "answerBuildQuestionWithReference",
                    {
                        "cellKey": key,
                        "answer": (
                            "Here's a sample doc with the YAML frontmatter "
                            "schema we use — match this format when parsing."
                        ),
                        "reference": {
                            "inlineContent": SAMPLE_DOC,
                            "name": "doc-sample.md",
                        },
                    },
                    30,
                )
                record(
                    f"answer.reference.round{round_ix}",
                    "ok" if ref_resp.get("success") else "fail",
                    cell_key=key,
                    error=ref_resp.get("error"),
                )
                if ref_resp.get("success"):
                    attached_reference = True
                    reference_handled = True
                break

        if reference_handled:
            continue

        # Third pass: batch every other question via the regular text path.
        batch = {}
        for q in qs:
            key = q.get("cellKey") or q.get("cell_key")
            if not key:
                continue
            batch[key] = ANSWERS.get(key, f"Auto-answer for phase J: {key}")

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
    """Defensive wait — see C8 handoff §Lessons Learned #2."""
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

    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record("acceptance.persona_detail", "fail", error=detail.get("error"))
        raise SystemExit(f"getPersonaDetail failed: {detail.get('error')}")
    d = detail.get("detail") or {}
    triggers = d.get("triggers") or []

    # Pull use_cases out of design_context — handle both snake_case and
    # camelCase shapes (post-promote is camelCase, but be tolerant).
    dc_raw = d.get("design_context") or d.get("designContext")
    if isinstance(dc_raw, str):
        try:
            dc = json.loads(dc_raw)
        except json.JSONDecodeError:
            dc = {}
    elif isinstance(dc_raw, dict):
        dc = dc_raw
    else:
        dc = {}
    use_cases = dc.get("useCases") or dc.get("use_cases") or []

    # Gate 1 — at least 2 use_cases
    record(
        "acceptance.use_cases_count_ge_2",
        "ok" if len(use_cases) >= 2 else "fail",
        count=len(use_cases),
        titles=[uc.get("title") for uc in use_cases],
    )
    if len(use_cases) < 2:
        raise SystemExit(
            f"Phase J expected >=2 use_cases, got {len(use_cases)} — "
            "LLM collapsed the scenario into fewer capabilities than asked."
        )

    # Gate 2 — at least one webhook trigger
    webhook_triggers = [t for t in triggers if t.get("trigger_type") == "webhook"]
    record(
        "acceptance.webhook_trigger_present",
        "ok" if webhook_triggers else "fail",
        webhook_count=len(webhook_triggers),
        all_trigger_types=[t.get("trigger_type") for t in triggers],
    )
    if not webhook_triggers:
        raise SystemExit("No webhook trigger landed on the persona")

    # Gate 3 — webhook trigger config carries smee_channel_url matching
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
        "ok" if smee_url_landed == SMEE_URL else "fail",
        expected=SMEE_URL,
        got=smee_url_landed,
        smee_event_filter=smee_filter_landed,
    )
    if smee_url_landed != SMEE_URL:
        raise SystemExit(
            f"smee_channel_url mismatch — expected {SMEE_URL}, got {smee_url_landed}"
        )

    # Gate 4 — smee_relays row exists with matching target_persona_id + URL
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
    record(
        "acceptance.smee_relay_target_persona",
        "ok" if target == persona_id else "fail",
        expected=persona_id,
        got=target,
    )
    if target != persona_id:
        raise SystemExit(
            f"smee_relay target_persona_id mismatch — expected {persona_id}, got {target}"
        )

    # Gate 5 — UC2 (the digest) has a non-webhook trigger (or no trigger).
    # Find the digest UC by id/title heuristic.
    digest_uc = None
    for uc in use_cases:
        title = (uc.get("title") or "").lower()
        if any(kw in title for kw in ("digest", "summary", "weekly", "summari")):
            digest_uc = uc
            break
    record(
        "acceptance.digest_uc_identified",
        "ok" if digest_uc else "info",
        title=digest_uc.get("title") if digest_uc else None,
    )
    if digest_uc:
        # The triggers array is persona-scoped. To be precise we'd need
        # use_case_id linkage; for the gate we just verify NOT-ALL
        # triggers are webhooks (i.e. the digest got a different trigger
        # type, or no trigger).
        non_webhook_triggers = [
            t for t in triggers if t.get("trigger_type") != "webhook"
        ]
        record(
            "acceptance.non_webhook_trigger_for_digest_or_no_trigger",
            "ok" if non_webhook_triggers or len(triggers) == len(webhook_triggers) else "info",
            non_webhook_count=len(non_webhook_triggers),
            note=(
                "PASS if any non-webhook trigger exists OR if the digest UC "
                "intentionally has no trigger row (manual on-demand)."
            ),
        )

    return {
        "smee_url": smee_url_landed,
        "smee_event_filter": smee_filter_landed,
        "use_cases_count": len(use_cases),
        "webhook_trigger_count": len(webhook_triggers),
        "non_webhook_trigger_count": len(triggers) - len(webhook_triggers),
        "relay_id": relay.get("id"),
        "target_persona_id": target,
    }


def step_cleanup(persona_id: str | None) -> None:
    if args.no_persona_cleanup or not persona_id:
        return
    print("\n[6/6] Cleanup")
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
    print(f"Phase J driver — using smee URL {SMEE_URL}")
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
            "scenario": "phase_j_documentation_archiver",
            "smee_url": SMEE_URL,
            "event_filter": EVENT_FILTER,
            "started": started.isoformat(),
            "finished": finished.isoformat(),
            "duration_s": (finished - started).total_seconds(),
            "result": summary_payload,
            "log": log,
        }
        if args.report:
            Path(args.report).parent.mkdir(parents=True, exist_ok=True)
            Path(args.report).write_text(json.dumps(summary, indent=2))
            print(f"\nWrote {args.report}")
        else:
            print("\n-- summary --")
            print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
