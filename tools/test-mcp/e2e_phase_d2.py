r"""
Phase D2 — auto_triage RUNTIME E2E (C8 increment, 2026-04-28).

Phase D verifies the BUILD shape only — that an `auto_triage` intent
makes it through the build pipeline with `review_policy.mode =
"auto_triage"` landing on `design_context.useCases[]`. Phase D2 closes
the loop by exercising the RUNTIME side: when a `manual_review` is
dispatched against an auto_triage capability, the spawned evaluator
runs the Claude CLI, parses a verdict, transitions the row to
`Approved` / `Rejected`, and audits via `policy_events`.

The remaining nondeterminism in the original end-to-end path was
"whether the LLM emits a `request_review` action at runtime". This
driver removes that with the C8 `synthesize_manual_review` test bridge
(see `commands::testing::synthesize_review`) — it builds a minimal
auto_triage persona, promotes it, then synthesizes a manual_review row
+ spawns the evaluator in one bridge call. The driver then polls the
review row until status leaves `Pending`, and asserts a matching
`policy_events` row landed with the right audit tag.

Acceptance gates (after promote + synthesize):
  1. The persona's design_context has at least one UC with
     `review_policy.mode == "auto_triage"`.
  2. Within `RUNTIME_TIMEOUT_S` seconds, the synthesized
     `manual_review` row's status leaves `Pending` and lands on one of
     `Approved` / `Rejected` / `Resolved` (the last is the fallback
     path — also a green outcome from the evaluator's perspective:
     it ran, recorded the audit tag, and unstuck the row).
  3. A `policy_events` row exists for the synthetic execution with
     a kind in `{review.auto_triage.approved, .rejected, .fallback}`.

The evaluator calls Claude CLI as a subprocess, which on Windows takes
~10–30 seconds typically. RUNTIME_TIMEOUT_S allows up to 120s before
giving up.

Prereqs:
  1. Dev app running with test-automation feature:
       npx tauri dev -- --features test-automation
  2. Test server is reachable:
       curl http://127.0.0.1:17320/health
  3. `claude` CLI is on PATH (the evaluator's subprocess driver).

Usage:
  uvx --with httpx python tools/test-mcp/e2e_phase_d2.py
  uvx --with httpx python tools/test-mcp/e2e_phase_d2.py --report logs/phase-d2.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx


try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


# ---- CLI ---------------------------------------------------------------

# Lifted from Phase D — proven to land `mode: "auto_triage"` on the
# design_context's useCases[]. Keeping the surface narrow lets the build
# land reliably; the evaluator's behaviour is what we're verifying here,
# not the build pipeline.
INTENT = (
    "Once a day at 9am, scan my local-drive 'inbox' folder for new "
    "support emails I dropped there overnight. For each email, decide if "
    "it deserves a reply this morning by checking it against three "
    "decision principles: (1) the sender is a paying customer, (2) the "
    "subject mentions a P1/P2 incident, (3) it cites a broken feature. "
    "AUTO-TRIAGE the verdict — surface compliant ones in a titlebar "
    "notification, silently archive the rest. Use review_policy.mode = "
    "'auto_triage'. No human gate."
)

RUNTIME_TIMEOUT_S = 120

parser = argparse.ArgumentParser(description="Phase D2 auto_triage runtime E2E")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument("--build-timeout", type=int, default=240)
parser.add_argument(
    "--runtime-timeout", type=int, default=RUNTIME_TIMEOUT_S,
    help="Seconds to wait for the auto_triage evaluator to finalise the review.",
)
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
        "local-drive (read 'inbox' folder) + titlebar (output). Nothing else."
    ),
    "events": (
        "No internal events emitted, no events subscribed."
    ),
    "human-review": (
        "review_policy.mode = 'auto_triage'. The agent emits a manual_review "
        "for each candidate; the second-pass LLM evaluator decides "
        "approve/reject against the decision_principles. NO human in the loop."
    ),
    "messages": (
        "Single titlebar notification per morning batch listing the "
        "auto-triaged 'attend now' items."
    ),
    "memory": (
        "Stateless — each morning is independent. No memory writes."
    ),
    "error-handling": (
        "If the local-drive read fails, log and skip — the next morning "
        "will retry naturally."
    ),
}


# ---- Helpers -----------------------------------------------------------


def _parse_maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v or {}


def _find_auto_triage_uc(use_cases: list) -> dict | None:
    """Return the first UC whose review_policy.mode == 'auto_triage'."""
    for uc in use_cases:
        if not isinstance(uc, dict):
            continue
        rp = uc.get("review_policy") or {}
        if isinstance(rp, dict) and rp.get("mode") == "auto_triage":
            return uc
    return None


# ---- Steps -------------------------------------------------------------


def step_preflight() -> None:
    print("\n[1/7] Preflight")
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
    print("\n[2/7] Start build")
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
    print("\n[3/7] Answer build clarifying questions")

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
            batch[key] = ANSWERS.get(key, f"Auto-answer for phase D2: {key}")

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
    print("\n[4/7] Test + promote draft")

    if not _wait_for_agent_ir(persona_id, max_seconds=60):
        record(
            "wait_for_agent_ir",
            "fail",
            error="session.agent_ir never landed within 60s",
        )
        raise SystemExit("Cannot promote — session.agent_ir is null")
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
        triggers_created=(promote.get("result") or {}).get("triggers_created"),
    )
    return promote


def step_synthesize_review(persona_id: str) -> dict:
    """Pull the auto_triage UC id off design_context, then call the C8
    `synthesize_manual_review` bridge command. Returns
    {review_id, execution_id, use_case_id}."""
    print("\n[5/7] Synthesize manual_review + spawn evaluator")

    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record("synthesize.persona_detail", "fail", error=detail.get("error"))
        raise SystemExit(f"getPersonaDetail failed: {detail.get('error')}")
    d = detail.get("detail") or {}
    design_context = _parse_maybe_json(d.get("design_context"))
    use_cases = (
        design_context.get("useCases")
        or design_context.get("use_cases")
        or []
    )

    auto_triage_uc = _find_auto_triage_uc(use_cases)
    record(
        "synthesize.auto_triage_uc_found",
        "ok" if auto_triage_uc else "fail",
        use_case_id=auto_triage_uc.get("id") if auto_triage_uc else None,
        title=auto_triage_uc.get("title") if auto_triage_uc else None,
        all_modes=[
            (uc.get("review_policy") or {}).get("mode") if isinstance(uc, dict) else None
            for uc in use_cases
        ],
    )
    if not auto_triage_uc:
        raise SystemExit(
            "No auto_triage UC on the promoted persona — Phase D's build "
            "shape didn't land. Re-run Phase D first to verify, or simplify "
            "this driver's INTENT."
        )

    use_case_id = auto_triage_uc.get("id")

    # Payload designed to match the build's decision_principles in INTENT —
    # paying customer + P1 incident + cites broken feature → expected
    # `approve`. (Either verdict is a green outcome from this driver's
    # perspective; the load-bearing assertion is "status leaves Pending and
    # a policy_events row lands".)
    review = bridge(
        "synthesizeManualReview",
        {
            "personaId": persona_id,
            "useCaseId": use_case_id,
            "title": "P1 incident — vault sync stuck for paying customer",
            "description": (
                "Sender is acme-corp@example.com (Enterprise tier, paying "
                "customer). Subject: 'P1: vault sync hangs after restart'. "
                "Body cites that the vault credential refresh feature is "
                "broken — every save spins forever. Three of three "
                "decision_principles match. Recommend surface in titlebar."
            ),
            "severity": "high",
            "contextData": json.dumps({
                "sender_tier": "Enterprise",
                "subject": "P1: vault sync hangs after restart",
                "principles_matched": ["paying_customer", "p1_p2_incident", "broken_feature"],
            }),
            "suggestedActions": [
                "Surface in titlebar notification",
                "Mark as 'attend now'",
            ],
        },
        30,
    )
    if not review.get("success"):
        record("synthesize.bridge_call", "fail", error=review.get("error"))
        raise SystemExit(f"synthesizeManualReview failed: {review.get('error')}")
    record(
        "synthesize.bridge_call",
        "ok",
        review_id=review.get("reviewId"),
        execution_id=review.get("executionId"),
    )
    return {
        "review_id": review.get("reviewId"),
        "execution_id": review.get("executionId"),
        "use_case_id": use_case_id,
    }


def step_wait_for_verdict(persona_id: str, review_id: str) -> dict:
    """Poll listManualReviews until the synthesized review row's status
    leaves Pending. Returns the final review row."""
    print("\n[6/7] Poll review row until evaluator finalises it")
    deadline = time.time() + args.runtime_timeout
    last_status = None
    poll_count = 0
    while time.time() < deadline:
        poll_count += 1
        resp = bridge(
            "listManualReviews",
            {"personaId": persona_id, "status": None},
            20,
        )
        if not resp.get("success"):
            record("wait_verdict.list_failed", "info", error=resp.get("error"))
            time.sleep(2.0)
            continue
        reviews = resp.get("reviews") or []
        target = next((r for r in reviews if r.get("id") == review_id), None)
        if target is None:
            record(
                "wait_verdict.row_missing",
                "info",
                poll=poll_count,
                expected=review_id,
                seen=[r.get("id") for r in reviews][:5],
            )
            time.sleep(2.0)
            continue
        status = target.get("status")
        if status != last_status:
            record(
                "wait_verdict.status_change",
                "info",
                poll=poll_count,
                status=status,
                reviewer_notes_preview=(target.get("reviewerNotes") or target.get("reviewer_notes") or "")[:120],
            )
            last_status = status
        # PersonaManualReview.status is the typed enum; the C7 evaluator
        # transitions it to Approved / Rejected / Resolved. Both upper-
        # and lower-case are tolerated since the serde representation
        # has flipped historically.
        if status and status.lower() in ("approved", "rejected", "resolved"):
            record(
                "wait_verdict.final",
                "ok",
                final_status=status,
                polls=poll_count,
                duration_s=round(time.time() - (deadline - args.runtime_timeout), 2),
            )
            return target
        time.sleep(2.0)

    record(
        "wait_verdict.timeout",
        "fail",
        last_status=last_status,
        timeout_s=args.runtime_timeout,
    )
    raise SystemExit(
        f"Review {review_id} stayed in '{last_status}' for {args.runtime_timeout}s — "
        "evaluator never finalised it. Check that `claude` CLI is on PATH and the "
        "tauri-dev process can spawn subprocesses (Windows AV / EDR can block this)."
    )


def step_assert_audit_tag(execution_id: str, final_review_status: str) -> dict:
    """Pull policy_events for the synthetic execution and confirm one of
    the auto_triage audit kinds landed."""
    print("\n[7/7] Assert policy_events audit tag")

    # The evaluator records the policy_event AFTER updating the review
    # status. Allow up to 10s of post-verdict drift in case the SQL
    # writes interleave non-deterministically.
    deadline = time.time() + 10.0
    expected_kinds = {
        "review.auto_triage.approved",
        "review.auto_triage.rejected",
        "review.auto_triage.fallback",
    }
    last_seen_kinds: list[str] = []
    while time.time() < deadline:
        resp = bridge(
            "getPolicyEventsForExecution",
            {"executionId": execution_id},
            20,
        )
        if resp.get("success"):
            events = resp.get("events") or []
            kinds = [e.get("policy_kind") or e.get("policyKind") for e in events]
            last_seen_kinds = kinds
            match = next((k for k in kinds if k in expected_kinds), None)
            if match:
                record(
                    "audit.policy_event_present",
                    "ok",
                    policy_kind=match,
                    final_review_status=final_review_status,
                    all_kinds=kinds,
                )
                return {
                    "policy_kind": match,
                    "all_kinds": kinds,
                    "events_count": len(events),
                }
        time.sleep(1.0)

    record(
        "audit.policy_event_present",
        "fail",
        expected_any_of=sorted(expected_kinds),
        seen=last_seen_kinds,
        final_review_status=final_review_status,
    )
    raise SystemExit(
        f"No auto_triage policy_event for execution {execution_id} after 10s — "
        f"saw kinds {last_seen_kinds}. The evaluator transitioned the review "
        "but skipped the audit insert (or the bridge read filtered it out)."
    )


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
    summary_payload: dict = {}
    try:
        step_preflight()
        build = step_start_build()
        persona_id = build.get("personaId")
        step_answer_dimensions()
        promote = step_test_and_promote(persona_id)
        persona_id = promote.get("personaId") or persona_id

        synth = step_synthesize_review(persona_id)
        summary_payload.update(synth)

        final_review = step_wait_for_verdict(persona_id, synth["review_id"])
        summary_payload["final_review_status"] = final_review.get("status")

        audit = step_assert_audit_tag(
            synth["execution_id"], final_review.get("status") or "unknown"
        )
        summary_payload["policy_kind"] = audit["policy_kind"]
        summary_payload["all_audit_kinds"] = audit["all_kinds"]

        step_cleanup(persona_id)
    except SystemExit as e:
        record("scenario.abort", "fail", error=str(e))
    except Exception as e:
        record("scenario.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        summary = {
            "scenario": "phase_d2_auto_triage_runtime",
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
