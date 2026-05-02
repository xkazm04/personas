r"""
Phase B — chained personas across persona boundaries.

Tests the cascade-guard fix from C5-handoff-2026-04-26 §A. The guard was
per-persona-only; the previous handoff scoped it to (persona, use_case) so
UC1's emit landing while UC1 is still completing doesn't block UC2 inside
the same persona. This scenario goes one step further: it builds THREE
independent personas chained via emit/listen, then fires the head of the
chain and verifies all three execute.

  Persona X — "RSS News Scraper"
      schedule trigger (hourly), emits   news.draft.captured

  Persona Y — "News Summarizer"
      event_listener on  news.draft.captured
                              │
                              ▼ produces 2-sentence summary
      emits  news.summary.ready

  Persona Z — "Notes Poster"
      event_listener on  news.summary.ready
                              │
                              ▼ appends to local drive

The driver:
  1. Builds X, Y, Z sequentially. For each, drives the build via the same
     answer-loop pattern used in e2e_phase_a.py with deterministic recipes.
  2. After all three are promoted, fires Persona X manually via
     `executePersona`.
  3. Polls executions for Y and Z within a short window. The handoff §A
     fix means the cascade-guard does NOT block these cross-persona fires.
  4. Reports per-persona executions so we can confirm:
        - X ran (and its emit landed),
        - Y woke on `news.draft.captured` and emitted `news.summary.ready`,
        - Z woke on `news.summary.ready`.

Prereqs:
  1. Dev app running with test-automation feature:
       npx tauri dev -- --features test-automation
  2. Test server reachable on http://127.0.0.1:17320

Usage:
  python tools/test-mcp/e2e_phase_b.py
  python tools/test-mcp/e2e_phase_b.py --report logs/phase-b.json
  python tools/test-mcp/e2e_phase_b.py --no-cleanup        # keep personas after run
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

parser = argparse.ArgumentParser(description="Phase B chained-personas E2E")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument("--build-timeout", type=int, default=240)
parser.add_argument(
    "--cascade-timeout",
    type=int,
    default=180,
    help="Seconds to wait for the X→Y→Z cascade to land after firing X.",
)
parser.add_argument(
    "--no-cleanup",
    action="store_true",
    help="Keep the 3 built personas in the dev DB after the run.",
)
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()


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


# ---- Persona scenario definitions --------------------------------------
# Event names are pinned across all three so the chain wires together
# without the LLM inventing variants.

EVENT_DRAFT = "news.draft.captured"
EVENT_SUMMARY = "news.summary.ready"

_EVENT_NAME_LOCK_X = (
    f"CRITICAL — event_type discipline: this persona is the head of a "
    f"hand-wired chain. The downstream summarizer persona is wired to listen "
    f"for the EXACT event name `{EVENT_DRAFT}`. You MUST use that literal "
    f"string verbatim in every emit_event and event_subscriptions entry. Do "
    f"NOT rewrite it into a `<persona>.<task>.<event_type>` token derived "
    f"from this persona's name. Do NOT replace `news` with `hn_scraper` or "
    f"any persona-derived prefix. Use `{EVENT_DRAFT}` exactly. The chain "
    f"breaks if you rename it."
)
_EVENT_NAME_LOCK_Y = (
    f"CRITICAL — event_type discipline: this persona is the middle of a "
    f"hand-wired chain. Inbound: subscribe to the EXACT event name "
    f"`{EVENT_DRAFT}` — that is what the upstream scraper persona emits. "
    f"Outbound: emit the EXACT event name `{EVENT_SUMMARY}` — that is what "
    f"the downstream notes-poster persona is wired to listen for. Use both "
    f"strings verbatim; do NOT rewrite either into a "
    f"`<persona>.<task>.<event_type>` token derived from this persona's "
    f"name. Do NOT add a persona-name prefix. Use `{EVENT_DRAFT}` and "
    f"`{EVENT_SUMMARY}` exactly."
)
_EVENT_NAME_LOCK_Z = (
    f"CRITICAL — event_type discipline: this persona is the tail of a "
    f"hand-wired chain. Subscribe to the EXACT event name `{EVENT_SUMMARY}` "
    f"— that is what the upstream summarizer persona emits. Use that string "
    f"verbatim; do NOT rewrite it into a `<persona>.<task>.<event_type>` "
    f"token derived from this persona's name. Do NOT add a persona-name "
    f"prefix. Use `{EVENT_SUMMARY}` exactly."
)


PERSONA_X = {
    "label": "X",
    "intent": (
        "Be a Hacker News digest scraper. Once an hour, fetch the top 3 "
        "stories from the Hacker News RSS feed (https://news.ycombinator.com/rss) "
        "and emit each as a draft news item for downstream personas to "
        f"summarize. Single capability, schedule-triggered. {_EVENT_NAME_LOCK_X}"
    ),
    "answers": {
        "behavior_core": (
            "An hourly Hacker News scraper. Mission: reliably surface fresh "
            "story drafts so downstream summarizer personas can pick them up. "
            f"{_EVENT_NAME_LOCK_X}"
        ),
        "mission": (
            "Capture the top 3 Hacker News stories every hour as draft items "
            f"for downstream summarization. {_EVENT_NAME_LOCK_X}"
        ),
        "use-cases": (
            "ONE capability: 'Capture HN Drafts'. Schedule-triggered (hourly). "
            "Reads the public Hacker News RSS feed, picks the top 3 stories, "
            "emits ONE event per story so downstream personas can pick them "
            f"up: emit `{EVENT_DRAFT}` with `{{title, url, source}}` payload. "
            f"{_EVENT_NAME_LOCK_X}"
        ),
        "triggers": (
            "Schedule trigger ONLY. The capability's suggested_trigger MUST be "
            '`{"trigger_type":"schedule","config":{"cron":"0 * * * *"}}` '
            "(top of every hour). No event subscriptions inbound — this is "
            "the head of a chain."
        ),
        "connectors": (
            "Use the built-in web_fetch tool to retrieve the public HN RSS "
            "feed at https://news.ycombinator.com/rss. No external connector "
            "credentials needed; HN RSS is public."
        ),
        "events": (
            f"NO inbound subscriptions. Outbound: emit `{EVENT_DRAFT}` once "
            f"per story. {_EVENT_NAME_LOCK_X}"
        ),
        "human-review": "Never review — auto-emit drafts.",
        "messages": "No user-facing messages — emission is enough.",
        "memory": "No memory needed.",
        "error-handling": (
            "If the RSS fetch fails, log and skip — the next hour's run will "
            "pick up where this one left off. Do NOT retry tightly."
        ),
    },
}

PERSONA_Y = {
    "label": "Y",
    "intent": (
        f"Listen for `{EVENT_DRAFT}` events. For each draft, write a "
        "2-sentence summary and emit it for the notes poster persona to "
        f"archive. Emit `{EVENT_SUMMARY}` when the summary is ready. "
        f"{_EVENT_NAME_LOCK_Y}"
    ),
    "answers": {
        "behavior_core": (
            "A news summarizer. Mission: convert raw news drafts into "
            "concise 2-sentence summaries that downstream personas can "
            f"archive without further editing. {_EVENT_NAME_LOCK_Y}"
        ),
        "mission": (
            "Summarize every news draft I'm given into 2 sentences and emit "
            f"the summary for downstream archival. {_EVENT_NAME_LOCK_Y}"
        ),
        "use-cases": (
            "ONE capability: 'Summarize News Draft'. Event-triggered. "
            f"Listens on `{EVENT_DRAFT}`, writes a 2-sentence summary, then "
            f"emits `{EVENT_SUMMARY}` with `{{title, url, summary}}`. "
            f"{_EVENT_NAME_LOCK_Y}"
        ),
        "triggers": (
            "Event-driven. The capability's suggested_trigger MUST be "
            '`{"trigger_type":"event","config":{}}` and its '
            "event_subscriptions MUST include "
            f'`{{"event_type":"{EVENT_DRAFT}","direction":"listen"}}`. '
            "No schedule, no polling, no manual."
        ),
        "connectors": (
            "No external connectors — the agent uses its base LLM to "
            "summarize the draft in 2 sentences. No vault credential needed."
        ),
        "events": (
            f"INBOUND: subscribe to `{EVENT_DRAFT}`. OUTBOUND: emit "
            f"`{EVENT_SUMMARY}` with `{{title, url, summary}}` once the "
            f"summary is written. {_EVENT_NAME_LOCK_Y}"
        ),
        "human-review": "Never review.",
        "messages": "No user-facing messages.",
        "memory": "No memory.",
        "error-handling": (
            "If summarization fails, log and skip — the next draft event "
            "will trigger normally."
        ),
    },
}

PERSONA_Z = {
    "label": "Z",
    "intent": (
        f"Listen for `{EVENT_SUMMARY}` events. For each summary, append a "
        "markdown line to my local drive notes file at "
        f"`news/digest.md`. {_EVENT_NAME_LOCK_Z}"
    ),
    "answers": {
        "behavior_core": (
            "A news archiver. Mission: keep a running markdown log of every "
            f"summarized news item so I can browse it later. {_EVENT_NAME_LOCK_Z}"
        ),
        "mission": (
            "Append every news summary to my local drive notes file. "
            f"{_EVENT_NAME_LOCK_Z}"
        ),
        "use-cases": (
            "ONE capability: 'Append Summary to Notes'. Event-triggered. "
            f"Listens on `{EVENT_SUMMARY}`. Writes one bullet line per "
            f"summary into `news/digest.md` on the built-in local drive. "
            f"{_EVENT_NAME_LOCK_Z}"
        ),
        "triggers": (
            "Event-driven. suggested_trigger = "
            '`{"trigger_type":"event","config":{}}`. event_subscriptions = '
            f'`[{{"event_type":"{EVENT_SUMMARY}","direction":"listen"}}]`.'
        ),
        "connectors": (
            "Use the built-in local_drive connector. The agent appends a "
            "single bullet line to `news/digest.md` for each summary."
        ),
        "events": (
            f"INBOUND: subscribe to `{EVENT_SUMMARY}`. No outbound emits — "
            f"this is the tail of the chain. {_EVENT_NAME_LOCK_Z}"
        ),
        "human-review": "Never review.",
        "messages": "No user-facing messages.",
        "memory": "No memory.",
        "error-handling": (
            "If the drive write fails, log and skip — the next summary "
            "event will trigger normally."
        ),
    },
}


# ---- Build steps -------------------------------------------------------


def step_preflight() -> None:
    print("\n[preflight] Health probe")
    try:
        h = get("/health")
    except Exception as e:
        record("preflight.health", "fail", error=str(e))
        raise SystemExit(
            "Test-automation server not responding. Launch the app with "
            "`npx tauri dev -- --features test-automation`."
        ) from e
    record("preflight.health", "ok", server=h.get("server"), version=h.get("version"))


def build_persona(scenario: dict, persona_ids: list[str]) -> str:
    label = scenario["label"]
    print(f"\n[build {label}] Start build session")
    r = bridge(
        "startBuildFromIntent",
        {"intent": scenario["intent"], "timeoutMs": 30_000},
        40,
    )
    if not r.get("success"):
        record(f"build.{label}.start", "fail", error=r.get("error"))
        raise SystemExit(f"startBuildFromIntent({label}) failed: {r.get('error')}")
    session_id = r.get("sessionId")
    persona_id = r.get("personaId")
    # Capture the persona id NOW so cleanup-on-abort can reach it even if a
    # later step blows up.
    if persona_id and persona_id not in persona_ids:
        persona_ids.append(persona_id)
    record(f"build.{label}.start", "ok", session_id=session_id, persona_id=persona_id)

    print(f"[build {label}] Answer dimensions")
    answers = scenario["answers"]
    fallback = scenario["intent"]
    # Phase-B builds emit roughly the same per-UC question count as Phase A
    # but with stricter event-name pinning, the LLM sometimes loops once or
    # twice on resolution while honoring the lock. 60 rounds gives headroom.
    max_rounds = 60
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
        if phase == "failed":
            raise SystemExit(f"Build {label} failed mid-flight: {phase_r.get('error')}")
        if phase in ("draft_ready", "test_complete", "promoted"):
            record(f"build.{label}.answer_done", "ok", final_phase=phase, rounds=round_ix)
            break
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
            batch[key] = answers.get(key, f"Auto-scenario answer ({label}): {fallback}")
        if not batch:
            time.sleep(1.0)
            continue
        submit = bridge("answerPendingBuildQuestions", {"answers": batch}, 60)
        if not submit.get("success"):
            raise SystemExit(
                f"answerPendingBuildQuestions({label}) failed: {submit.get('error')}"
            )
    else:
        raise SystemExit(f"Build {label} exceeded {max_rounds} rounds")

    print(f"[build {label}] Test + promote")
    test = bridge("triggerBuildTest", {}, 60)
    record(
        f"build.{label}.test",
        "ok" if test.get("success") else "info",
        error=test.get("error"),
    )
    promote = bridge("promoteBuildDraft", {}, 60)
    if not promote.get("success"):
        record(f"build.{label}.promote", "fail", error=promote.get("error"))
        raise SystemExit(f"promote({label}) failed: {promote.get('error')}")
    final_id = promote.get("personaId") or persona_id
    record(f"build.{label}.promote", "ok", persona_id=final_id)
    return final_id


def inspect_persona(persona_id: str, label: str) -> dict:
    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record(f"inspect.{label}", "fail", error=detail.get("error"))
        return {}
    d = detail.get("detail") or {}
    dc = _parse_maybe_json(d.get("design_context"))
    ucs = dc.get("useCases") or dc.get("use_cases") or []
    triggers = d.get("triggers") or []
    subs = d.get("subscriptions") or d.get("event_subscriptions") or []

    # Aggregate every (event_type, direction) tuple across persona-level and
    # per-UC subscriptions so we can see how the chain is wired.
    chain_subs = []
    for s in subs:
        chain_subs.append({"src": "persona", "event": s.get("event_type"), "direction": s.get("direction")})
    for uc in ucs:
        for s in uc.get("event_subscriptions") or []:
            chain_subs.append(
                {"src": uc.get("id"), "event": s.get("event_type"), "direction": s.get("direction")}
            )

    record(
        f"inspect.{label}",
        "ok",
        name=d.get("name"),
        use_cases=len(ucs),
        triggers=len(triggers),
        chain_subs=chain_subs,
    )
    return {"detail": d, "ucs": ucs, "triggers": triggers, "subs": chain_subs}


# ---- Cascade probe -----------------------------------------------------


def fire_x_and_watch(x_id: str, y_id: str, z_id: str) -> None:
    print("\n[cascade] Fire Persona X manually")
    sinceIso = datetime.now(timezone.utc).isoformat()

    r = bridge("executePersona", {"nameOrId": x_id}, 60)
    if not r.get("success"):
        record("cascade.fire_x", "fail", error=r.get("error"))
        raise SystemExit(f"executePersona(X) failed: {r.get('error')}")
    record("cascade.fire_x", "ok", x_id=x_id, since=sinceIso)

    deadline = time.time() + args.cascade_timeout
    seen = {x_id: False, y_id: False, z_id: False}
    last_seen_id = {x_id: None, y_id: None, z_id: None}
    while time.time() < deadline and not all(seen.values()):
        for pid, label in ((x_id, "X"), (y_id, "Y"), (z_id, "Z")):
            if seen[pid]:
                continue
            res = bridge(
                "waitForPersonaExecution",
                {"personaId": pid, "sinceIso": sinceIso, "timeoutMs": 8_000},
                12,
            )
            if res.get("success"):
                seen[pid] = True
                exec_obj = res.get("execution") or {}
                last_seen_id[pid] = exec_obj.get("id")
                record(
                    f"cascade.observed_{label}",
                    "ok",
                    persona_id=pid,
                    execution_id=exec_obj.get("id"),
                    status=exec_obj.get("status"),
                    use_case_id=exec_obj.get("use_case_id"),
                )
        if not all(seen.values()):
            time.sleep(2.0)

    for pid, label in ((x_id, "X"), (y_id, "Y"), (z_id, "Z")):
        if not seen[pid]:
            record(
                f"cascade.missing_{label}",
                "fail",
                persona_id=pid,
                hint=(
                    "X→Y depends on Y subscribing to news.draft.captured and the "
                    "auto-listener trigger picking up X's emit. Y→Z likewise on "
                    "news.summary.ready. Inspect the per-persona chain_subs above."
                ),
            )

    if all(seen.values()):
        record("cascade.full_chain", "ok", **last_seen_id)


# ---- Cleanup -----------------------------------------------------------


def cleanup(persona_ids: list[str]) -> None:
    if args.no_cleanup:
        return
    print("\n[cleanup] deletePersona x N")
    for pid in persona_ids:
        if not pid:
            continue
        r = bridge("deletePersona", {"personaId": pid}, 30)
        record(
            "cleanup.deletePersona",
            "ok" if r.get("success") else "info",
            persona_id=pid,
            error=r.get("error"),
        )


# ---- Main --------------------------------------------------------------


def main() -> None:
    started = datetime.now(timezone.utc)
    persona_ids: list[str] = []
    try:
        step_preflight()

        # Build the chain head-to-tail: X first so Y has something to listen
        # to, but the order doesn't actually matter for the build itself —
        # the trigger wiring at promote time is independent. Building head-
        # first only matters for the cascade fire later.
        for sc in (PERSONA_X, PERSONA_Y, PERSONA_Z):
            pid = build_persona(sc, persona_ids)
            inspect_persona(pid, sc["label"])

        x_id, y_id, z_id = persona_ids
        fire_x_and_watch(x_id, y_id, z_id)
        cleanup(persona_ids)
    except SystemExit as e:
        record("scenario.abort", "fail", error=str(e))
        # Best-effort cleanup even on abort
        if not args.no_cleanup:
            cleanup(persona_ids)
    except Exception as e:
        record("scenario.crash", "fail", error=repr(e))
        if not args.no_cleanup:
            cleanup(persona_ids)
        raise
    finally:
        finished = datetime.now(timezone.utc)
        summary = {
            "scenario": "phase-b-chained-personas",
            "started": started.isoformat(),
            "finished": finished.isoformat(),
            "duration_s": (finished - started).total_seconds(),
            "persona_ids": persona_ids,
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
