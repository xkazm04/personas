r"""
Rapid validation — module verification driver.

Runs after `e2e_rapid_validation.py --all`. Verifies that the
runtime-side modules (Messages + Human Review) produce real
side-effects, not hollow "report-only" rows.

Schema notes (verified 2026-05-02 against personas.db):
  persona_messages              .id .persona_id .execution_id .title
                                .content .priority .is_read .created_at
                                .use_case_id  -- NO status column
  persona_message_deliveries    .id .message_id .channel_type .status
                                .error_message .delivered_at .created_at
                                -- status lives here (per-channel)
  persona_manual_reviews        .id .execution_id .persona_id .title
                                .severity .status .resolved_at
                                .reviewer_notes  -- NO mode column;
                                auto_triage inferred via policy_events
  persona_executions            .id .persona_id .status .use_case_id
                                .trigger_id .duration_ms .started_at
                                .completed_at .created_at
  policy_events                 .id .execution_id .persona_id .use_case_id
                                .policy_kind .action .reason .created_at
                                -- auto_triage events: policy_kind='review',
                                action ∈ {auto_triage.approved, .rejected,
                                .fallback}
  tool_execution_audit_log      .id .tool_name .tool_type .persona_id
                                .result_status .duration_ms .created_at

Usage:
  python tools/test-mcp/e2e_rapid_modules.py --report logs/rapid-modules.json
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

DEFAULT_DB = r"C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db"

parser = argparse.ArgumentParser(description="Module verification — Messages + Human Review")
parser.add_argument("--db", type=str, default=DEFAULT_DB)
parser.add_argument("--window-hours", type=int, default=4)
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()

con = sqlite3.connect(args.db)
con.row_factory = sqlite3.Row
cur = con.cursor()

events: list[dict] = []


def record(step: str, outcome: str, **kw) -> None:
    e = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "step": step,
        "outcome": outcome,
    }
    e.update(kw)
    events.append(e)
    marker = "[OK]" if outcome == "ok" else ("[..]" if outcome == "info" else "[XX]")
    sys.stdout.write(f"  {marker} {step}: {outcome}")
    if kw:
        brief = {k: v for k, v in kw.items()
                 if k != "detail" and not isinstance(v, (dict, list))}
        if brief:
            sys.stdout.write(f"  {brief}")
    sys.stdout.write("\n")
    sys.stdout.flush()


window_cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.window_hours)).isoformat()


# ---- Messages module ---------------------------------------------------

def check_messages() -> None:
    print("\n[1/3] Messages module")

    msg_count = cur.execute(
        "SELECT COUNT(*) AS c FROM persona_messages WHERE created_at >= ?",
        (window_cutoff,),
    ).fetchone()["c"]
    record("messages.count_in_window", "ok", count=msg_count)

    if msg_count == 0:
        record("messages.skip", "info",
               note="No messages in window — expected when no event-firing "
                    "personas executed (build-only validation). Re-run "
                    "after firing R11/R15/R17/R19 triggers.")
        return

    # Per-channel delivery status (the canonical pass/fail signal).
    delivery_rows = cur.execute(
        "SELECT d.status, COUNT(*) AS c "
        "FROM persona_messages m "
        "INNER JOIN persona_message_deliveries d ON d.message_id = m.id "
        "WHERE m.created_at >= ? "
        "GROUP BY d.status",
        (window_cutoff,),
    ).fetchall()
    delivery_counts = {r["status"]: r["c"] for r in delivery_rows}
    record("messages.delivery_status", "ok", counts=delivery_counts)

    delivered = delivery_counts.get("delivered", 0) + delivery_counts.get("Delivered", 0)
    failed = delivery_counts.get("failed", 0) + delivery_counts.get("Failed", 0)
    pending = delivery_counts.get("pending", 0) + delivery_counts.get("Pending", 0)

    # Hollow-row check: delivered status with delivered_at NULL is a lie.
    hollow = cur.execute(
        "SELECT COUNT(*) AS c "
        "FROM persona_messages m "
        "INNER JOIN persona_message_deliveries d ON d.message_id = m.id "
        "WHERE m.created_at >= ? "
        "AND d.status IN ('delivered','Delivered') "
        "AND d.delivered_at IS NULL",
        (window_cutoff,),
    ).fetchone()["c"]
    if hollow > 0:
        record("messages.hollow_check", "fail",
               hollow_delivered=hollow,
               note="Deliveries marked 'delivered' but delivered_at is NULL — "
                    "the dispatcher is lying.")
    else:
        record("messages.hollow_check", "ok",
               note="All delivered rows have a delivered_at timestamp",
               delivered=delivered)

    # Cross-check: every delivered message should have a corresponding
    # tool_execution_audit_log row in the same window. A delivered with
    # zero audit log rows means the dispatcher short-circuited.
    audit_total = cur.execute(
        "SELECT COUNT(*) AS c FROM tool_execution_audit_log WHERE created_at >= ?",
        (window_cutoff,),
    ).fetchone()["c"]
    record("messages.audit_log_total", "ok", count=audit_total)

    if delivered > 0 and audit_total == 0:
        record("messages.audit_cross_check", "fail",
               note=f"{delivered} delivered messages but no audit log rows — "
                    "dispatcher is short-circuiting tool calls")
    else:
        record("messages.audit_cross_check", "ok",
               delivered=delivered, audit=audit_total)

    if failed > 0:
        sample = cur.execute(
            "SELECT m.id, m.persona_id, d.channel_type, d.status, d.error_message "
            "FROM persona_messages m "
            "INNER JOIN persona_message_deliveries d ON d.message_id = m.id "
            "WHERE m.created_at >= ? AND d.status IN ('failed','Failed') "
            "LIMIT 5",
            (window_cutoff,),
        ).fetchall()
        record("messages.failed_samples", "info",
               count=failed,
               samples=[dict(r) for r in sample])


# ---- Human Review module -----------------------------------------------

def check_human_review() -> None:
    print("\n[2/3] Human Review module")

    rows = cur.execute(
        "SELECT status, COUNT(*) AS c "
        "FROM persona_manual_reviews "
        "WHERE created_at >= ? "
        "GROUP BY status",
        (window_cutoff,),
    ).fetchall()
    counts = {r["status"]: r["c"] for r in rows}
    record("review.count_by_status", "ok", counts=counts)

    if not rows:
        record("review.skip", "info",
               note="No reviews in window — expected without runtime UC firing")
        return

    pending_count = sum(counts.get(s, 0) for s in ("pending", "Pending"))
    approved_count = sum(counts.get(s, 0) for s in ("approved", "Approved"))
    rejected_count = sum(counts.get(s, 0) for s in ("rejected", "Rejected"))
    resolved_count = sum(counts.get(s, 0) for s in ("resolved", "Resolved"))

    record("review.summary", "ok",
           pending=pending_count, approved=approved_count,
           rejected=rejected_count, resolved=resolved_count)

    # Stuck-pending: any review IN THE WINDOW > 5 min old still in
    # Pending implies the auto_triage tokio task died OR no human is
    # acting. Scope to window to avoid dragging in pre-existing pending
    # reviews from prior sessions.
    stuck = cur.execute(
        "SELECT id, persona_id, title, severity, created_at "
        "FROM persona_manual_reviews "
        "WHERE status IN ('pending','Pending') "
        "AND created_at >= ? "
        "AND created_at < datetime('now','-5 minutes') "
        "LIMIT 10",
        (window_cutoff,),
    ).fetchall()
    if stuck:
        record("review.stuck_pending", "fail",
               count=len(stuck),
               samples=[dict(r) for r in stuck],
               note="Reviews older than 5min still in Pending. auto_triage "
                    "task may have died OR human-review UI is offline.")
    else:
        record("review.stuck_pending", "ok", count=0)

    # auto_triage audit-event coverage. policy_events.policy_kind='review'
    # with action LIKE 'auto_triage.%' is the canonical proof that
    # auto_triage actually fired.
    pe_rows = cur.execute(
        "SELECT action, COUNT(*) AS c "
        "FROM policy_events "
        "WHERE policy_kind = 'review' "
        "AND action LIKE 'auto_triage.%' "
        "AND created_at >= ? "
        "GROUP BY action",
        (window_cutoff,),
    ).fetchall()
    pe_counts = {r["action"]: r["c"] for r in pe_rows}
    record("review.auto_triage.audit_events", "ok", counts=pe_counts)

    # Reviews resolved (status != pending) with no audit row → broken
    # audit pipeline. Only flag when we have non-pending reviews AND
    # zero audit rows.
    non_pending_count = approved_count + rejected_count + resolved_count
    if non_pending_count > 0 and not pe_counts:
        record("review.auto_triage.audit_coverage", "info",
               note=f"{non_pending_count} reviews resolved but no auto_triage "
                    "audit rows. Either the reviews resolved through manual "
                    "human action (no audit needed) or the audit pipeline is "
                    "broken. Inspect manually if R13 was fired in this window.")
    else:
        record("review.auto_triage.audit_coverage", "ok")


# ---- Cross-module check ------------------------------------------------

def check_cross_module() -> None:
    print("\n[3/3] Cross-module sanity")

    recent_personas = cur.execute(
        "SELECT id, name, created_at FROM personas "
        "WHERE created_at >= ? "
        "ORDER BY created_at DESC LIMIT 30",
        (window_cutoff,),
    ).fetchall()
    record("cross.recent_personas", "ok",
           count=len(recent_personas),
           names=[r["name"] for r in recent_personas[:10]])

    exec_rows = cur.execute(
        "SELECT persona_id, COUNT(*) AS c "
        "FROM persona_executions "
        "WHERE created_at >= ? "
        "GROUP BY persona_id",
        (window_cutoff,),
    ).fetchall()
    total_execs = sum(r["c"] for r in exec_rows)
    record("cross.executions_in_window", "ok",
           personas_with_execs=len(exec_rows), total=total_execs)

    if total_execs == 0 and len(recent_personas) > 0:
        record("cross.execution_coverage", "info",
               note="Personas were created but no executions fired in window — "
                    "expected if you only built+promoted (no UC firing yet). "
                    "Run UC firing before re-running for full coverage.")
        return

    if total_execs > 0:
        # Status breakdown over fired executions
        success_rows = cur.execute(
            "SELECT status, COUNT(*) AS c FROM persona_executions "
            "WHERE created_at >= ? GROUP BY status",
            (window_cutoff,),
        ).fetchall()
        statuses = {r["status"]: r["c"] for r in success_rows}
        record("cross.execution_status_breakdown", "ok", counts=statuses)
        succ = sum(statuses.get(s, 0) for s in
                   ("success", "Success", "completed", "Completed"))
        if succ == 0:
            record("cross.execution_success_rate", "fail",
                   note="Executions fired but none reported success",
                   counts=statuses)
        else:
            record("cross.execution_success_rate", "ok",
                   succeeded=succ, of=total_execs)


def main() -> None:
    started = datetime.now(timezone.utc)
    print(f"Module verification window: last {args.window_hours}h "
          f"(since {window_cutoff})")
    print(f"Database: {args.db}")

    try:
        check_messages()
        check_human_review()
        check_cross_module()
    except Exception as e:
        record("modules.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        summary = {
            "started": started.isoformat(),
            "finished": finished.isoformat(),
            "duration_s": (finished - started).total_seconds(),
            "db": args.db,
            "window_hours": args.window_hours,
            "log": events,
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
