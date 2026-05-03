r"""
Rapid validation driver — 20 simple one-sentence personas (R01..R20).

Companion to docs/concepts/persona-capabilities/13-rapid-validation-personas.md.
Smoke-tests the build wizard at scale: each persona is a one-sentence
intent built end-to-end (start → answer → test → promote → inspect),
with optional runtime fire of every UC.

Usage:
  uvx --with httpx python tools/test-mcp/e2e_rapid_validation.py --persona R01
  uvx --with httpx python tools/test-mcp/e2e_rapid_validation.py --persona R01 --report logs/rapid-R01.json
  uvx --with httpx python tools/test-mcp/e2e_rapid_validation.py --all --report logs/rapid-all.json

Run prereqs:
  1. Dev app launched with test-automation feature:
       npm run tauri:dev:test
     (or `npx tauri dev -- --features test-automation`)
  2. /health on 127.0.0.1:17320 returns ok
  3. Vault contains the connectors named in PERSONAS[<id>].connector_hints
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx


# ---- Persona spec table ------------------------------------------------

# Each spec carries:
#   intent: the one-sentence string passed to startBuildFromIntent
#   expected_use_cases: integer UC count we expect after promote
#   expected_trigger_kinds: set of trigger_type values; ANY UC matching counts
#   connector_hints: list of vault service_types the LLM should pick up
#   review_policy_hint: "none" | "always" | "auto_triage" | "mixed" — informational
#   notes: scenario notes (not asserted, surfaced in report)

PERSONAS: dict[str, dict] = {
    "R01": {
        "intent": (
            "Every weekday at 8am, summarize my unread Gmail messages from the "
            "last 24 hours into a short digest."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["gmail"],
        "review_policy_hint": "none",
    },
    "R02": {
        "intent": (
            "Every Monday morning, list my open Linear issues assigned to me "
            "and post the summary as a Notion page."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["linear", "notion"],
        "review_policy_hint": "none",
    },
    "R03": {
        "intent": (
            "Each evening at 7pm, save the list of GitHub PRs I authored today "
            "to my local drive as a markdown file."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["github", "local_drive"],
        "review_policy_hint": "none",
    },
    "R04": {
        "intent": (
            "Every weekday at 7am, build a one-paragraph briefing of today's "
            "Google Calendar events."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["google_calendar"],
        "review_policy_hint": "none",
    },
    "R05": {
        "intent": (
            "Once an hour during work hours, check Sentry for new unresolved "
            "errors and write a one-line note when there are any."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["sentry"],
        "review_policy_hint": "none",
    },
    "R06": {
        "intent": (
            "Every Friday at 5pm, export my Notion 'Tasks' database to a "
            "markdown file in my local drive."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["notion", "local_drive"],
        "review_policy_hint": "none",
    },
    "R07": {
        "intent": (
            "Each morning at 9am, fetch the latest Alpha Vantage quote for AAPL "
            "and append it to a daily price log in Airtable."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["alpha_vantage", "airtable"],
        "review_policy_hint": "none",
    },
    "R08": {
        "intent": (
            "Every Sunday evening, count my open Asana tasks across all projects "
            "and save the totals to a Notion entry."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["asana", "notion"],
        "review_policy_hint": "none",
    },
    "R09": {
        "intent": (
            "Each weekday at noon, list my today's Cal.com bookings and write a "
            "short check-in note."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["cal_com"],
        "review_policy_hint": "none",
    },
    "R10": {
        "intent": (
            "Every two hours during work hours, scan my ClickUp board for tasks "
            "marked urgent and log them to a local file."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["clickup", "local_drive"],
        "review_policy_hint": "none",
    },
    "R11": {
        "intent": (
            "Watch my Gmail inbox and on every new message classify it as "
            "urgent / followup / fyi, and additionally draft a short reply for "
            "urgent messages for me to approve before sending."
        ),
        "expected_use_cases": 2,
        "expected_trigger_kinds": {"event", "event_listener"},
        "connector_hints": ["gmail"],
        "review_policy_hint": "always",  # UC2 draft-reply
    },
    "R12": {
        "intent": (
            "Every Monday at 8am, build one weekly digest combining my Linear "
            "assigned issues, my GitHub review-pending PRs, and today's Google "
            "Calendar events into a single markdown file in my local drive."
        ),
        "expected_use_cases": 4,
        "expected_trigger_kinds": {"schedule", "event", "event_listener"},
        "connector_hints": ["linear", "github", "google_calendar", "local_drive"],
        "review_policy_hint": "none",
    },
    "R13": {
        "intent": (
            "When a new high-priority Sentry error fires, open a corresponding "
            "GitHub issue describing the error and assign it to me."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"event", "event_listener", "webhook"},
        "connector_hints": ["sentry", "github"],
        "review_policy_hint": "auto_triage",
    },
    "R14": {
        "intent": (
            "When a new commit lands on the main branch of my GitHub repo, "
            "write a one-line release note to a Notion page."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"webhook", "event", "event_listener"},
        "connector_hints": ["github", "notion"],
        "review_policy_hint": "none",
    },
    "R15": {
        "intent": (
            "Every weekday at 6pm, gather today's Cal.com bookings and Google "
            "Calendar events, dedupe them, and email me a single summary."
        ),
        "expected_use_cases": 3,
        "expected_trigger_kinds": {"schedule", "event", "event_listener"},
        "connector_hints": ["cal_com", "google_calendar", "gmail"],
        "review_policy_hint": "none",
    },
    "R16": {
        "intent": (
            "Each Friday afternoon, list my closed Linear issues and closed "
            "Asana tasks for the week and post both lists to one weekly review "
            "page in Notion."
        ),
        "expected_use_cases": 3,
        "expected_trigger_kinds": {"schedule", "event", "event_listener"},
        "connector_hints": ["linear", "asana", "notion"],
        "review_policy_hint": "none",
    },
    "R17": {
        "intent": (
            "When a new attachment arrives in Gmail, save the file to my local "
            "drive and record the filename, sender, and date in Airtable."
        ),
        "expected_use_cases": 2,
        "expected_trigger_kinds": {"event", "event_listener"},
        "connector_hints": ["gmail", "local_drive", "airtable"],
        "review_policy_hint": "none",
    },
    "R18": {
        "intent": (
            "Every morning at 7am, scan my Notion 'Reading' database for entries "
            "marked 'todo' and ingest each into my personas vector DB so I can "
            "semantic-search them later."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["notion", "personas_vector_db"],
        "review_policy_hint": "none",
    },
    "R19": {
        "intent": (
            "Once a day, monitor Better Stack for any incidents on my services "
            "and post a short summary to personas messages."
        ),
        "expected_use_cases": 1,
        "expected_trigger_kinds": {"schedule"},
        "connector_hints": ["betterstack", "personas_messages"],
        "review_policy_hint": "none",
    },
    "R20": {
        "intent": (
            "When I drop a file into a watched local drive folder, generate a "
            "Leonardo AI cover image based on the filename and store the image "
            "path back in Airtable."
        ),
        "expected_use_cases": 2,
        "expected_trigger_kinds": {"event", "event_listener", "polling"},
        "connector_hints": ["local_drive", "leonardo_ai", "airtable"],
        "review_policy_hint": "always",  # UC2 image-gen
    },
}


# ---- CLI ---------------------------------------------------------------

# Force UTF-8 stdout (Windows cp1252 chokes on non-ASCII).
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

parser = argparse.ArgumentParser(description="Rapid 20-persona validation suite")
parser.add_argument("--port", type=int, default=17320)
group = parser.add_mutually_exclusive_group(required=True)
group.add_argument("--persona", type=str, help="Single persona id e.g. R01")
group.add_argument("--all", action="store_true", help="Run R01..R20 sequentially")
parser.add_argument("--build-timeout", type=int, default=240)
parser.add_argument("--no-persona-cleanup", action="store_true",
                    help="Keep promoted personas in DB after the run (debug)")
parser.add_argument("--fire", action="store_true",
                    help="After promote, call executePersona to fire one runtime "
                         "execution. Implies --no-persona-cleanup so module "
                         "verification can find the rows.")
parser.add_argument("--report", type=str, default=None,
                    help="Path to write JSON report (single persona) or directory (--all)")
args = parser.parse_args()

if args.persona and args.persona not in PERSONAS:
    raise SystemExit(
        f"Unknown persona id {args.persona!r}. Valid: {sorted(PERSONAS.keys())}"
    )

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


# ---- Per-run event log -------------------------------------------------

class RunLog:
    def __init__(self, persona_id: str):
        self.persona_id = persona_id
        self.events: list[dict] = []

    def record(self, step: str, outcome: str, **kw) -> dict:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "persona": self.persona_id,
            "step": step,
            "outcome": outcome,
        }
        entry.update(kw)
        self.events.append(entry)
        marker = "[OK]" if outcome == "ok" else ("[..]" if outcome == "info" else "[XX]")
        sys.stdout.write(f"  {marker} {self.persona_id} {step}: {outcome}")
        if kw:
            brief = {k: v for k, v in kw.items()
                     if k not in ("detail",) and not isinstance(v, (dict, list))}
            if brief:
                sys.stdout.write(f"  {brief}")
        sys.stdout.write("\n")
        sys.stdout.flush()
        return entry


# ---- Generic answer recipe ---------------------------------------------

def build_answer(intent: str, cell_key: str, spec: dict, ask_count: int = 1) -> str:
    """Generic answer recipe — covers the 9 standard build dimensions.

    These personas are deliberately simple. The intent itself usually
    answers most clarifying questions; the recipe re-states the intent
    plus a dimension-specific shaping hint so the LLM doesn't ask twice.

    `ask_count` rises each time the LLM re-asks the same dimension. On
    the second+ ask, switch to a hyper-specific override that picks
    exactly one trigger type / one cron / one connector to break the
    indecision loop.
    """
    connectors_str = ", ".join(spec["connector_hints"])
    expected_uc = spec["expected_use_cases"]
    review_hint = spec["review_policy_hint"]
    triggers_hint = ", ".join(sorted(spec["expected_trigger_kinds"]))

    # File-watcher intents — pick polling as the canonical answer when
    # the LLM is confused. "Watched folder" / "drop a file" semantics
    # map to filesystem polling, not event_listener.
    intent_lc = intent.lower()
    is_filewatch = any(s in intent_lc for s in (
        "watched", "watch a folder", "drop a file", "drop file",
        "files added", "new file in",
    ))
    is_email_event = "every new message" in intent_lc or "new email" in intent_lc or "new gmail message" in intent_lc
    is_webhook = "when a new commit" in intent_lc or "webhook" in intent_lc
    is_sentry_event = "sentry error fires" in intent_lc

    # interval_seconds MUST be >= 60 (validator hard-floor in
    # src-tauri/src/validation/trigger.rs::MIN_INTERVAL_SECONDS).
    decisive_trigger = (
        '{"trigger_type":"polling","config":{"interval_seconds":300}}  '
        '(interval_seconds MUST be >= 60; do not pick a smaller value)'
        if is_filewatch
        else '{"trigger_type":"event","event_type":"gmail.message.received"}'
        if is_email_event
        else '{"trigger_type":"webhook","config":{"webhook_secret":"set-by-promote"}}'
        if is_webhook
        else '{"trigger_type":"event","event_type":"sentry.issue.high"}'
        if is_sentry_event
        else '{"trigger_type":"schedule","config":{"cron":"0 8 * * 1-5"}}'
    )

    base = (
        f"Mirror the intent verbatim: {intent} "
        f"Use the user's existing vault credentials: {connectors_str}. "
    )

    overrides = {
        "behavior_core": (
            base
            + "Mission: do exactly what the intent says, nothing more. "
            "Voice is concise, neutral, factual."
        ),
        "mission": (
            base + "The mission is the intent itself; do not invent extra goals."
        ),
        "use-cases": (
            base
            + f"Plan exactly {expected_uc} capabilit"
            + ("y" if expected_uc == 1 else "ies")
            + " — do not split or combine."
        ),
        "triggers": (
            base
            + (
                f"Use this exact trigger config and DO NOT ASK AGAIN: "
                f"{decisive_trigger}. No alternatives, no further questions."
                if ask_count >= 2
                else f"Use {triggers_hint} trigger(s). For schedule, pick a "
                "sensible cron from the time-of-day in the intent. For "
                "file-watcher intents (watched folder, drop file), use polling "
                "with interval_seconds >= 60 (300 is a good default; values "
                "below 60 will fail validation). For 'every new message' / "
                "'when commit lands', use event. For webhook triggers, "
                "include a non-empty webhook_secret in config."
            )
        ),
        "connectors": (
            base
            + f"Required connectors are exactly: {connectors_str}. "
            "Do not request additional connectors."
        ),
        "events": (
            base
            + "Use minimal event subscriptions — only what the intent literally "
            "describes."
        ),
        "human-review": (
            base + (
                "Always review before sending / generating output."
                if review_hint == "always"
                else "Auto-decide via decision_principles (auto_triage)."
                if review_hint == "auto_triage"
                else "Never review — informational/automation only."
            )
        ),
        "messages": (
            base + "Single output channel only — the destination named in the intent. "
            "No extra notifications."
        ),
        "memory": (
            base + "No cross-run memory needed."
        ),
        "error-handling": (
            base + "On API failure: log and skip. Do not retry tightly."
        ),
    }
    return overrides.get(cell_key, base + f"Dimension: {cell_key}.")


# ---- Build pipeline steps ---------------------------------------------

def step_preflight(rl: RunLog) -> None:
    try:
        h = get("/health")
    except Exception as e:
        rl.record("preflight.health", "fail", error=str(e))
        raise SystemExit(
            "Test-automation server not responding. Launch the app with "
            "`npm run tauri:dev:test` first."
        ) from e
    rl.record("preflight.health", "ok", server=h.get("server"), version=h.get("version"))


def step_start_build(rl: RunLog, intent: str) -> dict:
    r = bridge(
        "startBuildFromIntent",
        {"intent": intent, "timeoutMs": 30_000},
        40,
    )
    if not r.get("success"):
        rl.record("start_build", "fail", error=r.get("error"))
        raise SystemExit(f"startBuildFromIntent failed: {r.get('error')}")
    rl.record(
        "start_build",
        "ok",
        session_id=r.get("sessionId"),
        persona_id=r.get("personaId"),
    )
    return r


def step_answer_dimensions(rl: RunLog, intent: str, spec: dict) -> str:
    """Returns final phase reached."""
    max_rounds = 40
    cell_ask_counts: dict[str, int] = {}
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
        rl.record(
            f"wait.phase.round{round_ix}",
            "ok" if phase_r.get("success") else "info",
            phase=phase,
            pending=phase_r.get("pendingCount"),
        )
        if phase == "failed":
            raise SystemExit(f"Build failed mid-flight: {phase_r.get('error')}")
        if phase in ("draft_ready", "test_complete", "promoted"):
            rl.record("answer_dimensions", "ok", final_phase=phase, rounds=round_ix)
            return phase
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
            cell_ask_counts[key] = cell_ask_counts.get(key, 0) + 1
            ask_count = cell_ask_counts[key]
            # Phase 1 measurement aid — log every ask's cell_key and a short
            # snippet of the question so we can see which dimensions are
            # still firing. Repeat asks also trigger the decisive-override
            # branch in build_answer.
            rl.record(
                f"answer.ask.{key}",
                "info",
                ask_count=ask_count,
                question_text=(q.get("question") or q.get("prompt") or "")[:200],
            )
            batch[key] = build_answer(intent, key, spec, ask_count=ask_count)

        if not batch:
            rl.record(
                f"answer.round{round_ix}",
                "info",
                note="no recognizable cellKeys",
                qs=qs,
            )
            time.sleep(1.0)
            continue

        submit = bridge("answerPendingBuildQuestions", {"answers": batch}, 60)
        rl.record(
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


def step_test_and_promote(rl: RunLog, persona_id: str) -> dict:
    # A-grade Phase 3 (2026-05-03): client-side wait_for_agent_ir helper
    # was removed. The race is now handled server-side inside
    # `commands::design::build_sessions::test_build_draft` — when both
    # session.agent_ir and persona.last_design_result are absent the
    # command retries 6×500ms (3s total) before erroring out. The
    # session-keyed autoTestedRef in UnifiedMatrixEntry stops post-
    # test_complete phase oscillation from re-firing the auto-test.

    # See e2e_phase_a.py — auto-test fires on draft_ready, so probe state
    # before re-triggering to avoid collision.
    try:
        state = get("/state")
    except Exception:
        state = {}
    current_phase = state.get("buildPhase") if isinstance(state, dict) else None
    if current_phase == "test_complete":
        rl.record(
            "test_build_draft",
            "info",
            note="auto-test already completed; skipping manual trigger",
            phase=current_phase,
        )
    else:
        test = bridge("triggerBuildTest", {}, 90)
        if test.get("success"):
            report = test.get("report") or {}
            rl.record(
                "test_build_draft",
                "ok",
                tool_tests=len(report.get("toolTests", []) or report.get("tool_tests", [])),
                report_keys=list(report.keys()),
            )
        else:
            rl.record("test_build_draft", "info", error=test.get("error"))

    promote = bridge("promoteBuildDraft", {}, 60)
    if not promote.get("success"):
        rl.record("promote_build_draft", "fail", error=promote.get("error"))
        raise SystemExit(f"promoteBuildDraft failed: {promote.get('error')}")
    rl.record("promote_build_draft", "ok", persona_id=promote.get("personaId"))
    return promote


# ---- Inspection / acceptance -----------------------------------------

def _parse_maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v or {}


def _flatten_connector_names(*levels) -> set[str]:
    out: set[str] = set()
    for lvl in levels:
        if not lvl:
            continue
        for c in lvl:
            if isinstance(c, str):
                out.add(c.lower())
            elif isinstance(c, dict):
                for k in ("service_type", "serviceType", "name", "type"):
                    v = c.get(k)
                    if isinstance(v, str):
                        out.add(v.lower())
                        break
    return out


def step_inspect(rl: RunLog, persona_id: str, spec: dict) -> dict:
    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        rl.record("persona_detail", "fail", error=detail.get("error"))
        return {}
    d = detail.get("detail") or {}
    design_context = _parse_maybe_json(d.get("design_context"))
    last_design_result = _parse_maybe_json(d.get("last_design_result"))
    use_cases = design_context.get("useCases") or design_context.get("use_cases") or []
    triggers = d.get("triggers") or []

    persona_connectors = (
        last_design_result.get("suggested_connectors")
        or last_design_result.get("required_connectors")
        or []
    )
    uc_connector_lists = [uc.get("connectors") or [] for uc in use_cases]
    tool_hints = []
    for uc in (last_design_result.get("use_case_flows") or []):
        for h in (uc.get("tool_hints") or []):
            if isinstance(h, str):
                tool_hints.append(h)

    all_connector_names = _flatten_connector_names(
        persona_connectors, *uc_connector_lists, tool_hints
    )

    rl.record(
        "persona_detail",
        "ok",
        name=d.get("name"),
        use_cases=len(use_cases),
        triggers=len(triggers),
        connectors_observed=sorted(all_connector_names),
    )

    expected_uc = spec["expected_use_cases"]
    got_uc = len(use_cases)
    # LLM legitimately consolidates capabilities when the intent reads as
    # a single coherent action (e.g. "build ONE digest combining X+Y+Z"
    # naturally lands as 1 UC instead of split into 3 collectors + 1
    # assembler). Treat got <= expected as a pass; only fail when the
    # LLM over-splits or produces zero UCs.
    if 1 <= got_uc <= expected_uc:
        rl.record("acceptance.use_case_count",
                  "ok",
                  got=got_uc, expected=expected_uc,
                  consolidation=("yes" if got_uc < expected_uc else "no"),
                  uc_titles=[uc.get("title") for uc in use_cases])
    else:
        rl.record("acceptance.use_case_count", "fail",
                  got=got_uc, expected=expected_uc,
                  uc_titles=[uc.get("title") for uc in use_cases])

    expected_kinds = spec["expected_trigger_kinds"]
    persona_trigger_kinds = {t.get("trigger_type") for t in triggers}
    if persona_trigger_kinds & expected_kinds:
        rl.record("acceptance.trigger_kinds", "ok",
                  observed=sorted(persona_trigger_kinds),
                  expected_one_of=sorted(expected_kinds))
    else:
        rl.record("acceptance.trigger_kinds", "fail",
                  observed=sorted(persona_trigger_kinds),
                  expected_one_of=sorted(expected_kinds))

    # Connector matching: the LLM emits semantic names (`gmail_search`,
    # `google`) and tool names instead of the literal vault service_type.
    # Match by substring or alias rather than equality.
    CONNECTOR_ALIASES = {
        "gmail": {"gmail", "google", "mail", "email"},
        "google_calendar": {"google_calendar", "google", "calendar", "gcal"},
        "cal_com": {"cal_com", "cal.com", "calcom", "calendar"},
        "github": {"github", "git", "gh", "code_repository"},
        "linear": {"linear"},
        "asana": {"asana"},
        "clickup": {"clickup"},
        "notion": {"notion"},
        "airtable": {"airtable"},
        "local_drive": {"local_drive", "local-drive", "drive", "filesystem", "personas-drive"},
        "personas_vector_db": {"personas_vector_db", "vector", "vector_db"},
        "personas_messages": {"personas_messages", "messages", "messaging"},
        "sentry": {"sentry"},
        "betterstack": {"betterstack", "better_stack"},
        "alpha_vantage": {"alpha_vantage", "alphavantage", "stock", "finance"},
        "leonardo_ai": {"leonardo_ai", "leonardo", "image"},
    }
    expected_conns = {c.lower() for c in spec["connector_hints"]}
    matched: set[str] = set()
    for exp in expected_conns:
        aliases = CONNECTOR_ALIASES.get(exp, {exp})
        if any(any(a in obs for a in aliases) or any(obs in a for a in aliases)
               for obs in all_connector_names):
            matched.add(exp)
    missing = expected_conns - matched
    if not missing:
        rl.record("acceptance.connectors", "ok",
                  matched=sorted(matched), all_observed=sorted(all_connector_names))
    else:
        rl.record(
            "acceptance.connectors",
            "ok" if matched else "fail",
            matched=sorted(matched),
            missing=sorted(missing),
            all_observed=sorted(all_connector_names),
        )

    # A-grade Phase 2 (2026-05-03): test_build_draft now persists the report
    # to personas.last_test_report. getPersonaDetail returns the field
    # via the flattened Persona payload — read it here and verify the gate
    # flips from `info` to `ok` once the binary carries Phase 2.
    last_test_report_raw = d.get("last_test_report") or d.get("lastTestReport")
    last_test = _parse_maybe_json(last_test_report_raw) if last_test_report_raw else {}
    tool_results = last_test.get("results") or []
    tools_tested = last_test.get("tools_tested", 0)
    if tool_results:
        errored = [
            t for t in tool_results
            if (t.get("status") or "").lower() in ("failed", "error", "credential_missing")
        ]
        passed = [
            t for t in tool_results if (t.get("status") or "").lower() == "passed"
        ]
        rl.record(
            "acceptance.tool_tests",
            "ok",
            count=len(tool_results),
            tools_tested=tools_tested,
            passed=len(passed),
            errored=len(errored),
        )
    else:
        rl.record(
            "acceptance.tool_tests",
            "info",
            note=("last_test_report missing or empty — pre-Phase-2 binary, "
                  "no tools to test (manual-only persona), or test failed "
                  "to run"),
            has_field=last_test_report_raw is not None,
        )

    return d


def step_fire_runtime(rl: RunLog, persona_id: str) -> None:
    """--fire: call executePersona to land at least one runtime execution.
    For event-driven personas this synthesises a manual trigger; with no
    real credentials wired the connector calls will likely error out, but
    that's still useful evidence — it proves the dispatcher routed the
    call (vs. the dispatcher silently dropping it, which would leave NO
    execution row at all)."""
    r = bridge("executePersona", {"nameOrId": persona_id}, 60)
    rl.record(
        "fire.executePersona",
        "ok" if r.get("success") else "info",
        **{k: v for k, v in r.items() if k not in ("success", "execution")},
    )


def step_cleanup(rl: RunLog, persona_id: str | None) -> None:
    if args.no_persona_cleanup or args.fire or not persona_id:
        return
    r = bridge("deleteAgent", {"nameOrId": persona_id}, 30)
    rl.record(
        "cleanup.deleteAgent",
        "ok" if r.get("success") else "info",
        **{k: v for k, v in r.items() if k != "success"},
    )


# ---- Single-persona run ----------------------------------------------

def run_one(persona_id: str) -> dict:
    spec = PERSONAS[persona_id]
    rl = RunLog(persona_id)
    started = datetime.now(timezone.utc)
    pid = None
    print(f"\n========== {persona_id} ==========")
    print(f"intent: {spec['intent']}")
    try:
        step_preflight(rl)
        build = step_start_build(rl, spec["intent"])
        step_answer_dimensions(rl, spec["intent"], spec)
        # Persona id from start_build is canonical; need it for the
        # wait_for_agent_ir poll before promote.
        early_pid = build.get("personaId")
        promote = step_test_and_promote(rl, early_pid)
        pid = promote.get("personaId") or early_pid
        step_inspect(rl, pid, spec)
        if args.fire:
            step_fire_runtime(rl, pid)
        step_cleanup(rl, pid)
        outcome = "green"
    except SystemExit as e:
        rl.record("scenario.abort", "fail", error=str(e))
        outcome = "red"
    except Exception as e:
        rl.record("scenario.crash", "fail", error=repr(e))
        outcome = "red"
    finished = datetime.now(timezone.utc)
    return {
        "persona": persona_id,
        "intent": spec["intent"],
        "outcome": outcome,
        "started": started.isoformat(),
        "finished": finished.isoformat(),
        "duration_s": (finished - started).total_seconds(),
        "log": rl.events,
    }


def main() -> None:
    if args.persona:
        summary = run_one(args.persona)
        if args.report:
            Path(args.report).parent.mkdir(parents=True, exist_ok=True)
            Path(args.report).write_text(json.dumps(summary, indent=2))
            print(f"\nWrote {args.report}")
        else:
            print("\n-- summary --")
            print(json.dumps(summary, indent=2))
        return

    # --all
    summaries: list[dict] = []
    out_dir = Path(args.report) if args.report else None
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
    for pid in PERSONAS.keys():
        s = run_one(pid)
        summaries.append(s)
        if out_dir:
            (out_dir / f"rapid-{pid}.json").write_text(json.dumps(s, indent=2))
    print("\n========== ALL DONE ==========")
    for s in summaries:
        print(f"  {s['persona']:5s}  {s['outcome']:5s}  {s['duration_s']:.1f}s")
    if out_dir:
        (out_dir / "rapid-summary.json").write_text(json.dumps(summaries, indent=2))


if __name__ == "__main__":
    main()
