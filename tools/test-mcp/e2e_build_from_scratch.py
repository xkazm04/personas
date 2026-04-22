r"""
End-to-end scenario: Build-from-scratch → Drive event → Persona execution.

Drives the real desktop app through the full chronology the team set as the
acceptance criteria for core functionality:

  1. User prompts: "translate all incoming documents from English to Czech"
  2. Build session starts, LLM emits clarifying questions across four
     dimensions (trigger, source/connectors, human-review, destination)
  3. The script supplies deterministic answers (source = built-in
     `local_drive` connector)
  4. Draft is tested & promoted → persona row exists
  5. A document is written into the built-in Local Drive, which now emits
     `drive.document.added` (see commands/drive.rs)
  6. The event bus matches the new persona's subscription and fires its use
     case; the script waits for a terminal execution row

Prerequisites:
  1. Dev app running with test-automation feature + drive events:
       cargo tauri dev --features "test-automation desktop"
     or
       npx tauri dev --features test-automation
  2. Confirm the test server responds:
       curl http://127.0.0.1:17320/health

Usage:
  uvx --with httpx python tools/test-mcp/e2e_build_from_scratch.py
  uvx --with httpx python tools/test-mcp/e2e_build_from_scratch.py --port 17320
  uvx --with httpx python tools/test-mcp/e2e_build_from_scratch.py --skip-execution

Flags:
  --port <int>            test-automation server port (default 17320)
  --intent <str>          override the default intent prompt
  --doc-path <str>        where to write the test document inside Local Drive
                          (default `inbox/eng-sample.md`)
  --doc-content <str>     English content to translate (default hardcoded)
  --build-timeout <sec>   max time for each build phase transition (default 180)
  --exec-timeout <sec>    max time to wait for persona execution (default 240)
  --skip-execution        stop after promotion; skip drive-event phase
  --no-persona-cleanup    keep the created persona in the DB after the run
  --report <path>         write the JSON run log here (default stdout)
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

parser = argparse.ArgumentParser(description="Build-from-scratch E2E scenario")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument(
    "--intent",
    type=str,
    default=(
        "Translate every document I drop into my local drive from "
        "English to Czech and save the translated copy next to it."
    ),
)
parser.add_argument("--doc-path", type=str, default="inbox/eng-sample.md")
parser.add_argument(
    "--doc-content",
    type=str,
    default=(
        "# Quarterly update\n\n"
        "Hello team,\n\n"
        "Our revenue grew 17% in Q1. Customer satisfaction is at an all-time "
        "high, and the product roadmap for Q2 is on track. Let me know if you "
        "have any questions.\n\n"
        "Best,\nAlex"
    ),
)
parser.add_argument("--build-timeout", type=int, default=180)
parser.add_argument("--exec-timeout", type=int, default=240)
parser.add_argument("--skip-execution", action="store_true")
parser.add_argument("--no-persona-cleanup", action="store_true")
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
    """Dispatch to any bridge method via the generic /bridge-exec route."""
    raw = post(
        "/bridge-exec",
        {"method": method, "params": params or {}, "timeout_secs": timeout_secs},
        timeout=timeout_secs + 20,
    )
    # The generic handler returns the bridge's own JSON as a string; the HTTP
    # layer already parsed it once. Some methods wrap in {error: ...} on
    # failure; callers handle both shapes.
    return raw


# ---- Scenario event log ----------------------------------------------

log: list[dict] = []


def record(step: str, outcome: str, **kw) -> dict:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "step": step, "outcome": outcome}
    entry.update(kw)
    log.append(entry)
    # ASCII-only markers — some Windows consoles default to cp1250 which
    # can't encode the pretty Unicode glyphs and crashes sys.stdout.write.
    marker = "[OK]" if outcome == "ok" else ("[..]" if outcome == "info" else "[XX]")
    sys.stdout.write(f"  {marker} {step}: {outcome}")
    if kw:
        brief = {k: v for k, v in kw.items() if k not in ("detail",) and not isinstance(v, (dict, list))}
        if brief:
            sys.stdout.write(f"  {brief}")
    sys.stdout.write("\n")
    sys.stdout.flush()
    return entry


# ---- Scenario steps --------------------------------------------------


def step_preflight() -> None:
    print("\n[1/7] Preflight")
    try:
        h = get("/health")
    except Exception as e:
        record("preflight.health", "fail", error=str(e))
        raise SystemExit(
            "Test-automation server not responding. Launch the app with "
            "`cargo tauri dev --features \"test-automation desktop\"` first."
        ) from e
    record("preflight.health", "ok", server=h.get("server"), version=h.get("version"))


def step_start_build() -> dict:
    print("\n[2/7] Start build-from-scratch")
    # The bridge wrapper handles isCreatingPersona + textarea + launch click.
    r = bridge("startBuildFromIntent", {"intent": args.intent, "timeoutMs": 30_000}, 40)
    if not r.get("success"):
        record("start_build", "fail", error=r.get("error"))
        raise SystemExit(f"startBuildFromIntent failed: {r.get('error')}")
    record("start_build", "ok", session_id=r.get("sessionId"), persona_id=r.get("personaId"))
    return r


def step_answer_dimensions() -> None:
    """
    Drive the LLM's clarifying questions. The v3 build prompt may emit
    scope='mission' first, then per-field capability_resolution questions
    across trigger / connectors / review / notification_channels. We loop
    until draft_ready or test_complete, answering whatever is pending.

    Deterministic answers keyed by cellKey. When the LLM asks a question
    we don't recognize, we fall back to a scenario-aware default that
    names the local_drive connector and the translation output intent.
    """
    print("\n[3/7] Answer build clarifying questions")

    answer_recipes = {
        # Mission / behavior_core scope — LLM sometimes asks what shape
        # the persona should take before emitting behavior_core.
        "behavior_core": (
            "Option: event-driven translator. Every time a new English "
            "document lands in the built-in local drive, translate it to "
            "Czech and save the translated copy alongside the original. "
            "No schedule. No manual review required."
        ),
        "mission": (
            "Option: event-driven translator. Every time a new English "
            "document lands in the built-in local drive, translate it to "
            "Czech and save the translated copy alongside the original. "
            "No schedule. No manual review required."
        ),
        # Trigger — skip / event-driven (incoming document)
        "triggers": (
            "STRICTLY event-driven. DO NOT use polling, DO NOT use a schedule, "
            "DO NOT use a manual trigger. The trigger MUST be "
            '`{"trigger_type":"event","config":{}}` and the capability\'s '
            "event_subscriptions MUST include "
            '`{"event_type":"drive.document.added","direction":"listen"}` so the '
            "app's built-in local_drive event bus invokes this persona when a "
            "new document arrives. No other trigger shape is acceptable."
        ),
        # Source: built-in local_drive connector. Three levels of dot-syntax
        # so the prompt emits drive.document.added in event_subscriptions.
        "connectors": (
            "Use the built-in local_drive connector. The agent should listen for "
            "`drive.document.added` events on local_drive and read the file via "
            "drive_read_text. No external storage providers are needed."
        ),
        # Events dimension sometimes asked separately
        "events": (
            "Subscribe to drive.document.added emitted by the local_drive "
            "connector. Emit drive.document.translated once output is saved."
        ),
        # HITL: auto-deliver, never block on review
        "human-review": (
            "Never require manual review — the translation is reversible and "
            "user can discard the output file if unhappy."
        ),
        # Destination / notifications — write back to drive and notify via built-in
        "messages": (
            "Save the Czech translation to the same folder as the source file "
            "using the suffix `.cs.md` (or preserve the original extension with "
            "`.cs` inserted before it). Also surface a built-in status message "
            "summarizing what was translated."
        ),
        # Memory — off, stateless
        "memory": (
            "No memory needed. Each translation is independent; no cross-run state."
        ),
        # Error handling — best-effort, don't retry indefinitely
        "error-handling": (
            "If translation fails, log the error, emit a built-in message, and "
            "leave the source file untouched. Do not retry more than twice."
        ),
        # Use cases summary (sometimes requested)
        "use-cases": (
            "Single capability: Translate Incoming Document. Input: new drive "
            "file. Output: Czech-translated sibling file plus a summary message."
        ),
    }

    max_rounds = 12
    for round_ix in range(max_rounds):
        phase_r = bridge(
            "waitForBuildPhase",
            {"phases": ["awaiting_input", "draft_ready", "test_complete", "promoted", "failed"], "timeoutMs": args.build_timeout * 1000},
            args.build_timeout + 10,
        )
        phase = phase_r.get("phase")
        record(f"wait.phase.round{round_ix}", "ok" if phase_r.get("success") else "info", phase=phase, pending=phase_r.get("pendingCount"))

        if phase in ("failed",):
            raise SystemExit(f"Build failed mid-flight: {phase_r.get('error')}")
        if phase in ("draft_ready", "test_complete", "promoted"):
            record("answer_dimensions", "ok", final_phase=phase, rounds=round_ix)
            return
        if phase != "awaiting_input":
            # The bridge didn't hit awaiting_input within the timeout — push on.
            continue

        qs = bridge("listPendingBuildQuestions", {}, 20).get("questions") or []
        if not qs:
            # Race: phase says awaiting_input but store hasn't applied the
            # questions slice yet. Give it a short breath.
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
                # Defensive fallback: answer with the scenario summary so the LLM
                # has enough context to continue.
                batch[key] = (
                    "Auto-scenario answer: translate every incoming local_drive "
                    "document from English to Czech, save result next to source, "
                    "no human review, no memory. Use local_drive connector."
                )

        if not batch:
            record(f"answer.round{round_ix}", "info", note="pending questions had no recognizable keys", qs=qs)
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

    raise SystemExit(f"Exceeded max answer rounds ({max_rounds}) without reaching draft_ready")


def step_test_and_promote() -> dict:
    print("\n[4/7] Test + promote draft")

    test = bridge("triggerBuildTest", {}, 60)
    if test.get("success"):
        record("test_build_draft", "ok", report_keys=list((test.get("report") or {}).keys()))
    else:
        # Not fatal — we can promote a draft_ready session without the test step.
        record("test_build_draft", "info", error=test.get("error"))

    promote = bridge("promoteBuildDraft", {}, 60)
    if not promote.get("success"):
        record("promote_build_draft", "fail", error=promote.get("error"))
        raise SystemExit(f"promoteBuildDraft failed: {promote.get('error')}")
    record("promote_build_draft", "ok", persona_id=promote.get("personaId"))
    return promote


def _parse_maybe_json(v):
    """Persona detail serializes `design_context` and `last_design_result`
    as JSON strings over IPC. Parse defensively."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v or {}


