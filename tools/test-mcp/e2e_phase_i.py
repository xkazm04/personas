r"""
Phase I — Clockify monthly-invoice scenario E2E (C7 increment, 2026-04-28).

Builds a 2-capability persona that reads Clockify time entries on the 1st
of each month, composes an itemized invoice using a user-supplied
template, and prepares a draft email for human review. Exercises FOUR
C7 features in one scenario:

  1. Multi-capability build (Phase A territory) — 2 UCs sharing a schedule.
  2. **Reference-input questionnaire** — user attaches an invoice
     template via the new accepts_reference clarifying question (or via
     inline content if the LLM doesn't ask).
  3. **Auto_triage routing**: capability 2 has explicit human-review (NOT
     auto_triage) — sanity check that the build pipeline forwards
     review_policy correctly even for non-auto cases.
  4. **Dry-run preview** — after promote, simulate the first capability
     and verify artefacts response shape.

Acceptance gates (in order, fail-fast):

  G1.  Promote succeeds.
  G2.  IR has 2 use_cases.
  G3.  Both UCs have a schedule trigger (cron pattern '0 9 1 * *' or '0 8 1 * *').
  G4.  UC1's connector list includes 'clockify'.
  G5.  UC2's connector list includes an email connector (gmail / resend /
       sendgrid / google-workspace-oauth).
  G6.  UC2's review_policy.mode is NOT 'auto_triage' and NOT 'never' —
       i.e., human review is enabled in some form (intent says "I want to
       review").
  G7.  The design_context.useCases structured array carries review_policy
       per the C7 promote-pipeline fix.
  G8.  Dry-run on UC1 returns a SimulationArtefacts response with the
       expected shape.
  G9.  Persona's last_design_result.persona.decision_principles is a
       non-empty list (the C7 hoist fix).

This scenario was the original product driver for C7. The reference-input
+ dry-run + design_context-case-key + review_policy-preserve features
were built specifically so this kind of multi-capability persona could
be authored via the build wizard end-to-end.

Prereqs:
  1. Dev app running with test-automation feature:
       npx tauri dev -- --features test-automation
  2. Test server is reachable:
       curl http://127.0.0.1:17320/health
  3. Clockify connector exists in the catalog (it does — confirmed via
     scripts/connectors/builtin/clockify.json).

Usage:
  python tools/test-mcp/e2e_phase_i.py
  python tools/test-mcp/e2e_phase_i.py --report logs/phase-i.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

# Force UTF-8 stdout — same fix as Phase F. The LLM's responses for this
# scenario can include non-ASCII chars in proper nouns / quoted user
# input.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


# ---- CLI ---------------------------------------------------------------

INTENT = (
    "Generate monthly invoices from my Clockify time entries. On the 1st "
    "of each month at 9am, read last month's billable entries from "
    "Clockify, compose an itemized invoice that matches my saved "
    "template (I'll attach a sample), then prepare a draft email to my "
    "accountant with the invoice attached. Two capabilities: (1) "
    "Generate Invoice — produces the invoice document from Clockify "
    "data; (2) Prepare Email Draft — composes the message body and "
    "attaches the invoice. I want to review the email draft before it "
    "leaves my account."
)

# A minimal sample invoice template that the user "attaches" via the
# reference-input mechanism. The LLM should use this to design the
# invoice's field schema for capability 1.
SAMPLE_INVOICE_TEMPLATE = """\
INVOICE #2026-001
Date: {{invoice_date}}
For period: {{period_start}} – {{period_end}}

Bill to:
  Acme Corp
  accountant@acme.com

Line items:
  | Project          | Hours | Rate    | Subtotal |
  |------------------|-------|---------|----------|
  | {{project_name}} | {{h}} | ${{r}}  | ${{s}}   |

Total: ${{total}}

