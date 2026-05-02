r"""
Phase G — dry-run preview E2E (C7 increment, 2026-04-28).

Builds a small persona end-to-end, then exercises the new dry-run preview
path:

    1. startBuildFromIntent → poll-and-answer-loop → draft_ready/test_complete
    2. triggerBuildTest (still required to confirm tool wiring)
    3. simulateBuildDraft({useCaseId, inputOverride}) — runs execute_persona_inner
       with is_simulation=true against a temporary design_context snapshot
    4. getSimulationArtefacts({executionId}) — fetches manual reviews + memories
    5. Asserts the response shape (executionId, reviews[], memories[])

Slice-scope: this driver does NOT promote (the dry-run is callable from
draft_ready / test_complete WITHOUT promote). It is therefore safe to
re-run repeatedly without polluting the persona list.

The dry-run feature itself is exhaustively unit-tested
(`build_simulate.rs::tests` 8 cases, `BuildSimulatePanel.test.tsx` 12 cases).
This driver is the live integration check.

Prereqs:
  1. Dev app running with test-automation feature:
       npx tauri dev -- --features test-automation
  2. Test server is reachable:
       curl http://127.0.0.1:17320/health

Usage:
  uvx --with httpx python tools/test-mcp/e2e_phase_g.py
  uvx --with httpx python tools/test-mcp/e2e_phase_g.py --report logs/phase-g.json
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

INTENT = (
    "A simple notes summarizer. One capability: every morning at 8am local "
    "time, take any notes I added to a local-drive folder yesterday and "
    "produce a one-paragraph digest. Auto-publish (no review). Stateless."
)

# The capability the LLM tends to enumerate for this intent — we will
# fall back to "first capability in the IR" when matching by title fails.
EXPECTED_UC_TITLE_HINT = "digest"

parser = argparse.ArgumentParser(description="Phase G dry-run preview E2E")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument("--build-timeout", type=int, default=240)
parser.add_argument("--simulate-timeout", type=int, default=300)
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
        "A morning notes summarizer. Mission: keep me oriented to what I "
        "captured yesterday in one short paragraph. Operates on a single "
        "schedule, no human review."
    ),
    "mission": (
        "Be the user's morning catch-up: every morning summarize yesterday's "
        "notes into one short paragraph."
    ),
    "use-cases": (
        "ONE capability — Morning Digest. Schedule trigger 0 8 * * * (daily "
        "8am local time). Reads notes from local-drive (folder path TBD by "
        "user). Output is one short paragraph."
    ),
    "triggers": (
        "Schedule trigger only: cron '0 8 * * *' (daily 8am). No event, no "
        "polling, no manual."
    ),
    "connectors": (
        "Use the local_drive connector. Read-only — the digest is rendered "
        "into a built-in titlebar notification, not written back to drive."
    ),
    "events": "No external event subscriptions or emits.",
    "human-review": "Never review — auto-publish.",
    "messages": "Render via built-in titlebar notification.",
    "memory": "Stateless — each morning is independent of yesterday.",
    "error-handling": (
        "If the drive read fails, log and skip — try again tomorrow. "
        "Never block the schedule."
    ),
}


# ---- Steps -------------------------------------------------------------


def step_preflight() -> None:
    print("\n[1/5] Preflight")
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
    print("\n[2/5] Start build")
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


def step_answer_dimensions() -> str:
    """Drive the build through clarifying questions until draft_ready /
    test_complete. Returns the final phase reached."""
    print("\n[3/5] Answer build clarifying questions")

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
            batch[key] = ANSWERS.get(key, f"Auto-answer for phase G: {key}")

        if not batch:
            record(
                f"answer.round{round_ix}",
                "info",
                note="no recognizable cellKeys",
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


def step_test_build() -> None:
    """test_build_draft is required before simulate to ensure tool wiring is
    valid (some test fixtures won't pass; that's fine — we still simulate
    against the IR). Phase G's contract is: dry-run runs whether or not
    tool tests passed."""
    print("\n[4/5] Test build draft (tool wiring)")
    test = bridge("triggerBuildTest", {}, 60)
    record(
        "test_build_draft",
        "ok" if test.get("success") else "info",
        report_keys=list((test.get("report") or {}).keys()) if test.get("success") else None,
        error=test.get("error"),
    )


def _resolve_uc_id(persona_id: str) -> str:
    """Pull the first capability id out of the draft IR. The dry-run path
    is callable PRE-promote, when `personas.design_context` and
    `personas.last_design_result` are both still NULL — so we read the
    typed `agent_ir` straight off the active build session row.

    Falls back to title-hint matching for an extra signal in the report."""
    sess_resp = bridge("getActiveBuildSession", {"personaId": persona_id}, 30)
    if not sess_resp.get("success"):
        raise SystemExit(f"getActiveBuildSession failed: {sess_resp.get('error')}")

    session = sess_resp.get("session") or {}
    if not session:
        raise SystemExit(
            "No active build session for persona — was it cancelled or already promoted?"
        )
    agent_ir = session.get("agentIr") or session.get("agent_ir") or {}
    use_cases = (
        agent_ir.get("use_cases")
        or agent_ir.get("useCases")
        or agent_ir.get("use_case_flows")
        or []
    )

    if not use_cases:
        # Last resort: peek at persona.design_context too (in case the
        # session was promoted between phase 4 and 5, in which case
        # design_context is now populated).
        detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
        if detail.get("success"):
            d = detail.get("detail") or {}
            raw_dc = d.get("design_context")
            try:
                dc = json.loads(raw_dc) if isinstance(raw_dc, str) else (raw_dc or {})
            except json.JSONDecodeError:
                dc = {}
            use_cases = dc.get("use_cases") or dc.get("useCases") or []

    if not use_cases:
        record(
            "uc_id.no_use_cases",
            "fail",
            agent_ir_keys=list(agent_ir.keys()) if isinstance(agent_ir, dict) else None,
        )
        raise SystemExit(
            "No use_cases found in session.agent_ir — draft IR may not be "
            "fully resolved (build phase not yet draft_ready?)."
        )

    first = use_cases[0]
    if isinstance(first, str):
        # IR can carry simple-string variant; fabricate the id the way the
        # build_simulate snapshot helper does (uc_idx_<n>).
        uc_id = "uc_idx_0"
    elif isinstance(first, dict):
        uc_id = first.get("id")
        if not uc_id:
            uc_id = "uc_idx_0"
    else:
        raise SystemExit(f"First use_case has unexpected type: {type(first).__name__}")

    title = (
        first.get("title", "") if isinstance(first, dict) else (first if isinstance(first, str) else "")
    )
    matches_hint = EXPECTED_UC_TITLE_HINT.lower() in title.lower()
    record(
        "uc_id.resolved",
        "ok",
        use_case_id=uc_id,
        title=title[:80] if title else "",
        matches_hint=matches_hint,
    )
    return uc_id


def step_simulate(persona_id: str) -> dict:
    print("\n[5/5] Simulate + fetch artefacts")
    uc_id = _resolve_uc_id(persona_id)

    sim = bridge(
        "simulateBuildDraft",
        {"useCaseId": uc_id},
        args.simulate_timeout,
    )
    if not sim.get("success"):
        record("simulate", "fail", error=sim.get("error"))
        raise SystemExit(f"simulateBuildDraft failed: {sim.get('error')}")

    exec_row = sim.get("execution") or {}
    exec_id = exec_row.get("id")
    if not exec_id:
        record("simulate", "fail", error="execution row missing id", exec_row=exec_row)
        raise SystemExit("simulateBuildDraft returned no execution id")

    record(
        "simulate",
        "ok",
        execution_id=exec_id,
        status=exec_row.get("status"),
        is_simulation=exec_row.get("is_simulation"),
    )

    artefacts = bridge("getSimulationArtefacts", {"executionId": exec_id}, 30)
    if not artefacts.get("success"):
        record("artefacts", "fail", error=artefacts.get("error"))
        raise SystemExit(f"getSimulationArtefacts failed: {artefacts.get('error')}")

    art = artefacts.get("artefacts") or {}
    reviews = art.get("reviews") or []
    memories = art.get("memories") or []
    record(
        "artefacts",
        "ok",
        execution_id=art.get("executionId"),
        reviews_count=len(reviews),
        memories_count=len(memories),
    )

    # Acceptance gates — shape only, not content. The simulation may produce
    # zero artefacts if the LLM didn't emit any manual_review/memory; that's
    # fine. The slice-level contract is that the IPC chain works.
    if art.get("executionId") != exec_id:
        record(
            "acceptance.execution_id_match",
            "fail",
            artefacts_id=art.get("executionId"),
            expected=exec_id,
        )
        raise SystemExit("Artefacts response executionId mismatch")
    record("acceptance.execution_id_match", "ok")

    if not isinstance(reviews, list):
        record("acceptance.reviews_is_array", "fail", got_type=type(reviews).__name__)
        raise SystemExit("Artefacts.reviews is not an array")
    record("acceptance.reviews_is_array", "ok", count=len(reviews))

    if not isinstance(memories, list):
        record("acceptance.memories_is_array", "fail", got_type=type(memories).__name__)
        raise SystemExit("Artefacts.memories is not an array")
    record("acceptance.memories_is_array", "ok", count=len(memories))

    return {
        "execution_id": exec_id,
        "execution_status": exec_row.get("status"),
        "reviews_count": len(reviews),
        "memories_count": len(memories),
    }


def step_cleanup(persona_id: str | None) -> None:
    if args.no_persona_cleanup or not persona_id:
        return
    print("\n[cleanup] deleteAgent")
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
    try:
        step_preflight()
        build = step_start_build()
        persona_id = build.get("personaId")
        step_answer_dimensions()
        step_test_build()
        summary_payload = step_simulate(persona_id)
        step_cleanup(persona_id)
    except SystemExit as e:
        record("scenario.abort", "fail", error=str(e))
    except Exception as e:
        record("scenario.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        summary = {
            "scenario": "phase_g_dry_run",
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