def step_inspect_persona(persona_id: str) -> dict:
    print("\n[5/7] Inspect promoted persona shape")
    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record("persona_detail", "fail", error=detail.get("error"))
        return {}
    d = detail.get("detail") or {}
    design_context = _parse_maybe_json(d.get("design_context"))
    last_design_result = _parse_maybe_json(d.get("last_design_result"))
    use_cases = design_context.get("useCases") or []
    triggers = d.get("triggers") or []
    # Persona detail uses `subscriptions`; older call sites used `event_subscriptions`.
    subs = d.get("subscriptions") or d.get("event_subscriptions") or []
    connectors = last_design_result.get("suggested_connectors") or []
    record(
        "persona_detail",
        "ok",
        name=d.get("name"),
        use_cases=len(use_cases),
        triggers=len(triggers),
        subscriptions=len(subs),
        connectors=[c if isinstance(c, str) else c.get("name") for c in connectors],
    )
    # Capture trigger shapes so the run report shows what the LLM chose.
    for t in triggers:
        cfg = _parse_maybe_json(t.get("config"))
        record(
            "persona_trigger",
            "ok",
            trigger_type=t.get("trigger_type"),
            use_case_id=t.get("use_case_id"),
            config_keys=list(cfg.keys()) if isinstance(cfg, dict) else None,
        )

    # Did the persona actually get a drive.document.* subscription on a UC?
    # Collect from both persona-level and per-use-case subscriptions.
    uc_subs = []
    for uc in use_cases:
        for s in (uc.get("event_subscriptions") or []):
            uc_subs.append({"source": "use_case", "use_case_id": uc.get("id"), **s})
    persona_subs = [{"source": "persona", **s} for s in subs]
    all_subs = uc_subs + persona_subs

    drive_subs = [s for s in all_subs if (s.get("event_type") or "").startswith("drive.document.") and s.get("direction") != "emit"]
    if drive_subs:
        record("subscription.drive", "ok", count=len(drive_subs), events=[s.get("event_type") for s in drive_subs])
    else:
        record(
            "subscription.drive",
            "info",
            note="Persona was not given a drive.document.* LISTEN subscription. Drive write will not fire this persona — a polling trigger (if any) will pick up changes on its own interval.",
            all_events=[(s.get("event_type"), s.get("direction")) for s in all_subs],
        )
    return d


