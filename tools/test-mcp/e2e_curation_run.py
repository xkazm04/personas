r"""
End-to-end scenario: Memory Curation Run via persona_jobs.

Validates the claude-managed-agents-dreaming subsystem (merged 2026-05-10 as
1be86e3b5) — enqueue a curation run on a persona, poll the persona_jobs
table for status transition, and apply or discard the resulting memory
review proposal.

Prerequisites:
  1. Dev app running with test-automation feature.
  2. At least one promoted persona in the DB (script will pick the first one).

Usage:
  uvx --with httpx python tools/test-mcp/e2e_curation_run.py
  uvx --with httpx python tools/test-mcp/e2e_curation_run.py --persona-id <uuid>
  uvx --with httpx python tools/test-mcp/e2e_curation_run.py --discard

Flags:
  --port <int>           test-automation server port (default 17320)
  --persona-id <str>     specific persona UUID to curate (default: first promoted)
  --discard              discard the proposal instead of applying (default: apply)
  --instructions <str>   curation instructions to pass through (optional)
  --job-timeout <sec>    max time to wait for the job to terminate (default 300)
  --report <path>        write the JSON run log here (default stdout)
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

from lib import Bridge, Client, DB, EventLog, WaitTimeout, wait_until

parser = argparse.ArgumentParser(description="Memory curation run e2e")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument("--persona-id", type=str, default=None)
parser.add_argument("--discard", action="store_true")
parser.add_argument("--instructions", type=str, default=None)
parser.add_argument("--job-timeout", type=int, default=300)
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()

client = Client(port=args.port, default_timeout=180)
bridge = Bridge(client)
db = DB()
log = EventLog()


def pick_persona() -> str:
    if args.persona_id:
        return args.persona_id
    rows = db.query(
        "SELECT id FROM personas WHERE status = 'promoted' "
        "ORDER BY created_at ASC LIMIT 1"
    )
    if not rows:
        raise SystemExit(
            "No promoted persona found. Run e2e_build_from_scratch.py first "
            "or pass --persona-id <uuid>."
        )
    return rows[0]["id"]


def step_preflight(persona_id: str) -> None:
    print(f"\n[1/4] Preflight (persona {persona_id})")
    client.health()
    log.record("preflight.persona", "ok", persona_id=persona_id)


def step_enqueue_job(persona_id: str) -> str:
    print("\n[2/4] Enqueue persona memory curation run")
    params = {"personaId": persona_id, "autoApply": False}
    if args.instructions:
        params["instructions"] = args.instructions
    r = bridge.exec("enqueuePersonaMemoryCuration", params, timeout_secs=30)
    if not r.get("success"):
        log.record("enqueue.curation", "fail", error=r.get("error"))
        raise SystemExit(f"enqueuePersonaMemoryCuration failed: {r.get('error')}")
    job_id = r.get("jobId") or r.get("id")
    log.record("enqueue.curation", "ok", job_id=job_id)
    return job_id


def step_wait_for_job_completion(job_id: str) -> dict:
    print(f"\n[3/4] Wait for job {job_id} to terminate")

    def check() -> dict | None:
        rows = db.query(
            "SELECT id, status, kind, error_message FROM persona_background_job "
            "WHERE id = ? LIMIT 1",
            (job_id,),
        )
        if not rows:
            return None
        row = rows[0]
        if row["status"] in ("completed", "failed", "cancelled"):
            return row
        return None

    try:
        terminal = wait_until(
            check,
            timeout=args.job_timeout,
            interval=5,
            message=f"Job {job_id} did not terminate within {args.job_timeout}s",
        )
    except WaitTimeout as e:
        log.record(
            "wait.job",
            "fail",
            error=str(e),
            last_value=e.last_value,
        )
        raise SystemExit(str(e)) from e
    log.record(
        "wait.job",
        "ok",
        status=terminal["status"],
        kind=terminal.get("kind"),
        error_message=terminal.get("error_message"),
    )
    return terminal


def step_apply_or_discard(persona_id: str) -> None:
    print("\n[4/4] Resolve the resulting memory review proposal")
    proposals = db.query(
        "SELECT id, status FROM persona_memory_review_proposal "
        "WHERE persona_id = ? AND status = 'pending' "
        "ORDER BY created_at DESC LIMIT 1",
        (persona_id,),
    )
    if not proposals:
        log.record(
            "proposal.lookup",
            "info",
            note="no pending proposal — curator may have decided no changes were needed",
        )
        return
    proposal_id = proposals[0]["id"]
    log.record("proposal.found", "ok", proposal_id=proposal_id)

    method = (
        "discardPersonaMemoryReviewProposal"
        if args.discard
        else "applyPersonaMemoryReviewProposal"
    )
    r = bridge.exec(method, {"proposalId": proposal_id}, timeout_secs=30)
    log.record(
        "proposal.resolve",
        "ok" if r.get("success") else "fail",
        action="discard" if args.discard else "apply",
        error=r.get("error"),
    )


def main() -> None:
    started = datetime.now(timezone.utc)
    try:
        persona_id = pick_persona()
        step_preflight(persona_id)
        job_id = step_enqueue_job(persona_id)
        step_wait_for_job_completion(job_id)
        step_apply_or_discard(persona_id)
    except SystemExit as e:
        log.record("scenario.abort", "fail", error=str(e))
    except Exception as e:
        log.record("scenario.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        log.dump(args.report, started=started, finished=finished)


if __name__ == "__main__":
    main()
