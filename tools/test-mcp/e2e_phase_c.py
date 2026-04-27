r"""
Phase C — output diversity. Every Phase A/B scenario has been writing to
local drive; this driver exercises the four other write paths flagged in
C5-handoff-2026-04-26 §"Recommended scenarios for the next session" Phase C:

  --scenario vector_db   Index a daily summary into the `personas_vector_db`
                         knowledge base. Built-in, no external credential.

  --scenario notion      Append a page to a Notion workspace via the user's
                         Notion connector.

  --scenario github      File an issue into a GitHub repo via the user's
                         GitHub connector.

  --scenario titlebar    Surface a desktop / titlebar notification (the
                         built-in `titlebar` channel) — no external connector.

Each scenario builds a one-capability, schedule-triggered persona, drives
the build via the same answer-loop pattern as Phase A, promotes, and then
inspects the IR/persona for the expected output wiring. Live execution is
left manual — these write targets either need real credentials at runtime
(notion, github) or change observable side-effects (vector_db, titlebar)
that aren't worth automating.

Prereqs:
  1. Dev app running:  npx tauri dev -- --features test-automation
  2. Vault contains the connector for the chosen scenario (notion, github)
     — the driver passes `--no-cleanup` by default so you can poke the
     persona afterwards.

Usage:
  python tools/test-mcp/e2e_phase_c.py --scenario vector_db --report logs/phase-c-vector_db.json
  python tools/test-mcp/e2e_phase_c.py --scenario notion    --report logs/phase-c-notion.json
  python tools/test-mcp/e2e_phase_c.py --scenario github    --report logs/phase-c-github.json
  python tools/test-mcp/e2e_phase_c.py --scenario titlebar  --report logs/phase-c-titlebar.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx


# ---- Scenario definitions ---------------------------------------------

SCENARIOS = {
    "vector_db": {
        "intent": (
            "Once a day at 8am, write a one-paragraph summary of yesterday's "
            "activity into my built-in vector knowledge base so I can search "
            "across past days later. Single capability, schedule-triggered. "
            "Output target: `personas_vector_db` connector — index the "
            "summary as a single document with date as the title."
        ),
        "answers": {
            "behavior_core": (
                "A daily journaling agent. Mission: keep a searchable "
                "knowledge base of what I did each day."
            ),
            "mission": (
                "Write one paragraph per day summarising activity, indexed "
                "into the local vector knowledge base."
            ),
            "use-cases": (
                "ONE capability: 'Daily KB Snapshot'. Schedule-triggered "
                "(8am daily). Writes ONE document per run into the "
                "`personas_vector_db` connector — title is the ISO date, "
                "body is the one-paragraph summary."
            ),
            "triggers": (
                "Schedule trigger only: "
                "`{\"trigger_type\":\"schedule\",\"config\":{\"cron\":\"0 8 * * *\"}}`."
            ),
            "connectors": (
                "Use the built-in `personas_vector_db` connector. The agent "
                "calls vector_index_upsert (or the equivalent KB write tool) "
                "with the date as the document id and the summary as the body."
            ),
            "events": (
                "No external subscriptions. Emit `journal.day.indexed` "
                "after each successful write."
            ),
            "human-review": "Never review — auto-publish to KB.",
            "messages": (
                "No user-facing messages — the KB write IS the output. Do "
                "NOT use notification_channels."
            ),
            "memory": (
                "Memory disabled. Each day stands alone in the KB."
            ),
            "error-handling": (
                "If vector_index_upsert fails, log and skip — tomorrow's run "
                "writes a fresh entry. Do NOT retry."
            ),
        },
        "expected": {
            "connector_substrings": ["vector"],
            "tool_substrings": ["vector", "kb", "index"],
            "channel_substrings": [],
        },
    },
    "notion": {
        "intent": (
            "Every morning at 9am, append a status page to my Notion workspace "
            "summarising overnight activity. Single capability, schedule-"
            "triggered. Output target: Notion — create one new page per run "
            "in a configured database."
        ),
        "answers": {
            "behavior_core": (
                "A Notion status-page poster. Mission: keep a daily log in "
                "Notion of what happened overnight."
            ),
            "mission": (
                "Post one Notion page per morning summarising overnight "
                "activity."
            ),
            "use-cases": (
                "ONE capability: 'Morning Notion Brief'. Schedule-triggered "
                "(9am daily). Writes ONE page per run to a Notion database. "
                "The page title is the ISO date; body is the summary."
            ),
            "triggers": (
                "Schedule trigger only: "
                "`{\"trigger_type\":\"schedule\",\"config\":{\"cron\":\"0 9 * * *\"}}`."
            ),
            "connectors": (
                "Use the user's Notion connector. The agent calls a Notion "
                "page-create tool (notion_create_page or similar). Pick the "
                "Notion entry from the vault."
            ),
            "events": "No external subscriptions; no inbound listens.",
            "human-review": "Never review — auto-publish to Notion.",
            "messages": (
                "No notification channels — the Notion page IS the user-"
                "facing output."
            ),
            "memory": "No memory — each morning is independent.",
            "error-handling": (
                "If Notion create fails, log and skip — tomorrow's run "
                "produces a fresh page. Do NOT retry within the same run."
            ),
        },
        "expected": {
            "connector_substrings": ["notion"],
            "tool_substrings": ["notion"],
            "channel_substrings": [],
        },
    },
    "github": {
        "intent": (
            "Every Monday at 7am, file a single GitHub issue summarising "
            "weekly priorities into a configured repo. Single capability, "
            "schedule-triggered. Output target: GitHub — issue creation."
        ),
        "answers": {
            "behavior_core": (
                "A weekly GitHub issue filer. Mission: open one tracking "
                "issue per Monday so the team has a single thread for "
                "weekly priorities."
            ),
            "mission": (
                "File one GitHub issue per Monday containing the week's "
                "priorities."
            ),
            "use-cases": (
                "ONE capability: 'Weekly Priorities Issue'. Schedule-"
                "triggered (Monday 7am). Creates ONE GitHub issue per run "
                "via the user's GitHub connector. Title format: "
                "'Week of YYYY-MM-DD'."
            ),
            "triggers": (
                "Schedule trigger only: "
                "`{\"trigger_type\":\"schedule\",\"config\":{\"cron\":\"0 7 * * 1\"}}` "
                "(Mondays at 7am)."
            ),
            "connectors": (
                "Use the user's GitHub connector. The agent calls "
                "github_create_issue (or equivalent) on a configured repo."
            ),
            "events": "No external subscriptions; no inbound listens.",
            "human-review": "Never review — auto-publish to GitHub.",
            "messages": (
                "No notification_channels — the GitHub issue IS the output."
            ),
            "memory": "No memory — each Monday is independent.",
            "error-handling": (
                "If issue creation fails (rate limit, auth, network), log "
                "and skip — next Monday's run will produce a fresh issue."
            ),
        },
        "expected": {
            "connector_substrings": ["github"],
            "tool_substrings": ["github", "issue"],
            "channel_substrings": [],
        },
    },
    "titlebar": {
        "intent": (
            "Every hour on the hour, surface a desktop / titlebar "
            "notification with a single-sentence status update — NO file "
            "writes, NO event emissions, NO external connector. Just a "
            "notification."
        ),
        "answers": {
            "behavior_core": (
                "A heartbeat notifier. Mission: surface a tiny status "
                "notification once an hour so I know the agent is alive."
            ),
            "mission": (
                "Surface a once-an-hour titlebar notification with a "
                "status sentence."
            ),
            "use-cases": (
                "ONE capability: 'Hourly Heartbeat'. Schedule-triggered "
                "(hourly). Output is ONLY a built-in titlebar notification "
                "(notification_channels = [{channel: 'titlebar', target: "
                "'self', format: 'text'}]). No file write, no event emit, "
                "no external connector."
            ),
            "triggers": (
                "Schedule trigger: "
                "`{\"trigger_type\":\"schedule\",\"config\":{\"cron\":\"0 * * * *\"}}` "
                "(every hour on the hour)."
            ),
            "connectors": (
                "NO external connectors required. The agent uses ONLY the "
                "built-in titlebar notification channel."
            ),
            "events": "No subscriptions and no emits.",
            "human-review": "Never review.",
            "messages": (
                "Set notification_channels for this capability to a single "
                "entry: `[{\"channel\":\"titlebar\",\"target\":\"self\","
                "\"format\":\"text\"}]`. The titlebar IS the output."
            ),
            "memory": "No memory.",
            "error-handling": "If the channel emit fails, log and skip.",
        },
        "expected": {
            "connector_substrings": [],
            "tool_substrings": [],
            "channel_substrings": ["titlebar"],
        },
    },
}


# ---- CLI ---------------------------------------------------------------

parser = argparse.ArgumentParser(description="Phase C output diversity E2E")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument(
    "--scenario",
    choices=list(SCENARIOS.keys()),
    required=True,
)
parser.add_argument("--build-timeout", type=int, default=240)
parser.add_argument("--no-cleanup", action="store_true", default=True,
                    help="Default ON — Phase C personas are kept for inspection.")
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
        brief = {k: v for k, v in kw.items() if k not in ("detail",) and not isinstance(v, (dict, list))}
        if brief:
            sys.stdout.write(f"  {brief}")
    sys.stdout.write("\n")
    sys.stdout.flush()
    return entry


def _parse_maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v or {}


# ---- Steps -------------------------------------------------------------


def step_preflight() -> None:
    print("\n[1/5] Preflight")
    try:
        h = get("/health")
    except Exception as e:
        record("preflight.health", "fail", error=str(e))
        raise SystemExit("Test-automation server not responding.") from e
    record("preflight.health", "ok", server=h.get("server"), version=h.get("version"))


def step_start_build() -> dict:
    print(f"\n[2/5] Start build — scenario={args.scenario}")
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
    print("\n[3/5] Answer build clarifying questions")
    answers = SCENARIO["answers"]
    fallback = SCENARIO["intent"]
    max_rounds = 40
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
            batch[key] = answers.get(
                key, f"Auto-scenario answer ({args.scenario}): {fallback}"
            )
        if not batch:
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
            raise SystemExit(
                f"answerPendingBuildQuestions failed: {submit.get('error')}"
            )
    raise SystemExit(f"Exceeded max rounds ({max_rounds})")


def step_test_and_promote() -> dict:
    print("\n[4/5] Test + promote")
    test = bridge("triggerBuildTest", {}, 60)
    record(
        "test_build_draft",
        "ok" if test.get("success") else "info",
        error=test.get("error"),
    )
    promote = bridge("promoteBuildDraft", {}, 90)
    if not promote.get("success"):
        record("promote_build_draft", "fail", error=promote.get("error"))
        raise SystemExit(f"promoteBuildDraft failed: {promote.get('error')}")
    record("promote_build_draft", "ok", persona_id=promote.get("personaId"))
    return promote


def step_inspect_persona(persona_id: str) -> dict:
    print("\n[5/5] Inspect promoted persona shape")
    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record("persona_detail", "fail", error=detail.get("error"))
        return {}
    d = detail.get("detail") or {}
    dc = _parse_maybe_json(d.get("design_context"))
    last_design_result = _parse_maybe_json(d.get("last_design_result"))
    ucs = dc.get("useCases") or dc.get("use_cases") or []
    triggers = d.get("triggers") or []

    # Flatten connectors / tool names / channels from both persona-level and per-UC
    # locations.
    persona_connectors = (
        last_design_result.get("suggested_connectors")
        or last_design_result.get("required_connectors")
        or []
    )
    connector_names: list[str] = []
    for c in persona_connectors:
        n = c if isinstance(c, str) else (c.get("name") if isinstance(c, dict) else None)
        if n:
            connector_names.append(n.lower())
    for uc in ucs:
        for c in uc.get("connectors") or []:
            n = c if isinstance(c, str) else (c.get("name") if isinstance(c, dict) else None)
            if n:
                connector_names.append(n.lower())

    tool_rows = d.get("tools") or last_design_result.get("suggested_tools") or []
    tool_names: list[str] = []
    for t in tool_rows:
        n = t if isinstance(t, str) else (t.get("name") if isinstance(t, dict) else None)
        if n:
            tool_names.append(n.lower())

    channel_strings: list[str] = []
    nc = d.get("notification_channels")
    if isinstance(nc, str):
        try:
            nc = json.loads(nc)
        except Exception:
            nc = None
    # Channel strings include both `channel` (transport type) and `target`
    # (specific destination). The titlebar built-in stores 'titlebar' in
    # `target` with `channel: 'built-in'`; other channels (slack, email)
    # carry the recognisable name in `channel`. Capture both so any
    # substring check matches whichever side the LLM picked.
    if isinstance(nc, list):
        for ch in nc:
            if isinstance(ch, dict):
                channel_strings.append(str(ch.get("channel") or "").lower())
                channel_strings.append(str(ch.get("target") or "").lower())
            elif isinstance(ch, str):
                channel_strings.append(ch.lower())
    for uc in ucs:
        ucnc = uc.get("notification_channels") or []
        if isinstance(ucnc, list):
            for ch in ucnc:
                if isinstance(ch, dict):
                    channel_strings.append(str(ch.get("channel") or "").lower())
                    channel_strings.append(str(ch.get("target") or "").lower())
                elif isinstance(ch, str):
                    channel_strings.append(ch.lower())

    record(
        "persona_detail",
        "ok",
        name=d.get("name"),
        use_cases=len(ucs),
        triggers=len(triggers),
        connectors=connector_names,
        tools=tool_names,
        channels=channel_strings,
    )

    expected = SCENARIO["expected"]

    def passes_substrings(haystack: list[str], needles: list[str]) -> bool:
        if not needles:
            return True
        return any(any(n in h for h in haystack) for n in needles)

    # Connector check
    if expected["connector_substrings"]:
        ok = passes_substrings(connector_names, expected["connector_substrings"])
        record(
            "acceptance.connector",
            "ok" if ok else "fail",
            looking_for=expected["connector_substrings"],
            found=connector_names,
        )
    elif connector_names:
        record(
            "acceptance.connector",
            "info",
            note=("scenario expected no specific connector but the LLM picked "
                  "some — usually fine"),
            found=connector_names,
        )
    else:
        record("acceptance.connector", "ok", note="no connectors expected, none found")

    # Tool check
    if expected["tool_substrings"]:
        ok = passes_substrings(tool_names, expected["tool_substrings"])
        record(
            "acceptance.tool",
            "ok" if ok else "fail",
            looking_for=expected["tool_substrings"],
            found=tool_names,
        )

    # Channel check
    if expected["channel_substrings"]:
        ok = passes_substrings(channel_strings, expected["channel_substrings"])
        record(
            "acceptance.channel",
            "ok" if ok else "fail",
            looking_for=expected["channel_substrings"],
            found=channel_strings,
        )

    # Trigger sanity — every Phase C scenario is schedule-triggered.
    schedule_triggers = [t for t in triggers if t.get("trigger_type") == "schedule"]
    record(
        "acceptance.schedule_trigger",
        "ok" if schedule_triggers else "fail",
        count=len(schedule_triggers),
    )

    return d


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
    except SystemExit as e:
        record("scenario.abort", "fail", error=str(e))
    except Exception as e:
        record("scenario.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        summary = {
            "scenario": args.scenario,
            "persona_id": persona_id,
            "started": started.isoformat(),
            "finished": finished.isoformat(),
            "duration_s": (finished - started).total_seconds(),
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