def step_drive_write_and_wait_execution(persona_id: str) -> None:
    if args.skip_execution:
        record("drive.execution", "info", note="skipped via --skip-execution")
        return

    print("\n[6/7] Drive-write to fire the trigger")
    before = datetime.now(timezone.utc).isoformat()

    write = bridge(
        "driveWriteText",
        {"relPath": args.doc_path, "content": args.doc_content},
        30,
    )
    if not write.get("success"):
        record("drive_write", "fail", error=write.get("error"))
        raise SystemExit(f"driveWriteText failed: {write.get('error')}")
    record("drive_write", "ok", path=args.doc_path)

    print("\n[7/7] Wait for persona execution")
    # The bridge helper slices at 20s so the __exec__ 25s rejection can't fire.
    # Loop here until the outer scenario budget expires or a terminal status.
    deadline = time.time() + args.exec_timeout
    exe = {"success": False, "timedOut": True}
    while time.time() < deadline and exe.get("timedOut"):
        exe = bridge(
            "waitForPersonaExecution",
            {"personaId": persona_id, "sinceIso": before, "timeoutMs": 20_000},
            25,
        )
        if exe.get("success"):
            break
        if not exe.get("timedOut"):
            break  # non-timedOut failure — don't keep polling
    if not exe.get("success"):
        record(
            "persona_execution",
            "fail",
            error=exe.get("error"),
            hint=(
                "If the persona has no drive.document.* subscription, the event "
                "fires but no trigger matches. Inspect the 'persona_detail' step above."
            ),
        )
        return
    execution = exe.get("execution") or {}
    record(
        "persona_execution",
        "ok",
        execution_id=execution.get("id"),
        status=execution.get("status"),
        use_case_id=execution.get("use_case_id"),
    )

    # Best-effort: poll drive for the translated sibling file.
    translated_candidates = [
        args.doc_path.replace(".md", ".cs.md"),
        args.doc_path.replace(".md", ".cz.md"),
        args.doc_path.replace(".md", "_cs.md"),
        args.doc_path + ".cs",
    ]
    for candidate in translated_candidates:
        r = bridge("driveReadText", {"relPath": candidate}, 15)
        if r.get("success"):
            content = (r.get("content") or "")
            record("translated_file", "ok", path=candidate, chars=len(content), head=content[:120])
            return
    record("translated_file", "info", note="no translated sibling file found", tried=translated_candidates)


def step_cleanup(persona_id: str | None) -> None:
    if args.no_persona_cleanup or not persona_id:
        return
    print("\n[cleanup] deleteAgent")
    r = bridge("deleteAgent", {"nameOrId": persona_id}, 30)
    record("cleanup.deleteAgent", "ok" if r.get("success") else "info", **{k: v for k, v in r.items() if k != "success"})


# ---- Main ------------------------------------------------------------


def main() -> None:
    started = datetime.now(timezone.utc)
    try:
        step_preflight()
        build = step_start_build()
        step_answer_dimensions()
        promote = step_test_and_promote()
        persona_id = promote.get("personaId") or build.get("personaId")
        step_inspect_persona(persona_id)
        step_drive_write_and_wait_execution(persona_id)
        step_cleanup(persona_id)
    except SystemExit as e:
        record("scenario.abort", "fail", error=str(e))
    except Exception as e:
        record("scenario.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        summary = {
            "started": started.isoformat(),
            "finished": finished.isoformat(),
            "duration_s": (finished - started).total_seconds(),
            "log": log,
        }
        if args.report:
            Path(args.report).write_text(json.dumps(summary, indent=2))
            print(f"\nWrote {args.report}")
        else:
            print("\n── summary ──")
            print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
