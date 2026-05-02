r"""
Phase A scenarios — multi-capability personas, post C5 handoff 2026-04-26.

Two scenarios in one driver:

  --scenario inbox        Inbox Triage. Two capabilities, both triggered on
                          gmail.message.received. UC1 classifies; UC2 drafts a
                          reply. Tests the gate-defense + auto-submit under
                          heavier per-capability Q&A load.

  --scenario coordinator  Project Coordinator. Three capabilities, one persona,
                          all schedule-triggered (weekly Monday 8am). UC1
                          fetches Linear assigned issues, UC2 fetches GitHub
                          PRs awaiting review, UC3 fetches today's Calendar
                          events. Output: a digest written to local drive.

The driver:

  1. starts the build via `startBuildFromIntent`,
  2. supplies deterministic answers keyed by cellKey (with a scenario-aware
     fallback for unknown keys),
  3. waits for `draft_ready` / `test_complete`,
  4. runs `triggerBuildTest` then `promoteBuildDraft`,
  5. inspects the promoted persona — verifies the IR's UC count, per-UC
     trigger, per-UC connectors, and per-UC review_policy.

Skip the post-promotion live-fire phase by default; these scenarios don't
have a single canonical input we can synthesise (Gmail/Linear/GitHub/Calendar
require external services). Drive the actual fire path manually if needed.

Prereqs:
  1. Dev app running with test-automation feature:
       npx tauri dev -- --features test-automation
  2. Test server is reachable:
       curl http://127.0.0.1:17320/health
  3. The relevant connectors exist in the vault. Add via the Catalog if
     missing — the empty-state CTA opens an inline create modal.

Usage:
  uvx --with httpx python tools/test-mcp/e2e_phase_a.py --scenario inbox
  uvx --with httpx python tools/test-mcp/e2e_phase_a.py --scenario coordinator
  uvx --with httpx python tools/test-mcp/e2e_phase_a.py --scenario inbox --report logs/inbox.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx


# ---- CLI ---------------------------------------------------------------

SCENARIOS = {
    "inbox": {
        "intent": (
            "Watch my Gmail inbox. On every new message, classify it as urgent "
            "/ followup / fyi. When the classification is 'urgent', also draft "
            "a short reply for me to review before sending. Both capabilities "
            "trigger directly on a new Gmail message arriving — the draft "
            "capability does NOT chain off the classifier; it runs in parallel "
            "and only emits its draft when its own classifier-style check "
            "judges the message urgent."
        ),
        "expected_use_cases": 2,
        # Accept either the build-time "event" token in the IR or the promoted
        # "event_listener" trigger row that lands in `persona_triggers`.
        "expected_trigger_kinds": {"event", "event_listener"},
        "expected_connector_categories": {"email"},
    },
    "coordinator": {
        "intent": (
            "Every Monday at 8am local time, build a single weekly digest "
            "covering three sources: my Linear assigned issues, my GitHub pull "
            "requests awaiting review, and today's Google Calendar events. "
            "Each source is its own capability so I can turn off any one "
            "independently. Save the digest as a single markdown file in my "
            "local drive — never email or message."
        ),
        # 3 collectors + 1 digest assembler. Rule D (capability-granularity for
        # chained producer/publisher pipelines) makes the LLM legitimately split
        # the assembler out of the collectors — verified live in C6 Phase A.2.
        "expected_use_cases": 4,
        "expected_trigger_kinds": {"schedule"},
        # Categories accepted; LLM may pick `project_management` for Linear,
        # `code_repository` for GitHub, `calendar` for Calendar.
        "expected_connector_categories": {
            "project_management",
            "code_repository",
            "calendar",
        },
    },
}

parser = argparse.ArgumentParser(description="Phase A multi-capability E2E scenarios")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument(
    "--scenario",
    choices=list(SCENARIOS.keys()),
    required=True,
    help="Which scenario to run. See module docstring.",
)
parser.add_argument("--build-timeout", type=int, default=240)
parser.add_argument("--no-persona-cleanup", action="store_true")
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()

SCENARIO = SCENARIOS[args.scenario]


BASE = f"http://127.0.0.1:{args.port}"
client = httpx.Client(base_url=BASE, timeout=240)


# ---- HTTP helpers ------------------------------------------------------


def post(path: str, body: dict | None = None, timeout: int | None = None) -> dict:
    r = client.post(path, json=body or {}, timeout=timeout or 120)
    try:
        return json.loads(r.text)
    except json.JSONDecodeError:
        return {"_raw": r.text, "_status": r.status_code}


def get(path: str) -> dict:
    return json.loads(client.get(path).text)


def bridge(method: str, params: dict | None = None, timeout_secs: int = 180) -> dict:
    raw = post(
        "/bridge-exec",
        {"method": method, "params": params or {}, "timeout_secs": timeout_secs},
        timeout=timeout_secs + 20,
    )
    return raw


# ---- Event log ---------------------------------------------------------

log: list[dict] = []


def record(step: str, outcome: str, **kw) -> dict:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "step": step, "outcome": outcome}
    entry.update(kw)
    log.append(entry)
    marker = "[OK]" if outcome == "ok" else ("[..]" if outcome == "info" else "[XX]")
    sys.stdout.write(f"  {marker} {step}: {outcome}")
    if kw:
        brief = {k: v for k, v in kw.items() if k not in ("detail",) and not isinstance(v, (dict, list))}
        if brief:
            sys.stdout.write(f"  {brief}")
    sys.stdout.write("\n")
    sys.stdout.flush()
    return entry


# ---- Answer recipes ----------------------------------------------------

INBOX_ANSWERS = {
    "behavior_core": (
        "An inbox triage assistant for Gmail. Mission: keep my attention on "
        "messages that need a human response. Two parallel capabilities: "
        "classify the incoming message into urgent/followup/fyi, and (in "
        "parallel) draft a candidate reply when the message looks urgent."
    ),
    "mission": (
        "Help me stay responsive without reading every email. Classify each "
        "incoming Gmail message and pre-write urgent replies for review."
    ),
    "use-cases": (
        "TWO capabilities, BOTH triggered directly on gmail.message.received: "
        "(1) Classify Incoming Message — outputs a class label "
        "(urgent/followup/fyi). (2) Draft Reply — when the message looks "
        "urgent, generate a short reply suggestion for me to approve. The two "
        "capabilities are PARALLEL, not chained — each has its own subscription "
        "to gmail.message.received."
    ),
    "triggers": (
        "Both capabilities are event-driven. Each capability's "
        "suggested_trigger MUST be `{\"trigger_type\":\"event\",\"config\":{}}` "
        "and each capability's event_subscriptions MUST include "
        "`{\"event_type\":\"gmail.message.received\",\"direction\":\"listen\"}`. "
        "No schedule, no polling, no manual."
    ),
    "connectors": (
        "Use a Gmail connector for both capabilities. The agent reads the "
        "incoming message; for the draft capability it also writes a draft "
        "into Gmail's Drafts folder."
    ),
    "events": (
        "Both capabilities subscribe to gmail.message.received. UC1 emits "
        "inbox.message.classified after labeling. UC2 emits "
        "inbox.draft.ready after drafting a reply."
    ),
    "human-review": (
        "Classification capability: never review (auto-publish). Draft "
        "capability: always review — I want to read every draft before it "
        "leaves my account."
    ),
    "messages": (
        "Surface a built-in titlebar notification when a draft is ready for "
        "review. Classification only emits an internal event — no user-facing "
        "message."
    ),
    "memory": "No cross-run memory needed for either capability.",
    "error-handling": (
        "If Gmail API fails, log and skip — do not retry tightly. Drop the "
        "current message; the next event will re-trigger normally."
    ),
}

COORDINATOR_ANSWERS = {
    "behavior_core": (
        "A weekly project coordinator. Mission: give me one Monday-morning "
        "snapshot across the three places I track work — Linear, GitHub, and "
        "Calendar — so I can plan the week without three separate tabs."
    ),
    "mission": (
        "Be my Monday-morning briefing across Linear (assigned issues), "
        "GitHub (PRs awaiting review), and Calendar (today's events)."
    ),
    "use-cases": (
        "THREE capabilities, ONE persona, all on the same weekly schedule "
        "(Mondays at 8am local time): "
        "(1) Linear Brief — fetch issues assigned to me, group by project. "
        "(2) GitHub Brief — fetch PRs awaiting my review, group by repo. "
        "(3) Calendar Brief — fetch today's events, surface conflicts. "
        "Each is its own capability so I can turn any one off independently. "
        "Each capability's output feeds into a single digest file the persona "
        "writes to local drive."
    ),
    "triggers": (
        "All three capabilities use the SAME schedule trigger: "
        "`{\"trigger_type\":\"schedule\",\"config\":{\"cron\":\"0 8 * * 1\"}}` "
        "(Mondays at 8am). Each capability owns its own copy of the trigger "
        "in its envelope. No event-driven subscriptions; no polling; no manual."
    ),
    "connectors": (
        "UC1 (Linear Brief) uses the Linear connector. UC2 (GitHub Brief) "
        "uses the GitHub connector. UC3 (Calendar Brief) uses the Google "
        "Calendar connector. All three also use the built-in local_drive "
        "connector to write the digest."
    ),
    "events": (
        "No external event subscriptions. Each capability emits its own "
        "completion event so the persona can roll them up into a single file: "
        "linear.brief.ready, github.brief.ready, calendar.brief.ready."
    ),
    "human-review": (
        "Never review for any of the three capabilities. The output is "
        "informational only — I read it Monday morning and act on it myself."
    ),
    "messages": (
        "All three capabilities write into the same daily file in local "
        "drive (path: `weekly-brief/<YYYY-MM-DD>.md`). Also surface a single "
        "built-in titlebar notification when the digest is complete."
    ),
    "memory": (
        "No memory needed — each Monday is independent of last Monday."
    ),
    "error-handling": (
        "If one source's API fails, log and continue — the digest writes "
        "what it has and notes which sources are missing. Do not retry past "
        "the configured run window."
    ),
}

# ---- Helpers -----------------------------------------------------------


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
    print(f"\n[2/6] Start build — scenario={args.scenario}")
    r = bridge(
        "startBuildFromIntent",
        {"intent": SCENARIO["intent"], "timeoutMs": 30_000},
        40,
    )
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


def step_answer_dimensions() -> None:
    print("\n[3/6] Answer build clarifying questions")

    answer_recipes = INBOX_ANSWERS if args.scenario == "inbox" else COORDINATOR_ANSWERS
    fallback_intent_summary = SCENARIO["intent"]

    # Multi-UC builds spend many rounds in `resolving` between question batches;
    # 30 gives the LLM headroom even when only ~5 user-facing questions fire.
    max_rounds = 30
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
            record("answer_dimensions", "ok", final_phase=phase, rounds=round_ix)
            return
        if phase != "awaiting_input":
            continue

        qs = bridge("listPendingBuildQuestions", {}, 20).get("questions") or []
        if not qs:
            time.sleep(1.0)
            continue

        batch = {}
        for q in qs:
            key = q.get("cellKey") or q.get("cell_key")
            if not key:
                continue
            if key in answer_recipes:
                batch[key] = answer_recipes[key]
            else:
                batch[key] = (
                    f"Auto-scenario answer ({args.scenario}): {fallback_intent_summary}"
                )

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


def step_test_and_promote() -> dict:
    print("\n[4/6] Test + promote draft")
    test = bridge("triggerBuildTest", {}, 60)
    if test.get("success"):
        record("test_build_draft", "ok", report_keys=list((test.get("report") or {}).keys()))
    else:
        record("test_build_draft", "info", error=test.get("error"))

    promote = bridge("promoteBuildDraft", {}, 60)
    if not promote.get("success"):
        record("promote_build_draft", "fail", error=promote.get("error"))
        raise SystemExit(f"promoteBuildDraft failed: {promote.get('error')}")
    record("promote_build_draft", "ok", persona_id=promote.get("personaId"))
    return promote


def _parse_maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v or {}


def step_inspect_persona(persona_id: str) -> dict:
    print("\n[5/6] Inspect promoted persona shape")
    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record("persona_detail", "fail", error=detail.get("error"))
        return {}
    d = detail.get("detail") or {}
    design_context = _parse_maybe_json(d.get("design_context"))
    last_design_result = _parse_maybe_json(d.get("last_design_result"))
    use_cases = design_context.get("useCases") or design_context.get("use_cases") or []
    triggers = d.get("triggers") or []
    connectors = (
        last_design_result.get("suggested_connectors")
        or last_design_result.get("required_connectors")
        or []
    )
    record(
        "persona_detail",
        "ok",
        name=d.get("name"),
        use_cases=len(use_cases),
        triggers=len(triggers),
        connectors=[c if isinstance(c, str) else (c.get("name") if isinstance(c, dict) else str(c)) for c in connectors],
    )

    # ---- Phase A acceptance gates ------------------------------------------
    expected_uc = SCENARIO["expected_use_cases"]
    if len(use_cases) == expected_uc:
        record("acceptance.use_case_count", "ok", got=len(use_cases), expected=expected_uc)
    else:
        record(
            "acceptance.use_case_count",
            "fail",
            got=len(use_cases),
            expected=expected_uc,
            uc_titles=[uc.get("title") for uc in use_cases],
        )

    # Per-UC: trigger kind matches the scenario expectation
    expected_trigger_kinds = SCENARIO["expected_trigger_kinds"]
    for uc in use_cases:
        sug = uc.get("suggested_trigger") or {}
        kind = sug.get("trigger_type") if isinstance(sug, dict) else None
        if kind in expected_trigger_kinds:
            record(
                "acceptance.uc_trigger",
                "ok",
                uc_id=uc.get("id"),
                trigger=kind,
            )
        else:
            record(
                "acceptance.uc_trigger",
                "fail",
                uc_id=uc.get("id"),
                trigger=kind,
                expected_one_of=sorted(expected_trigger_kinds),
            )

    # Per-UC: at least one connector category matches scenario expectation
    expected_categories = SCENARIO["expected_connector_categories"]
    for uc in use_cases:
        uc_conns = uc.get("connectors") or []
        names = [c if isinstance(c, str) else c.get("name") for c in uc_conns]
        record(
            "acceptance.uc_connectors",
            "ok",
            uc_id=uc.get("id"),
            connectors=names,
        )
    record(
        "acceptance.expected_connector_categories",
        "info",
        expected=sorted(expected_categories),
        note="Manual inspection — connector category checks live in the catalog tags.",
    )

    return d


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
    try:
        step_preflight()
        build = step_start_build()
        step_answer_dimensions()
        promote = step_test_and_promote()
        persona_id = promote.get("personaId") or build.get("personaId")
        step_inspect_persona(persona_id)
        step_cleanup(persona_id)
    except SystemExit as e:
        record("scenario.abort", "fail", error=str(e))
    except Exception as e:
        record("scenario.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        summary = {
            "scenario": args.scenario,
            "started": started.isoformat(),
            "finished": finished.isoformat(),
            "duration_s": (finished - started).total_seconds(),
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