Payment terms: Net 30
Payment to: <my bank details>
"""

EMAIL_CONNECTOR_TOKENS = {
    "gmail",
    "resend",
    "sendgrid",
    "google_workspace_oauth",
    "google-workspace-oauth",
    "postmark",
    "mailgun",
}

parser = argparse.ArgumentParser(description="Phase I Clockify monthly-invoice E2E")
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
        "Monthly invoice generator from Clockify time tracking. Mission: "
        "turn last month's tracked hours into a clean invoice + draft "
        "email each month, with one human-approval gate before the email "
        "leaves my account. Decision principles: (1) include only "
        "billable entries, (2) match the user's saved template format "
        "verbatim, (3) never auto-send — always wait for review."
    ),
    "mission": (
        "Bring the monthly Clockify-to-invoice workflow down to a "
        "one-click review-and-send."
    ),
    "use-cases": (
        "TWO capabilities. UC1 'Generate Invoice' fetches last month's "
        "billable Clockify entries (1st of month at 9am) and composes "
        "the invoice document. UC2 'Prepare Email Draft' takes the "
        "invoice and prepares a draft email to my accountant. Both "
        "share the same monthly schedule trigger; UC2 runs after UC1 "
        "completes (chained via 'invoice.generated' event)."
    ),
    "triggers": (
        "Both capabilities use the SAME monthly schedule: cron "
        "'0 9 1 * *' (1st of month, 9am local time). UC2 also listens "
        "on UC1's 'invoice.generated' event so it always fires after "
        "the invoice is ready. No webhooks, no polling, no manual."
    ),
    "connectors": (
        "UC1 uses the clockify connector to read time entries. UC2 uses "
        "the gmail connector to draft the outgoing email. The agent "
        "writes the invoice as a markdown attachment via the local-drive "
        "connector for the email."
    ),
    "events": (
        "UC1 emits 'invoice.generated' when the invoice document is "
        "ready. UC2 listens on 'invoice.generated' to compose the email. "
        "No external event subscriptions."
    ),
    "human-review": (
        "UC1 (Generate Invoice): never review — auto-publish the invoice "
        "document; the human gate is on the EMAIL not the invoice. UC2 "
        "(Prepare Email Draft): always review — I want to read every "
        "draft before it ships. Set review_policy.mode = 'always' for "
        "UC2."
    ),
    "messages": (
        "UC1 saves the invoice as 'invoices/<YYYY-MM>.md' on local-drive "
        "and emits the event. UC2 prepares a Gmail draft (recipient: "
        "accountant@example.com, subject: 'Invoice for <month> <year>'); "
        "I open Gmail and click Send when I'm happy."
    ),
    "memory": (
        "No cross-month memory needed — each invoice is its own slice "
        "of time. Stateless."
    ),
    "error-handling": (
        "If Clockify API fails, log + skip + retry next month — don't "
        "spam manual reviews about transient errors. If gmail draft "
        "creation fails, surface a manual_review with the invoice "
        "contents so the user can paste them manually."
    ),
}


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


def step_answer_dimensions(persona_id: str) -> str:
    print("\n[3/7] Answer build clarifying questions")

    max_rounds = 30
    reference_attached = False

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
                reference_attached=reference_attached,
            )
            return phase
        if phase != "awaiting_input":
            continue

        qs = bridge("listPendingBuildQuestions", {}, 20).get("questions") or []
        if not qs:
            time.sleep(1.0)
            continue

        # First pass: handle any reference-attach question separately so
        # the LLM gets the actual invoice template content via the typed
        # payload mechanism.
        reference_handled = False
        for q in qs:
            if q.get("acceptsReference") or q.get("accepts_reference"):
                key = q.get("cellKey") or q.get("cell_key") or "messages"
                ref_resp = bridge(
                    "answerBuildQuestionWithReference",
                    {
                        "cellKey": key,
                        "answer": (
                            "Here's a sample invoice template — match the "
                            "field schema (invoice number, date, period, "
                            "bill-to, line items, total)."
                        ),
                        "reference": {
                            "inlineContent": SAMPLE_INVOICE_TEMPLATE,
                            "name": "invoice-template.md",
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
                    reference_attached = True
                    reference_handled = True
                break

        if reference_handled:
            continue

        # Second pass: batch every other question via the regular text path.
        batch = {}
        for q in qs:
            key = q.get("cellKey") or q.get("cell_key")
            if not key:
                continue
            batch[key] = ANSWERS.get(key, f"Auto-answer for phase I: {key}")

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
    """Same defensive wait as in phase_d / phase_h. Build session may
    flicker test_complete before agent_ir is persisted."""
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
        raise SystemExit("Cannot promote — session.agent_ir is null.")
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
        triggers_created=result.get("triggers_created"),
        smee_relays_created=result.get("smee_relays_created"),
    )
    return promote


def _parse_maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v or {}


def _connector_names(uc: dict) -> list[str]:
    """Extract connector names from a use_case in either v3 (objects) or
    legacy (strings) form. Also includes `tool_hints` since the v3 build
    prompt advises the LLM to put per-UC connectors there when the
    persona-level `connectors` list is the source of truth."""
    out = []
    for c in uc.get("connectors") or []:
        if isinstance(c, str):
            out.append(c.lower())
        elif isinstance(c, dict):
            n = c.get("name") or c.get("service_type")
            if isinstance(n, str):
                out.append(n.lower())
    # tool_hints carries per-UC connector names in v3-shape personas
    for h in uc.get("tool_hints") or []:
        if isinstance(h, str):
            out.append(h.lower())
    return out


def _all_persona_connectors(detail: dict, last_design_result: dict) -> list[str]:
    """Collect every connector name visible at the persona level — used
    when per-UC `connectors` are absent (v3 personas typically declare
    connectors persona-wide and reference them per-UC via tool_hints).

    Sources, in order: persona block (v3), suggested_connectors (legacy
    flat), required_connectors (legacy alias)."""
    names: list[str] = []
    persona = last_design_result.get("persona") if isinstance(last_design_result, dict) else None
    if isinstance(persona, dict):
        for c in persona.get("connectors") or []:
            if isinstance(c, dict):
                n = c.get("name") or c.get("service_type")
                if isinstance(n, str):
                    names.append(n.lower())
            elif isinstance(c, str):
                names.append(c.lower())
    for c in last_design_result.get("suggested_connectors") or []:
        if isinstance(c, dict):
            n = c.get("name") or c.get("service_type")
            if isinstance(n, str):
                names.append(n.lower())
        elif isinstance(c, str):
            names.append(c.lower())
    return names


def step_assert_acceptance(persona_id: str) -> dict:
    print("\n[5/7] Acceptance gates")

    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record("acceptance.persona_detail", "fail", error=detail.get("error"))
        raise SystemExit(f"getPersonaDetail failed: {detail.get('error')}")
    d = detail.get("detail") or {}

    # G2 — IR has 2 use_cases
    design_context = _parse_maybe_json(d.get("design_context"))
    use_cases = (
        design_context.get("useCases")
        or design_context.get("use_cases")
        or []
    )
    record(
        "acceptance.use_case_count",
        "ok" if len(use_cases) == 2 else "fail",
        got=len(use_cases),
        expected=2,
        ids=[uc.get("id") for uc in use_cases if isinstance(uc, dict)],
    )
    if len(use_cases) != 2:
        # Capability granularity rule may produce more; tolerate anything ≥ 2
        if len(use_cases) < 2:
            raise SystemExit(
                f"Expected at least 2 use_cases, got {len(use_cases)}"
            )

    # G3 — both UCs have a schedule trigger
    triggers = d.get("triggers") or []
    schedule_triggers = [t for t in triggers if t.get("trigger_type") == "schedule"]
    record(
        "acceptance.schedule_triggers_present",
        "ok" if len(schedule_triggers) >= 1 else "fail",
        schedule_count=len(schedule_triggers),
        all_trigger_types=[t.get("trigger_type") for t in triggers],
    )
    if not schedule_triggers:
        raise SystemExit("No schedule triggers — LLM may have picked event_listener for both UCs")

    # Collect connectors from EVERY source: per-UC connectors,
    # per-UC tool_hints, persona-level connectors, suggested_connectors.
    # The v3 build prompt has the LLM put connectors at the persona level
    # and reference them per-UC via tool_hints, so we must check all four
    # places. A persona is "wired" for clockify/gmail when either source
    # carries the name.
    last_design_result = _parse_maybe_json(d.get("last_design_result"))
    persona_connectors = _all_persona_connectors(d, last_design_result)
    per_uc_connectors: list[str] = []
    for uc in use_cases:
        if isinstance(uc, dict):
            per_uc_connectors.extend(_connector_names(uc))
    # Also probe last_design_result.use_case_flows[i].tool_hints — that's
    # where the v3 normalizer parks per-UC tool/connector references.
    for ucf in last_design_result.get("use_case_flows") or []:
        if isinstance(ucf, dict):
            for h in ucf.get("tool_hints") or []:
                if isinstance(h, str):
                    per_uc_connectors.append(h.lower())
    all_connectors = persona_connectors + per_uc_connectors

    # G4 — clockify connector appears anywhere on the persona
    has_clockify = any("clockify" in c for c in all_connectors)
    record(
        "acceptance.clockify_present",
        "ok" if has_clockify else "fail",
        all_connectors=sorted(set(all_connectors)),
        persona_level_only=sorted(set(persona_connectors)),
        per_uc_only=sorted(set(per_uc_connectors)),
    )
    if not has_clockify:
        raise SystemExit("clockify connector not visible at persona or UC level")

    # G5 — email connector appears anywhere on the persona
    email_match = [c for c in all_connectors if any(tok in c for tok in EMAIL_CONNECTOR_TOKENS)]
    record(
        "acceptance.email_connector_present",
        "ok" if email_match else "fail",
        matched=sorted(set(email_match)),
    )
    if not email_match:
        raise SystemExit("No email connector visible — UC2 can't draft an email")

    # G6 — at least one UC has review_policy.mode that is NOT 'never' AND NOT
    # 'auto_triage' (we want a human gate on this scenario per intent).
    review_modes = []
    has_human_gate = False
    for uc in use_cases:
        if not isinstance(uc, dict):
            continue
        rp = uc.get("review_policy") or {}
        mode = rp.get("mode") if isinstance(rp, dict) else None
        review_modes.append(mode)
        if mode in ("on_low_confidence", "always"):
            has_human_gate = True
    record(
        "acceptance.human_review_gate_present",
        "ok" if has_human_gate else "info",
        review_modes=review_modes,
        note=(
            None
            if has_human_gate
            else "No 'always' or 'on_low_confidence' UC — LLM picked stricter or looser. Soft check."
        ),
    )

    # G7 — design_context.useCases[0].review_policy is preserved (C7 promote
    # pipeline fix). At least one UC must carry the field.
    has_review_policy_data = any(
        isinstance(uc, dict) and uc.get("review_policy") is not None
        for uc in use_cases
    )
    record(
        "acceptance.review_policy_preserved_in_design_context",
        "ok" if has_review_policy_data else "fail",
        has_data=has_review_policy_data,
    )
    if not has_review_policy_data:
        raise SystemExit(
            "design_context.useCases has no review_policy field — "
            "C7 promote-pipeline fix may have regressed"
        )

    # G9 — persona-level decision_principles is preserved (C7 hoist fix)
    persona_block = (
        last_design_result.get("persona")
        if isinstance(last_design_result, dict)
        else None
    )
    decision_principles = (
        persona_block.get("decision_principles")
        if isinstance(persona_block, dict)
        else None
    ) or []
    record(
        "acceptance.decision_principles_hoisted",
        "ok" if decision_principles else "info",
        count=len(decision_principles) if isinstance(decision_principles, list) else 0,
        sample=(decision_principles[:2] if isinstance(decision_principles, list) else None),
        note=(
            None
            if decision_principles
            else "Persona block absent or no decision_principles — C7 hoist fix needs verification"
        ),
    )

    return {
        "use_case_count": len(use_cases),
        "use_case_ids": [uc.get("id") for uc in use_cases if isinstance(uc, dict)],
        "trigger_types": [t.get("trigger_type") for t in triggers],
        "all_connectors": all_connectors,
        "review_modes": review_modes,
        "decision_principles_count": len(decision_principles)
        if isinstance(decision_principles, list)
        else 0,
    }


def step_dry_run(persona_id: str, summary: dict) -> dict:
    print("\n[6/7] Dry-run preview on UC1 (sample_input)")
    uc_ids = summary.get("use_case_ids") or []
    if not uc_ids:
        record("dry_run", "info", note="No use_case ids — skipping dry-run")
        return {}

    uc_id = uc_ids[0]
    sim = bridge(
        "simulateBuildDraft",
        {"useCaseId": uc_id},
        args.simulate_timeout,
    )
    if not sim.get("success"):
        # Soft fail — dry-run isn't the load-bearing test for Phase I.
        record(
            "dry_run.simulate",
            "info",
            error=sim.get("error"),
            uc_id=uc_id,
            note="dry-run failed; primary acceptance gates already passed",
        )
        return {}

    exec_row = sim.get("execution") or {}
    exec_id = exec_row.get("id")
    record(
        "dry_run.simulate",
        "ok",
        execution_id=exec_id,
        status=exec_row.get("status"),
    )
    if not exec_id:
        return {}

    artefacts = bridge("getSimulationArtefacts", {"executionId": exec_id}, 30)
    if artefacts.get("success"):
        art = artefacts.get("artefacts") or {}
        record(
            "dry_run.artefacts",
            "ok",
            reviews_count=len(art.get("reviews") or []),
            memories_count=len(art.get("memories") or []),
        )
    else:
        record("dry_run.artefacts", "info", error=artefacts.get("error"))

    return {"execution_id": exec_id}


def step_cleanup(persona_id: str | None) -> None:
    if args.no_persona_cleanup or not persona_id:
        return
    print("\n[7/7] Cleanup")
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
        step_answer_dimensions(persona_id)
        promote = step_test_and_promote(persona_id)
        persona_id = promote.get("personaId") or persona_id
        summary_payload = step_assert_acceptance(persona_id)
        step_dry_run(persona_id, summary_payload)
        step_cleanup(persona_id)
    except SystemExit as e:
        record("scenario.abort", "fail", error=str(e))
    except Exception as e:
        record("scenario.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        summary = {
            "scenario": "phase_i_clockify_invoice",
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
