r"""
End-to-end batch runner: drive multiple persona-from-scratch builds.

Reads scenarios as `(slug, intent)` pairs and for each one drives the
canonical build chronology — startBuildFromIntent → answer clarifying
questions with sensible generic defaults → wait for draft_ready (or
test_complete). Does NOT do the drive-event / execution phase; the
goal is structural build-flow verification, not end-to-end execution
of each persona's real work.

Mirrors the test plan in docs/tests/e2e/test-matrix-build-scenarios.md
(scenarios 1-10 by default; --scenarios accepts a subset).

Prerequisites:
  1. Dev app running with test-automation feature:
       npm run tauri:dev:test
  2. Test server reachable at http://127.0.0.1:17320/health.

Usage:
  uvx --with httpx python tools/test-mcp/e2e_scratch_scenarios.py
  uvx --with httpx python tools/test-mcp/e2e_scratch_scenarios.py --scenarios 1,3,7
  uvx --with httpx python tools/test-mcp/e2e_scratch_scenarios.py --report docs/tests/results/scratch-batch.json

Flags:
  --port <int>        test-automation server port (default 17320)
  --scenarios <list>  comma-separated 1-based scenario indices (default 1-10)
  --build-timeout <s> max per-phase wait (default 240)
  --keep              do NOT delete the created persona on completion
  --report <path>     write JSON run log here (default scratch-batch.json next to script)
  --skip-test         skip the test_build_draft step (faster; only verifies draft_ready)
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Optional

from lib import Bridge, Client, EventLog


# ---- Scenario catalogue --------------------------------------------------
# Mirrors docs/tests/e2e/test-matrix-build-scenarios.md scenarios 1-10. Keep
# slugs short — they become the cleanup identifier if the run aborts.

SCENARIOS: list[tuple[str, str]] = [
    (
        "01-email-triage",
        "Monitor my Gmail for important emails and post summaries to a task list in Notion",
    ),
    (
        "02-sprint-automation",
        "Automate our Linear sprint workflow — create tasks from requirements, track blockers, post daily standups",
    ),
    (
        "03-expense-processing",
        "Process expense receipts from Gmail, extract amounts, and log them to Airtable for monthly reporting",
    ),
    (
        "04-research-report",
        "Research trending topics in my industry weekly and compile findings into a Notion knowledge base",
    ),
    (
        "05-crm-data-quality",
        "Audit our Attio CRM for duplicate contacts, missing fields, and stale deals — post findings to a report",
    ),
    (
        "06-meeting-lifecycle",
        "Before each Google Calendar meeting, create an agenda in Notion. After the meeting, generate action items and track them in Asana",
    ),
    (
        "07-error-monitoring",
        "Watch Sentry for new error spikes and critical issues, create tracking tickets in Linear, and log incidents in Airtable",
    ),
    (
        "08-appointment-sync",
        "Sync my Cal.com bookings with Google Calendar and create preparation notes in Notion for each upcoming appointment",
    ),
    (
        "09-image-asset-creator",
        "Generate product images using Leonardo AI based on briefs in an Airtable board, store results back in Airtable with metadata",
    ),
    (
        "10-uptime-logger",
        "Monitor Better Stack for incidents, log them to Supabase with timestamps, and create follow-up tasks in ClickUp",
    ),
]


# ---- Generic answer recipes ---------------------------------------------
# Keyed by cellKey. Intent-agnostic — works for any of the 10 scenarios
# because the answers describe *behaviour* rather than tying to a specific
# service. Mirrors the keys e2e_build_from_scratch.py uses but with
# generic content so the LLM can map them to whatever services the
# scenario invoked.

GENERIC_ANSWERS: dict[str, str] = {
    "behavior_core": (
        "Build the persona to cover the user's intent directly. Keep its mission "
        "narrow to the described work and let the connectors / triggers / "
        "messaging dimensions handle the rest."
    ),
    "mission": (
        "The mission is exactly the user's intent verbatim — no extra scope. "
        "Other dimensions resolve the schedule, services, and output."
    ),
    "triggers": (
        "Pick the most natural trigger for the described work: a daily schedule "
        "for periodic / digest / report intents; an event subscription for "
        "reactive / monitoring intents; a manual trigger only when neither fits."
    ),
    "connectors": (
        "Use the connectors named or implied by the intent. The user has these "
        "credentials available in the vault: Gmail, Google Calendar, Notion, "
        "Airtable, Asana, ClickUp, Linear, Sentry, Better Stack, Cal.com, "
        "Leonardo AI, Supabase, Attio, and the built-in local_drive / "
        "personas_database / personas_messages. If a connector is missing, "
        "suggest the closest available alternative."
    ),
    "events": (
        "Emit standard lifecycle events for the capability: <capability>.started, "
        "<capability>.completed, <capability>.failed. Subscribe only to events "
        "the intent explicitly requires."
    ),
    "human-review": (
        "No manual review required — operate autonomously. The user can audit "
        "outputs after the fact through the execution log."
    ),
    "messages": (
        "Deliver outputs through the built-in messaging channel (in-app inbox). "
        "Format: concise summary up top, full detail below. No external chat "
        "fanout unless the intent names one explicitly."
    ),
    "memory": (
        "Keep memory minimal: track recurring patterns or recent context only "
        "when it directly improves the next run. Otherwise stateless."
    ),
    "error-handling": (
        "Retry transient failures (network, rate limit) up to 3 times with "
        "exponential backoff. Surface a clear error message and stop on "
        "anything else."
    ),
    "use-cases": (
        "A single primary capability covering the user's intent end-to-end. "
        "Do not split into multiple capabilities unless the intent explicitly "
        "names independent workflows."
    ),
    # Last-resort fallback when an unrecognized cellKey shows up.
    "__default__": (
        "Pick the most natural default for this dimension that aligns with the "
        "user's intent. Avoid speculation; if the dimension is not central to "
        "the intent, default to off / stateless / no-review / no-extra-channels."
    ),
}


# ---- CLI ----------------------------------------------------------------

parser = argparse.ArgumentParser(description="Persona-from-scratch batch runner")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument("--scenarios", type=str, default=None,
                    help="Comma-separated 1-based indices (e.g. '1,3,7'). Default: all 10.")
parser.add_argument("--build-timeout", type=int, default=240)
parser.add_argument("--keep", action="store_true",
                    help="Keep the created personas after each run (default: delete).")
parser.add_argument("--report", type=str, default=None)
parser.add_argument("--skip-test", action="store_true",
                    help="Skip the test_build_draft step; only verify draft_ready.")
args = parser.parse_args()


def parse_scenario_filter(raw: Optional[str]) -> list[int]:
    if not raw:
        return list(range(len(SCENARIOS)))
    out: list[int] = []
    for piece in raw.split(","):
        piece = piece.strip()
        if not piece:
            continue
        try:
            idx = int(piece) - 1
        except ValueError:
            raise SystemExit(f"--scenarios accepts integers only, got '{piece}'")
        if idx < 0 or idx >= len(SCENARIOS):
            raise SystemExit(f"--scenarios index {piece} out of range (1..{len(SCENARIOS)})")
        out.append(idx)
    return out


targets = parse_scenario_filter(args.scenarios)


client = Client(port=args.port, default_timeout=240)
bridge_impl = Bridge(client)
log = EventLog()


def call(method: str, params: dict | None = None, timeout_secs: int = 60) -> dict:
    return bridge_impl.exec(method, params, timeout_secs)


def record(step: str, outcome: str, **kw) -> dict:
    return log.record(step, outcome, **kw)


def run_scenario(slug: str, intent: str) -> dict:
    """Drive one scenario through the build chronology. Returns a result dict
    summarizing the outcome — never raises (errors are captured into the
    result so the batch keeps moving)."""
    print(f"\n=== {slug} ===")
    print(f"intent: {intent}")
    started_at = time.time()
    result: dict = {
        "slug": slug,
        "intent": intent,
        "outcome": "pending",
        "phase": None,
        "rounds": 0,
        "questions_answered": 0,
        "persona_id": None,
        "persona_name": None,
        "session_id": None,
        "elapsed_s": None,
        "error": None,
    }

    # Start build
    try:
        r = call("startBuildFromIntent", {"intent": intent, "timeoutMs": 30_000}, 45)
    except Exception as e:
        result["outcome"] = "fail"
        result["error"] = f"startBuildFromIntent threw: {e}"
        print(f"  [FAIL] start: {e}")
        return result
    if not r.get("success"):
        result["outcome"] = "fail"
        result["error"] = f"startBuildFromIntent: {r.get('error')}"
        record(f"{slug}.start_build", "fail", error=r.get("error"))
        print(f"  [FAIL] start: {r.get('error')}")
        return result
    result["session_id"] = r.get("sessionId")
    result["persona_id"] = r.get("personaId")
    record(f"{slug}.start_build", "ok", session_id=result["session_id"], persona_id=result["persona_id"])
    print(f"  [OK] start: session={result['session_id'][:8] if result['session_id'] else '?'} persona={result['persona_id'][:8] if result['persona_id'] else '?'}")

    # Drive Q&A loop
    max_rounds = 30
    answered_total = 0
    final_phase = None
    for round_ix in range(max_rounds):
        try:
            phase_r = call(
                "waitForBuildPhase",
                {"phases": ["awaiting_input", "draft_ready", "test_complete", "promoted", "failed"],
                 "timeoutMs": args.build_timeout * 1000},
                args.build_timeout + 10,
            )
        except Exception as e:
            result["outcome"] = "fail"
            result["error"] = f"waitForBuildPhase threw on round {round_ix}: {e}"
            record(f"{slug}.wait.round{round_ix}", "fail", error=str(e))
            print(f"  [FAIL] waitForBuildPhase round {round_ix}: {e}")
            return result

        phase = phase_r.get("phase")
        final_phase = phase
        if phase == "failed":
            result["outcome"] = "fail"
            result["error"] = f"build failed mid-flight: {phase_r.get('error')}"
            record(f"{slug}.wait.round{round_ix}", "fail", phase=phase, error=phase_r.get("error"))
            print(f"  [FAIL] build failed: {phase_r.get('error')}")
            return result
        if phase in ("draft_ready", "test_complete", "promoted"):
            result["rounds"] = round_ix
            result["phase"] = phase
            record(f"{slug}.wait.round{round_ix}", "ok", phase=phase)
            print(f"  [OK] reached {phase} after {round_ix} rounds")
            break
        if phase != "awaiting_input":
            # Still working — keep looping until timeout.
            continue

        qs = call("listPendingBuildQuestions", {}, 20).get("questions") or []
        if not qs:
            time.sleep(1.0)
            continue

        batch: dict[str, str] = {}
        for q in qs:
            key = q.get("cellKey") or q.get("cell_key")
            if not key:
                continue
            batch[key] = GENERIC_ANSWERS.get(key, GENERIC_ANSWERS["__default__"])

        if not batch:
            record(f"{slug}.answer.round{round_ix}", "info", note="pending questions had no recognizable keys", qs=qs)
            time.sleep(1.0)
            continue

        try:
            submit = call("answerPendingBuildQuestions", {"answers": batch}, 60)
        except Exception as e:
            result["outcome"] = "fail"
            result["error"] = f"answerPendingBuildQuestions threw on round {round_ix}: {e}"
            record(f"{slug}.answer.round{round_ix}", "fail", error=str(e))
            print(f"  [FAIL] answerPendingBuildQuestions round {round_ix}: {e}")
            return result
        if not submit.get("success"):
            result["outcome"] = "fail"
            result["error"] = f"answerPendingBuildQuestions: {submit.get('error')}"
            record(f"{slug}.answer.round{round_ix}", "fail", error=submit.get("error"))
            print(f"  [FAIL] answer round {round_ix}: {submit.get('error')}")
            return result
        # `answered` can be a list of question ids (newer bridge) or an int
        # (older shape). Coerce to a count either way so the running total
        # is type-safe.
        ans_field = submit.get("answered")
        ans_count = len(ans_field) if isinstance(ans_field, list) else (ans_field or 0)
        answered_total += ans_count
        record(f"{slug}.answer.round{round_ix}", "ok", answered=ans_count)
        print(f"  [..] round {round_ix}: answered {ans_count} question(s) on dims {list(batch.keys())}")
    else:
        result["outcome"] = "fail"
        result["error"] = f"exceeded {max_rounds} answer rounds without reaching draft_ready"
        result["phase"] = final_phase
        print(f"  [FAIL] exceeded {max_rounds} rounds (last phase: {final_phase})")
        return result

    result["questions_answered"] = answered_total

    # Optional test
    if not args.skip_test and final_phase == "draft_ready":
        try:
            test_r = call("triggerBuildTest", {}, 90)
            if test_r.get("success"):
                record(f"{slug}.test_draft", "ok")
                print(f"  [OK] test_build_draft passed")
            else:
                record(f"{slug}.test_draft", "info", error=test_r.get("error"))
                print(f"  [..] test_build_draft skipped/failed: {test_r.get('error')}")
        except Exception as e:
            record(f"{slug}.test_draft", "info", error=str(e))
            print(f"  [..] test_build_draft threw: {e}")

    # Inspect persona shape (best-effort)
    if result["persona_id"]:
        try:
            detail_r = call("getPersonaDetail", {"personaId": result["persona_id"]}, 30)
            if detail_r.get("success"):
                d = detail_r.get("detail") or {}
                result["persona_name"] = d.get("name")
                result["use_cases_count"] = len(d.get("use_cases") or [])
                result["triggers_count"] = len(d.get("triggers") or [])
                record(f"{slug}.inspect", "ok",
                       name=result["persona_name"],
                       use_cases=result["use_cases_count"],
                       triggers=result["triggers_count"])
                print(f"  [OK] persona: name='{result['persona_name']}' use_cases={result['use_cases_count']} triggers={result['triggers_count']}")
        except Exception as e:
            record(f"{slug}.inspect", "info", error=str(e))

    # Cleanup
    if not args.keep and result["persona_id"]:
        try:
            del_r = call("deleteAgent", {"nameOrId": result["persona_id"]}, 30)
            if del_r.get("success"):
                record(f"{slug}.cleanup", "ok", deleted=del_r.get("deleted"))
                print(f"  [OK] cleanup: deleted '{del_r.get('deleted')}'")
            else:
                record(f"{slug}.cleanup", "info", error=del_r.get("error"))
                print(f"  [..] cleanup failed: {del_r.get('error')}")
        except Exception as e:
            record(f"{slug}.cleanup", "info", error=str(e))

    result["outcome"] = "pass"
    result["elapsed_s"] = round(time.time() - started_at, 1)
    return result


# ---- Drive the batch ----------------------------------------------------

print(f"[preflight] checking server at :{args.port}")
try:
    client.get("/health")
except Exception as e:
    raise SystemExit(f"Test-automation server not responding at :{args.port}: {e}")

def between_scenario_reset() -> None:
    """Reset bridge state between scenarios so a stuck build / orphan
    session / poisoned UI from the previous run doesn't fail the next
    one. The 2026-05-23 batch first-run showed that running 10 scenarios
    back-to-back without resetting caused scenarios 2-5's intent input
    to never appear and 6-10's CLI subprocess to produce empty output —
    the dev test bridge needs a beat to clear state."""
    # Best-effort reset; failures here aren't fatal — just log and move on.
    try:
        client.post("/test/reset", {})
    except Exception:
        pass
    time.sleep(2.0)


results: list[dict] = []
batch_started = time.time()
for i, idx in enumerate(targets):
    slug, intent = SCENARIOS[idx]
    if i > 0:
        between_scenario_reset()
    res = run_scenario(slug, intent)
    res["elapsed_s"] = res.get("elapsed_s") or round(time.time() - batch_started, 1)
    results.append(res)

# ---- Summary ------------------------------------------------------------

passed = [r for r in results if r["outcome"] == "pass"]
failed = [r for r in results if r["outcome"] == "fail"]
batch_elapsed = round(time.time() - batch_started, 1)

print("\n" + "=" * 60)
print(f"BATCH SUMMARY — {len(results)} scenario(s), {batch_elapsed}s wall-clock")
print("=" * 60)
for r in results:
    mark = "[PASS]" if r["outcome"] == "pass" else "[FAIL]"
    name = r.get("persona_name") or "?"
    rounds = r.get("rounds") or 0
    phase = r.get("phase") or "?"
    print(f"  {mark} {r['slug']:24s} rounds={rounds:2d} phase={phase:14s} name='{name}'")
    if r["outcome"] == "fail":
        print(f"          error: {r['error']}")
print(f"\n  pass {len(passed)} / fail {len(failed)} / total {len(results)}")

report_path = args.report
if report_path is None:
    report_path = str(Path(__file__).parent / "scratch-batch-report.json")
Path(report_path).parent.mkdir(parents=True, exist_ok=True)
Path(report_path).write_text(
    json.dumps({"results": results, "events": log.entries, "elapsed_s": batch_elapsed}, indent=2),
    encoding="utf-8",
)
print(f"\nReport: {report_path}")

# Exit code: 0 iff every scenario passed.
raise SystemExit(0 if not failed else 1)
