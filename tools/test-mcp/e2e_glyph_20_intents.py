r"""
E2E Glyph From-Scratch sweep — 20 intents mirroring the template-adoption set.

Drives the Glyph composer with 20 different free-form intents (one per
target template family) and verifies each persona reaches `promoted`
phase. Personas are kept (no cleanup) so the user can inspect them in
the Personas page afterwards.

Difference vs `e2e_build_from_scratch.py`:
  * That harness hardcodes ONE scenario (translate-drive) with scenario-
    specific answer recipes. This harness iterates 20 intents and uses
    intent-aware generic answer recipes that work for any persona shape.
  * Skips the drive-write phase (only the translate-drive intent emits
    drive.document.added). Stops at promotion + first execution.

Prerequisites:
  npx tauri dev --features test-automation
  curl http://127.0.0.1:17320/health  # status: ok

Usage:
  uvx --with httpx python tools/test-mcp/e2e_glyph_20_intents.py
  uvx --with httpx python tools/test-mcp/e2e_glyph_20_intents.py --start 1 --end 5
  uvx --with httpx python tools/test-mcp/e2e_glyph_20_intents.py --intent-id db-summary
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx


# 20 intent prompts mirroring the template-adoption sweep. Each entry
# carries the target template family (informational), a free-form intent
# the LLM digests, and the connectors the user expects the persona to
# end up using. Tier matches the doc's classification so CI can scope.
SCENARIOS = [
    # Tier 0 — local-only
    {"id": "db-perf-monitor", "tier": 0, "intent": "Continuously monitor my local SQLite database performance — build statistical baselines for query latency and throughput per hour, alert me via the built-in messaging inbox when current metrics deviate more than 2 sigma from baseline, and remember false-positive patterns so I get fewer alerts over time."},
    # Tier 1 — DB + Messaging only
    {"id": "budget-monitor", "tier": 1, "intent": "Watch my budget spending in the local database. Every Monday at 9 AM, summarize last week's spending by category, flag any category that exceeded its budget, and send me a digest in the built-in messaging inbox."},
    {"id": "incident-logger", "tier": 1, "intent": "When an incident is reported (via a message or new row in the local incidents table), classify severity, log it to the local DB with timestamp + owner, and notify me via the built-in messaging inbox."},
    {"id": "content-perf-reporter", "tier": 1, "intent": "Every Friday at 5 PM, pull my content performance metrics from the local DB, summarize what worked vs. what didn't, and post the report to the built-in messaging inbox."},
    {"id": "research-paper-indexer", "tier": 1, "intent": "When I drop a research PDF into my local drive, extract its title, authors, abstract, and key claims, then store an indexed summary in the local DB so I can search it later."},
    # Tier 2 — Notion
    {"id": "daily-standup", "tier": 2, "intent": "Every weekday morning at 8 AM, compile a daily standup digest from my Notion 'Tasks' database — what's in-progress, what's blocked, what's due today — and post it to my Notion 'Standups' page."},
    {"id": "research-curator", "tier": 2, "intent": "Watch my Notion 'Research' database. When a new entry is added, extract key concepts, link it to related entries by tag overlap, and update a curated Notion 'Knowledge Map' page weekly."},
    {"id": "tech-decision-tracker", "tier": 2, "intent": "When I add a new technical decision (ADR) to my Notion 'Decisions' database, summarize the context + decision + consequences, link it to related decisions, and notify me in the built-in messaging inbox if it conflicts with an earlier decision."},
    {"id": "kb-health-auditor", "tier": 2, "intent": "Once a week, audit my Notion knowledge base for stale pages (no edits in 90 days), missing links, and broken references. Post the audit report to a designated Notion 'KB Health' page."},
    # Tier 3 — Gmail
    {"id": "email-morning-digest", "tier": 3, "intent": "Every weekday at 7:30 AM, scan my Gmail inbox from the last 24 hours, group emails into Urgent / Action Required / Read Later / Newsletters, and send me a digest in the built-in messaging inbox."},
    {"id": "email-support-assistant", "tier": 3, "intent": "When a new email arrives in my Gmail support@ inbox, classify it (bug report / question / feature request / spam), draft a reply using past resolutions stored in memory, and ask me to approve before sending."},
    {"id": "email-followup-tracker", "tier": 3, "intent": "Watch my sent Gmail messages. If a recipient hasn't replied within 3 business days to an email I marked as needing-a-reply, remind me via the built-in messaging inbox."},
    {"id": "email-lead-extractor", "tier": 3, "intent": "When a new Gmail message arrives that mentions sales-qualified keywords (pricing, demo, quote), extract the lead's name, company, email, and what they asked for, then notify me in the built-in messaging inbox."},
    {"id": "email-task-extractor", "tier": 3, "intent": "When I receive a Gmail message with an action item directed at me, extract the task description, due date if any, and the sender, then create a row in my local 'Tasks' DB and notify me."},
    {"id": "survey-insights", "tier": 3, "intent": "When I receive a Gmail message containing survey responses, parse the structured fields, aggregate sentiment + key themes against the running total in the local DB, and report weekly trends to the built-in messaging inbox."},
    {"id": "expense-receipt", "tier": 3, "intent": "When a Gmail message arrives with a receipt PDF attached, OCR the receipt, extract merchant + date + amount + category, store it in the local 'Expenses' DB, and notify me weekly with a summary."},
    {"id": "invoice-tracker", "tier": 3, "intent": "When I send an invoice via Gmail, log it to the local 'Invoices' DB with due date + amount + recipient. Every Monday, flag overdue invoices in the built-in messaging inbox."},
    # Tier 4 — multi-connector
    {"id": "idea-harvester", "tier": 4, "intent": "When I capture an idea (Gmail to myself, or a row in my local 'Ideas' DB), enrich it with related context (recent emails, recent Notion entries), classify by domain, and store the enriched idea in my Notion 'Ideas Vault' page."},
    {"id": "newsletter-curator", "tier": 4, "intent": "Every Sunday afternoon, scan Gmail newsletters from the past week, extract the 5-7 most interesting items by topic relevance, summarize them, and post a curated digest to my Notion 'Newsletter Digest' page."},
    {"id": "onboarding-tracker", "tier": 4, "intent": "When a new hire is added to my Notion 'People' database, send them a welcome Gmail with first-week tasks, log the welcome in the local DB, and remind me weekly until all their first-month milestones are checked off."},
]


# ── Bridge helpers (lifted from e2e_build_from_scratch.py) ───────────────────


def make_client(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=240)


def bridge(client: httpx.Client, method: str, params: dict | None = None, timeout_secs: int = 180) -> dict:
    """Dispatch to any bridge method via the generic /bridge-exec route."""
    raw = client.post(
        "/bridge-exec",
        json={"method": method, "params": params or {}, "timeout_secs": timeout_secs},
        timeout=timeout_secs + 20,
    )
    try:
        return json.loads(raw.text)
    except json.JSONDecodeError:
        return {"_raw": raw.text, "_status": raw.status_code}


def get(client: httpx.Client, path: str) -> dict:
    return json.loads(client.get(path).text)


# ── Answer recipes — intent-aware, generic, work for any persona shape ──


def make_answer_recipes(intent: str) -> dict[str, str]:
    """Build a cellKey → answer mapping that's specific enough for the LLM
    to produce sensible cells, but generic enough to work across all 20
    scenarios. Each answer echoes the user's intent so the LLM keeps the
    scenario context in mind even on later cells.
    """
    return {
        # behavior_core / mission — restate intent + autonomy expectations
        "behavior_core": (
            f"Goal: {intent} Run autonomously without confirmation for routine "
            f"steps. Confirm only when a high-impact action would change external "
            f"state in a way the user might want to vet first."
        ),
        "mission": (
            f"Mission: {intent} Operate as a one-shot per trigger; emit a "
            f"clear summary message after each run; remember reusable patterns "
            f"for next time."
        ),
        # Triggers — let the LLM derive from intent. Reinforce that the
        # connectors and schedules mentioned in the intent should be honored.
        "triggers": (
            "Use the trigger shape the intent implies: "
            "(a) if the intent says 'every X', use a SCHEDULE trigger with that cadence; "
            "(b) if the intent says 'when X happens', use an EVENT trigger that subscribes "
            "to the matching event_type (drive.document.added, gmail.message.received, "
            "notion.page.added, db.row.added, etc.); "
            "(c) if the intent is reactive but unscheduled, use a MANUAL trigger "
            "the user can invoke from the dashboard."
        ),
        # Connectors — let the LLM derive from intent
        "connectors": (
            "Bind exactly the connectors the intent names. If it mentions Gmail, use Gmail. "
            "If it mentions Notion, use Notion. If it mentions 'local DB' or 'local database', "
            "use personas_database. If it mentions 'messaging inbox' or 'built-in messaging', "
            "use personas_messages. If it mentions 'local drive', use local_drive. Do not add "
            "unrelated connectors."
        ),
        # Events
        "events": (
            "Subscribe to the event types the intent implies (e.g. gmail.message.received "
            "if the intent watches incoming mail, db.row.added if it watches a local DB table, "
            "notion.page.added if it watches a Notion database). Emit a "
            "{persona}.cycle.completed event after each successful run so downstream personas "
            "can chain off it."
        ),
        # Human-review — default off unless intent says otherwise
        "human-review": (
            "Default: NO manual review for routine runs. The intent will say if approval is "
            "needed (e.g. 'draft a reply and ask me to approve before sending' → require "
            "manual_review before the send step). Otherwise auto-deliver."
        ),
        # Destination / messages
        "messages": (
            "Send a structured summary message to the built-in messaging inbox after every "
            "successful run. Include: what was processed, the headline result, any anomalies, "
            "and a one-line 'next time I would' note."
        ),
        # Memory
        "memory": (
            "Remember stable patterns: known senders, known categories, known false-positive "
            "shapes, the user's preferences and feedback. Update memory after each run. "
            "Do NOT remember PII or sensitive credential material."
        ),
        # Error-handling
        "error-handling": (
            "If a connector call fails, log the error, send a brief failure message to the "
            "built-in messaging inbox naming the failed connector, and exit cleanly. Do not "
            "retry more than twice with exponential backoff."
        ),
        # Use cases summary
        "use-cases": (
            f"Single capability that fulfils: {intent} Input: the trigger payload (event "
            f"body / schedule fire). Output: a structured message + any side-effects the "
            f"intent describes (DB row, Notion page, Gmail draft, etc.)."
        ),
    }


# ── Per-scenario driver ──────────────────────────────────────────────────────


def run_scenario(
    client: httpx.Client,
    scenario: dict,
    build_timeout: int = 240,
    exec_timeout: int = 300,
    log: list | None = None,
) -> dict:
    """Drive one Glyph from-scratch scenario through promotion + first
    execution. Returns a result row for the aggregate report."""
    log = log if log is not None else []
    result = {
        "scenario_id": scenario["id"],
        "tier": scenario["tier"],
        "intent": scenario["intent"],
        "started_at": datetime.now(timezone.utc).isoformat(),
        "persona_id": None,
        "phase_reached": None,
        "exec_status": None,
        "error": None,
    }

    def emit(step: str, outcome: str, **kw):
        entry = {"ts": datetime.now(timezone.utc).isoformat(), "scenario": scenario["id"], "step": step, "outcome": outcome, **kw}
        log.append(entry)
        marker = "OK" if outcome == "ok" else ("..." if outcome == "info" else "XX")
        sys.stdout.write(f"  [{marker}] {scenario['id']}: {step}")
        brief = {k: v for k, v in kw.items() if not isinstance(v, (dict, list))}
        if brief:
            sys.stdout.write(f"  {brief}")
        sys.stdout.write("\n")
        sys.stdout.flush()

    try:
        # G1+G2+G3 — start the build via composer
        start = bridge(
            client,
            "startBuildFromIntent",
            {"intent": scenario["intent"], "timeoutMs": 30_000},
            40,
        )
        if not start.get("success"):
            emit("start_build", "fail", error=start.get("error"))
            result["error"] = start.get("error")
            return result
        emit("start_build", "ok", session_id=start.get("sessionId"), persona_id=start.get("personaId"))
        result["persona_id"] = start.get("personaId")

        # G4 — answer clarifying questions
        recipes = make_answer_recipes(scenario["intent"])
        max_rounds = 30
        final_phase = None
        for round_ix in range(max_rounds):
            phase_r = bridge(
                client,
                "waitForBuildPhase",
                {"phases": ["awaiting_input", "draft_ready", "test_complete", "promoted", "failed"], "timeoutMs": build_timeout * 1000},
                build_timeout + 10,
            )
            phase = phase_r.get("phase")
            if phase == "failed":
                emit("wait_phase", "fail", phase=phase, error=phase_r.get("error"))
                result["error"] = f"build failed: {phase_r.get('error')}"
                result["phase_reached"] = phase
                return result
            if phase in ("draft_ready", "test_complete", "promoted"):
                final_phase = phase
                emit("wait_phase", "ok", phase=phase, rounds=round_ix)
                break
            if phase != "awaiting_input":
                continue

            qs = bridge(client, "listPendingBuildQuestions", {}, 20).get("questions") or []
            if not qs:
                time.sleep(1.0)
                continue

            batch = {}
            for q in qs:
                key = q.get("cellKey") or q.get("cell_key")
                if not key:
                    continue
                batch[key] = recipes.get(
                    key,
                    f"Auto-scenario answer: {scenario['intent']} Run autonomously; "
                    f"send a summary message after each cycle.",
                )

            if not batch:
                time.sleep(1.0)
                continue

            submit = bridge(client, "answerPendingBuildQuestions", {"answers": batch}, 60)
            if not submit.get("success"):
                emit("answer", "fail", error=submit.get("error"))
                result["error"] = submit.get("error")
                return result
            emit("answer", "ok", round=round_ix, answered=len(batch))

        if not final_phase:
            emit("wait_phase", "fail", error=f"exceeded {max_rounds} answer rounds")
            result["error"] = f"exceeded {max_rounds} answer rounds"
            return result

        result["phase_reached"] = final_phase

        # Test + promote
        # If wait_phase landed at draft_ready, kick triggerBuildTest and wait
        # for test_complete (or promoted/failed) before calling promote — the
        # build-session FSM rejects promote with "Invalid phase transition:
        # testing -> promoted" otherwise.
        if final_phase == "draft_ready":
            test = bridge(client, "triggerBuildTest", {}, 60)
            emit("test_draft", "ok" if test.get("success") else "info", error=test.get("error"))
            test_wait = bridge(
                client,
                "waitForBuildPhase",
                {"phases": ["test_complete", "promoted", "failed"], "timeoutMs": 240_000},
                250,
            )
            if test_wait.get("phase") == "failed":
                emit("test_wait", "fail", error=test_wait.get("error"))
                result["error"] = f"test failed: {test_wait.get('error')}"
                return result
            emit("test_wait", "ok", phase=test_wait.get("phase"))
        else:
            emit("test_draft", "info", note=f"phase already {final_phase}; skipping triggerBuildTest")

        promote = bridge(client, "promoteBuildDraft", {}, 60)
        if not promote.get("success"):
            emit("promote", "fail", error=promote.get("error"))
            result["error"] = f"promote failed: {promote.get('error')}"
            return result
        emit("promote", "ok", persona_id=promote.get("personaId"))
        persona_id = promote.get("personaId") or result["persona_id"]
        result["persona_id"] = persona_id
        result["phase_reached"] = "promoted"

        # Execute via test-automation HTTP route
        exe = client.post("/execute-persona", json={"name_or_id": persona_id}, timeout=30)
        try:
            exe_body = json.loads(exe.text)
        except Exception:
            exe_body = {"raw": exe.text}
        emit("execute_start", "ok" if exe_body.get("success") else "fail", **{k: v for k, v in exe_body.items() if k != "success"})
        if not exe_body.get("success"):
            result["error"] = f"execute_start failed: {exe_body.get('error')}"
            return result

        # Poll DB for completion
        db_path = Path.home() / "AppData" / "Roaming" / "com.personas.desktop" / "personas.db"
        deadline = time.time() + exec_timeout
        last_status = "queued"
        while time.time() < deadline:
            time.sleep(5)
            try:
                conn = sqlite3.connect(str(db_path))
                row = conn.execute(
                    "SELECT status, cost_usd, duration_ms FROM persona_executions "
                    "WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
                    (persona_id,),
                ).fetchone()
                conn.close()
            except Exception as e:
                emit("poll_exec", "info", error=str(e))
                continue
            if not row:
                continue
            last_status = row[0]
            if last_status == "completed":
                emit("execute_complete", "ok", cost_usd=row[1], duration_ms=row[2])
                result["exec_status"] = "completed"
                result["exec_cost_usd"] = row[1]
                result["exec_duration_ms"] = row[2]
                return result
            if last_status == "failed":
                emit("execute_complete", "fail", status=last_status)
                result["exec_status"] = "failed"
                return result

        emit("execute_complete", "fail", error=f"timeout last_status={last_status}")
        result["exec_status"] = last_status
        result["error"] = f"execution timeout last_status={last_status}"
        return result

    except Exception as e:
        emit("scenario.crash", "fail", error=repr(e))
        result["error"] = repr(e)
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=17320)
    parser.add_argument("--start", type=int, default=1, help="1-indexed start scenario (inclusive)")
    parser.add_argument("--end", type=int, default=20, help="1-indexed end scenario (inclusive)")
    parser.add_argument("--intent-id", type=str, default=None, help="Run one scenario by id")
    parser.add_argument("--build-timeout", type=int, default=240)
    parser.add_argument("--exec-timeout", type=int, default=600)
    parser.add_argument("--report", type=str, default=None)
    args = parser.parse_args()

    base = f"http://127.0.0.1:{args.port}"
    client = make_client(base)
    health = get(client, "/health")
    if health.get("status") != "ok":
        sys.exit(f"server not healthy: {health}")
    print(f"Server: {health}")

    if args.intent_id:
        scenarios = [s for s in SCENARIOS if s["id"] == args.intent_id]
        if not scenarios:
            sys.exit(f"unknown intent-id: {args.intent_id}")
    else:
        scenarios = SCENARIOS[args.start - 1 : args.end]

    print(f"\nRunning {len(scenarios)} Glyph scenarios (sequential)\n")
    started = datetime.now(timezone.utc)
    results = []
    log: list[dict] = []
    for i, s in enumerate(scenarios, 1):
        print(f"\n{'=' * 60}")
        print(f"  [{i}/{len(scenarios)}] {s['id']} (tier {s['tier']})")
        print(f"  intent: {s['intent'][:120]}...")
        print(f"{'=' * 60}")
        r = run_scenario(client, s, args.build_timeout, args.exec_timeout, log)
        results.append(r)

    finished = datetime.now(timezone.utc)
    promoted = sum(1 for r in results if r["phase_reached"] == "promoted")
    executed = sum(1 for r in results if r["exec_status"] == "completed")

    summary = {
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "duration_s": (finished - started).total_seconds(),
        "scenarios_run": len(results),
        "promoted": promoted,
        "executed_completed": executed,
        "results": results,
        "log": log,
    }
    print(f"\n{'=' * 60}")
    print(f"  GLYPH SWEEP RESULTS")
    print(f"  Promoted: {promoted}/{len(results)}")
    print(f"  Executed: {executed}/{len(results)}")
    print(f"  Duration: {finished - started}")
    print(f"{'=' * 60}")
    for r in results:
        ok = r["exec_status"] == "completed"
        phase = r["phase_reached"] or "(none)"
        status = r["exec_status"] or "(none)"
        print(f"  [{'OK' if ok else 'XX'}] {r['scenario_id']:30s} phase={phase:15s} exec={status}")

    out_path = (
        args.report
        if args.report
        else f"docs/tests/results/glyph-sweep-{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(summary, indent=2))
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
