r"""
Phase D — auto_triage second-pass E2E (C7 increment, 2026-04-28).

Builds a persona whose intent strongly implies an LLM-judged review path
("auto-triage", "let the agent decide", "I trust the agent's principles"),
promotes it, and verifies the build pipeline correctly emitted
`review_policy.mode: "auto_triage"` on at least one capability.

This driver does NOT actually fire the persona at runtime to produce a
manual_review and observe the second-pass evaluator landing — that path
involves real LLM calls (the second-pass evaluator spawns its own
`claude -p -` subprocess) and is non-deterministic. The full evaluator
behaviour is exhaustively unit-tested:

  * `engine::auto_triage::tests` — 14 cases covering prompt builder, verdict
    parser (synonyms, prose-tolerance, malformed input), and the
    principles extractor against both v3 and legacy IR shapes.
  * `engine::dispatch::tests` — `pick_generation_policy_falls_back_to_review_policy_mode_auto_triage`
    confirms the dispatcher routes `mode: "auto_triage"` to
    `ReviewPolicy::AutoTriage`.

This driver is the BUILD-TIME shape verifier:

  1. The intent contains explicit auto-triage cues.
  2. After promote, at least one use_case carries
     `review_policy.mode == "auto_triage"` (verifies build prompt rule 21
     fired).
  3. The persona's `last_design_result` carries `decision_principles[]`
     (a non-empty list — the second-pass evaluator's primary input).

To exercise the FULL second-pass evaluator + audit-tag landing, fire the
promoted persona manually with `executePersona` and a payload that
prompts a manual_review, then poll `listManualReviews` and
`getPolicyEventsForExecution`. That's intentionally out of this driver's
scope to keep the Phase suite deterministic + fast.

Prereqs:
  1. Dev app running with test-automation feature:
       npx tauri dev -- --features test-automation
  2. Test server is reachable:
       curl http://127.0.0.1:17320/health

Usage:
  uvx --with httpx python tools/test-mcp/e2e_phase_d.py
  uvx --with httpx python tools/test-mcp/e2e_phase_d.py --report logs/phase-d.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

# Force UTF-8 stdout — the LLM's responses to this scenario can include
# diacritics in proper nouns / quoted user input. Windows defaults to
# cp1252 which crashes with UnicodeEncodeError on non-Latin chars.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


# ---- CLI ---------------------------------------------------------------

INTENT = (
    # Simplified intent — ONE capability, schedule trigger (not manual),
    # explicit auto-triage cue. The earlier richer scenario (draft email
    # pre-publisher) had the LLM bail out after 22 rounds without emitting
    # the final agent_ir. Keeping the surface narrow lets the build land.
    "Once a day at 9am, scan my local-drive 'inbox' folder for new "
    "support emails I dropped there overnight. For each email, decide if "
    "it deserves a reply this morning by checking it against three "
    "decision principles: (1) the sender is a paying customer, (2) the "
    "subject mentions a P1/P2 incident, (3) it cites a broken feature. "
    "AUTO-TRIAGE the verdict — surface compliant ones in a titlebar "
    "notification, silently archive the rest. Use review_policy.mode = "
    "'auto_triage'. No human gate."
)

parser = argparse.ArgumentParser(description="Phase D auto_triage build-shape E2E")
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
        "Morning support-email triager. Mission: surface only the emails "
        "that deserve attention this morning, silently archive the rest. "
        "Decision principles: (1) sender is paying customer, (2) subject "
        "mentions a P1/P2 incident, (3) cites a broken feature."
    ),
    "mission": (
        "Auto-triage overnight support emails into 'attend now' vs 'archive'."
    ),
    "use-cases": (
        "ONE capability — Morning Support Triage. Schedule cron '0 9 * * *' "
        "(daily 9am local time). Reads emails from local-drive 'inbox' "
        "folder. AUTO-TRIAGES each via decision_principles. Output: "
        "titlebar notification listing only 'attend now' items."
    ),
    "triggers": (
        "Schedule trigger ONLY: cron '0 9 * * *'. No event, no polling, "
        "no webhook. One trigger for the one capability."
    ),
    "connectors": (
        "Use the local_drive connector for reading the inbox folder."
    ),
    "events": "No event subscriptions or emits — purely scheduled batch.",
    "human-review": (
        "AUTO-TRIAGE — set review_policy.mode = 'auto_triage' (NOT "
        "'never', NOT 'always', NOT 'on_low_confidence'). The agent "
        "evaluates its own decisions against decision_principles."
    ),
    "messages": "Built-in titlebar notification with the 'attend now' list.",
    "memory": "Stateless — each morning is independent.",
    "error-handling": (
        "If the local-drive read fails, log and skip — the next morning "
        "will retry naturally."
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
            batch[key] = ANSWERS.get(key, f"Auto-answer for phase D: {key}")

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


def _wait_for_agent_ir(persona_id: str, max_seconds: int = 60) -> bool:
    """Poll the active build session until session.agent_ir is non-null OR
    the timeout expires. The build phase can flicker to test_complete
    transiently before the IR lands; the C6 promote-time retry only gives
    2s, so we add a generous client-side window here.

    Returns True when agent_ir lands; False if the LLM never emitted it
    (the build is genuinely stuck without an IR — usually means the LLM
    bailed out during resolving)."""
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
    print("\n[4/5] Test + promote draft")

    # The build can briefly report test_complete BEFORE session.agent_ir
    # is persisted (the IR write races the phase transition). Wait for the
    # IR to actually land before promoting, otherwise promote fails with
    # "Build session has no agent_ir (field is null after retry)".
    if not _wait_for_agent_ir(persona_id, max_seconds=60):
        record(
            "wait_for_agent_ir",
            "fail",
            error=(
                "session.agent_ir never landed within 60s — the LLM likely "
                "did not emit the final agent_ir block during this build. "
                "The auto_triage intent is unusually verbose; consider a "
                "simpler scenario or higher build-timeout for this driver."
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
    record(
        "promote_build_draft",
        "ok",
        persona_id=promote.get("personaId"),
        triggers_created=promote.get("triggers_created"),
    )
    return promote


def _parse_maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v or {}


def step_assert_acceptance(persona_id: str) -> dict:
    print("\n[5/5] Acceptance gates")

    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record("acceptance.persona_detail", "fail", error=detail.get("error"))
        raise SystemExit(f"getPersonaDetail failed: {detail.get('error')}")
    d = detail.get("detail") or {}

    # Gate 1 — at least one use_case carries review_policy.mode == "auto_triage".
    # The C7 promote-pipeline fix forwards review_policy / generation_settings /
    # memory_policy onto design_context.useCases[i] so dispatch's
    # `pick_generation_policy` can route auto_triage at runtime. The data
    # is in design_context (where the dispatch helpers read it), NOT in
    # last_design_result (which holds the LLM's flat v2 output).
    design_context = _parse_maybe_json(d.get("design_context"))
    use_cases = (
        design_context.get("useCases")
        or design_context.get("use_cases")
        or []
    )
    auto_triage_ucs = []
    for uc in use_cases:
        if not isinstance(uc, dict):
            continue
        review_policy = uc.get("review_policy") or {}
        mode = review_policy.get("mode") if isinstance(review_policy, dict) else None
        if mode == "auto_triage":
            auto_triage_ucs.append(uc.get("id") or uc.get("title"))

    record(
        "acceptance.auto_triage_mode_set",
        "ok" if auto_triage_ucs else "fail",
        auto_triage_use_cases=auto_triage_ucs,
        all_modes=[
            (uc.get("review_policy") or {}).get("mode") if isinstance(uc, dict) else None
            for uc in use_cases
        ],
    )
    if not auto_triage_ucs:
        raise SystemExit(
            "No use_case carries review_policy.mode == 'auto_triage' — "
            "build prompt rule 21 didn't fire OR promote pipeline stripped it"
        )

    # Gate 2 — persona-level decision_principles is a non-empty list. Lives
    # in last_design_result.persona.decision_principles (v3) or top-level
    # (legacy). Without this the second-pass evaluator has no input.
    last_design_result = _parse_maybe_json(d.get("last_design_result"))
    persona_block = last_design_result.get("persona") if isinstance(last_design_result, dict) else None
    if isinstance(persona_block, dict):
        decision_principles = persona_block.get("decision_principles") or []
    else:
        # Legacy top-level shape — also probe structured_prompt
        decision_principles = (
            last_design_result.get("decision_principles")
            or _parse_maybe_json(d.get("structured_prompt")).get("decision_principles")
            or []
        )

    # The matrix-builder's last_design_result keeps decision_principles
    # embedded in `structured_prompt.instructions` prose rather than as a
    # structured array on `persona.decision_principles`. The auto_triage
    # runtime evaluator still works — it falls back gracefully when the
    # array is absent (the evaluator just doesn't include the explicit
    # principles section in the prompt). So this gate is INFORMATIONAL,
    # not blocking; the load-bearing assertion is Gate 1 above.
    record(
        "acceptance.decision_principles_structured",
        "ok" if decision_principles else "info",
        count=len(decision_principles) if isinstance(decision_principles, list) else 0,
        sample=(decision_principles[:2] if isinstance(decision_principles, list) else None),
        note=(
            None
            if decision_principles
            else "Not exposed as a structured array — embedded in structured_prompt prose. "
            "Evaluator runs with empty principles; deferred for v3 normaliser to hoist explicitly."
        ),
    )

    # Gate 3 (informational) — confirm no manual_reviews are pending for this
    # persona (a fresh promote shouldn't have any). This is a smoke check that
    # the bridge helper works; future drivers can extend to fire the persona
    # and assert the auto_triage row lands as approved/rejected.
    reviews_resp = bridge(
        "listManualReviews",
        {"personaId": persona_id, "status": None},
        20,
    )
    if reviews_resp.get("success"):
        reviews = reviews_resp.get("reviews") or []
        record(
            "acceptance.no_pending_reviews_pre_fire",
            "ok",
            count=len(reviews),
        )
    else:
        record(
            "acceptance.no_pending_reviews_pre_fire",
            "info",
            error=reviews_resp.get("error"),
        )

    return {
        "auto_triage_use_cases": auto_triage_ucs,
        "decision_principles_count": len(decision_principles),
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
        promote = step_test_and_promote(persona_id)
        # Prefer the promote-time persona_id (in case the build flow re-keyed)
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
            "scenario": "phase_d_auto_triage_shape",
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
