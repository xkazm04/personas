r"""
Retest cycle for the overnight sweep personas.

Walks every persona created during the 2026-05-11 overnight session,
re-executes it once under the new EXECUTION_MODE_DIRECTIVE (which
requires business_outcome), classifies the run, then:

  * keeps personas whose new run produced `value_delivered`
  * deletes personas whose new run produced `no_input_available` or
    `precondition_failed` (these are the "false positives" the user
    flagged — adopted/built but unusable due to missing setup)
  * keeps `partial` and `unknown` (the latter only if the LLM didn't
    emit the field, which would be a directive failure)

Also backfills `setup_status` on existing rows by running the same
vault check that `instant_adopt_template_inner` does for new ones —
that surfaces the "Setup required" badge on the UI for personas
that were created BEFORE the C1 gate landed.

Usage:
  uvx --with httpx python tools/test-mcp/retest_overnight_personas.py
  uvx --with httpx python tools/test-mcp/retest_overnight_personas.py --dry-run
  uvx --with httpx python tools/test-mcp/retest_overnight_personas.py --no-delete
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

# Windows consoles default to cp1250 which can't encode Unicode arrows etc.
# Reconfigure stdout/stderr to UTF-8 with replacement so prints don't crash.
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:17320"
DB_PATH = Path(os.environ["APPDATA"]) / "com.personas.desktop" / "personas.db"
SWEEP_CUTOFF = "2026-05-10 22:40:00"

# Built-in connectors that don't need a vault entry. Must match the
# Rust list at commands/design/template_adopt.rs::BUILTIN_LOCAL_CONNECTORS.
BUILTIN_CONNECTORS = {
    "local_drive",
    "personas_database",
    "personas_messages",
    "personas_vector_db",
}

NON_DELIVERING = {"no_input_available", "precondition_failed"}


def db_query(sql, params=()):
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def db_exec(sql, params=()):
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def db_scalar(sql, params=()):
    conn = sqlite3.connect(str(DB_PATH))
    try:
        row = conn.execute(sql, params).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def vault_connectors():
    """Return set of service_type values currently configured in vault."""
    rows = db_query("SELECT service_type FROM persona_credentials")
    return {r["service_type"].lower() for r in rows}


def persona_required_connectors(persona_id):
    """Return the set of credential types this persona's tools require
    (lowercase). Source of truth is persona_tool_definitions.requires_credential_type
    joined through persona_tools — that's what the runtime actually resolves.
    We also fold in design_context / last_design_result connector lists as a
    fallback for Glyph builds that ship richer metadata."""
    names = set()

    # Primary: tool definitions' required credential types
    rows = db_query(
        """SELECT DISTINCT ptd.requires_credential_type, ptd.category, ptd.name
           FROM persona_tool_definitions ptd
           JOIN persona_tools pt ON pt.tool_id = ptd.id
           WHERE pt.persona_id = ?""",
        (persona_id,),
    )
    for r in rows:
        cred = (r.get("requires_credential_type") or "").strip().lower()
        if cred:
            names.add(cred)
        # Some tools encode the connector in the tool name itself
        # (notion_search, gmail_search, drive_read_text, etc.). Map a
        # known prefix set to the credential name.
        tname = (r.get("name") or "").lower()
        for prefix in ("gmail_", "notion_", "github_", "linear_", "asana_", "attio_"):
            if tname.startswith(prefix):
                names.add(prefix.rstrip("_"))
                break

    # Fallback: design_context / last_design_result JSON
    row = db_query(
        "SELECT design_context, last_design_result FROM personas WHERE id = ?",
        (persona_id,),
    )
    if row:
        for col in ("design_context", "last_design_result"):
            raw = row[0].get(col)
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except Exception:
                continue
            for key in ("suggested_connectors", "required_connectors", "connectors"):
                for c in (data.get(key) or []):
                    if isinstance(c, dict):
                        n = c.get("name") or c.get("service_type")
                    elif isinstance(c, str):
                        n = c
                    else:
                        n = None
                    if n and isinstance(n, str):
                        names.add(n.strip().lower())
    return sorted(names)


def backfill_setup_status(personas, vault, dry_run):
    """For each persona, recompute setup_status based on current vault."""
    updated_needs = 0
    updated_ready = 0
    for p in personas:
        required = persona_required_connectors(p["id"])
        missing = [
            c for c in required
            if c not in BUILTIN_CONNECTORS and c not in vault
        ]
        new_status = "needs_credentials" if missing else "ready"
        if p["setup_status"] != new_status:
            if dry_run:
                print(f"  [dry] {p['name'][:40]:<40} {p['setup_status']} → {new_status}  missing={missing}")
            else:
                db_exec(
                    "UPDATE personas SET setup_status = ?, updated_at = ? WHERE id = ?",
                    (new_status, datetime.utcnow().isoformat() + "Z", p["id"]),
                )
            if new_status == "needs_credentials":
                updated_needs += 1
            else:
                updated_ready += 1
    return updated_needs, updated_ready


def execute_and_classify(client, persona_id, name, timeout_sec=900):
    """Trigger one execution and poll for business_outcome. Returns
    (status, business_outcome, exec_id) or (None, None, None) on failure."""
    # Record `started` BEFORE posting so the new execution's created_at
    # (assigned inside the Rust handler) is guaranteed to be >= started.
    # The handler returns AFTER the row exists, and the row's created_at
    # can be a few hundred microseconds before our post-return clock. We
    # also subtract one second of slack to absorb clock drift between
    # the Python process and SQLite's `datetime('now')`.
    started_dt = datetime.utcnow() - __import__("datetime").timedelta(seconds=2)
    started = started_dt.isoformat() + "Z"

    r = client.post(
        "/execute-persona",
        json={"name_or_id": persona_id},
        timeout=30,
    )
    try:
        body = r.json()
    except Exception:
        return None, None, None
    if not body.get("success"):
        print(f"    execute_start failed: {body.get('error')}")
        return None, None, None

    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        time.sleep(5)
        rows = db_query(
            "SELECT id, status, business_outcome FROM persona_executions "
            "WHERE persona_id = ? AND created_at >= ? "
            "ORDER BY created_at DESC LIMIT 1",
            (persona_id, started),
        )
        if not rows:
            continue
        row = rows[0]
        if row["status"] in ("completed", "failed", "incomplete", "cancelled"):
            return row["status"], row["business_outcome"], row["id"]
    return "timeout", None, None


def delete_persona(client, persona_id):
    try:
        client.post("/delete-agent", json={"name_or_id": persona_id}, timeout=15)
    except Exception as e:
        print(f"    delete failed: {e}")


# Patterns in message titles that almost always indicate a false-positive
# run — the persona executed cleanly but produced a status/readiness
# stub rather than business work. Conservative list: each phrase is one
# the LLM only uses when reporting "I had nothing to do" or "I'm blocked".
NO_INPUT_TITLE_PATTERNS = [
    "no input",
    "no source",
    "no inbox",
    "no database configured",
    "no transaction source",
    "unable to access",
    "no inbox access",
    "no pdfs found",
    "no pdfs to process",
    "readiness report",
    "readiness check",
    "initialization report",
    "standby status",
    "credential error",
    "setup required",
    "action required",
    "blocked:",
]

PRECONDITION_TITLE_PATTERNS = [
    "credential error",
    "unable to access",
    "setup required",
    "blocked:",
]


def classify_by_title(title: str) -> str | None:
    """Heuristic: classify a persona's latest message title as
    `no_input_available`, `precondition_failed`, or None (likely
    value_delivered). Conservative — leans toward `None` to avoid
    over-deletion."""
    if not title:
        return None
    t = title.lower()
    if any(p in t for p in PRECONDITION_TITLE_PATTERNS):
        return "precondition_failed"
    if any(p in t for p in NO_INPUT_TITLE_PATTERNS):
        return "no_input_available"
    return None


def heuristic_classify_and_prune(personas, client, dry_run, no_delete):
    """For each persona, look at the most recent message title and use
    the keyword heuristic to decide if the run was a false positive.
    Returns the result list."""
    results = []
    for i, p in enumerate(personas, 1):
        msg_rows = db_query(
            "SELECT title FROM persona_messages WHERE persona_id = ? "
            "ORDER BY created_at DESC LIMIT 1",
            (p["id"],),
        )
        title = (msg_rows[0]["title"] if msg_rows else "") or ""
        outcome = classify_by_title(title)
        verdict = outcome if outcome else "value_delivered"
        marker = "FALSE" if outcome else "KEEP "
        print(f"[{i:>3}/{len(personas)}] {marker} {p['name'][:42]:<42} {verdict:<22} '{title[:50]}'")
        row = {**p, "latest_msg_title": title, "heuristic_outcome": verdict}
        if outcome:
            row["deleted_reason"] = f"heuristic={outcome}"
            if not dry_run and not no_delete:
                delete_persona(client, p["id"])
        results.append(row)
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="No deletes / status writes — preview only.")
    parser.add_argument("--no-delete", action="store_true", help="Classify, but don't delete anything.")
    parser.add_argument("--no-rerun", action="store_true", help="Only backfill setup_status; skip classification + re-execution.")
    parser.add_argument(
        "--mode",
        choices=("heuristic", "rerun"),
        default="heuristic",
        help="`heuristic` reads existing message titles (fast, no execution cost). "
             "`rerun` re-executes each persona under the new directive (slow, ~10 min each).",
    )
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=999)
    parser.add_argument(
        "--cutoff",
        type=str,
        default=SWEEP_CUTOFF,
        help="Only touch personas created after this ISO timestamp.",
    )
    args = parser.parse_args()

    client = httpx.Client(base_url=BASE, timeout=30)
    health = client.get("/health").json()
    assert health.get("status") == "ok", f"app not healthy: {health}"

    personas = db_query(
        "SELECT id, name, enabled, setup_status FROM personas "
        "WHERE created_at > ? ORDER BY created_at",
        (args.cutoff,),
    )
    print(f"Found {len(personas)} personas created after {args.cutoff}")

    vault = vault_connectors()
    print(f"Vault has {len(vault)} configured connectors")

    # Step 1: backfill setup_status
    print("\n=== Backfilling setup_status ===")
    needs, ready = backfill_setup_status(personas, vault, args.dry_run)
    print(f"  → {needs} flipped to needs_credentials, {ready} flipped to ready")

    if args.no_rerun:
        print("\n--no-rerun set; skipping classification.")
        return

    # Re-fetch (setup_status may have changed)
    personas = db_query(
        "SELECT id, name, enabled, setup_status FROM personas "
        "WHERE created_at > ? ORDER BY created_at",
        (args.cutoff,),
    )

    personas = personas[args.start - 1 : args.end]

    # Step 2a: HEURISTIC mode — read existing message titles and prune by keyword
    if args.mode == "heuristic":
        print(f"\n=== Heuristic classification of {len(personas)} personas ===")
        results = heuristic_classify_and_prune(personas, client, args.dry_run, args.no_delete)
        delivered = sum(1 for r in results if r.get("heuristic_outcome") == "value_delivered")
        no_input = sum(1 for r in results if r.get("heuristic_outcome") == "no_input_available")
        blocked = sum(1 for r in results if r.get("heuristic_outcome") == "precondition_failed")
        deleted = sum(1 for r in results if r.get("deleted_reason"))
        print("\n" + "=" * 60)
        print("HEURISTIC RESULTS")
        print("=" * 60)
        print(f"  kept (value_delivered): {delivered}")
        print(f"  no_input_available:     {no_input}")
        print(f"  precondition_failed:    {blocked}")
        print(f"  deleted total:          {deleted}")

        out = Path(__file__).parent.parent.parent / "docs" / "tests" / "results" / f"retest-heuristic-{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "mode": "heuristic",
            "dry_run": args.dry_run,
            "no_delete": args.no_delete,
            "results": results,
            "totals": {
                "scanned": len(results),
                "value_delivered": delivered,
                "no_input_available": no_input,
                "precondition_failed": blocked,
                "deleted": deleted,
            },
        }, indent=2))
        print(f"\nWrote {out}")
        return

    # Step 2b: RERUN mode — re-execute each persona under the new directive
    print(f"\n=== Re-executing {len(personas)} personas ===")
    results = []
    for i, p in enumerate(personas, 1):
        if p["setup_status"] == "needs_credentials":
            print(f"\n[{i}/{len(personas)}] {p['name'][:50]}  (setup_status=needs_credentials)")
            print("    skipping re-execution; marking for delete based on setup gap")
            results.append({**p, "new_outcome": "precondition_failed", "deleted_reason": "needs_credentials"})
            if not args.no_delete and not args.dry_run:
                delete_persona(client, p["id"])
                print(f"    DELETED")
            continue

        print(f"\n[{i}/{len(personas)}] {p['name'][:50]}")
        status, outcome, exec_id = execute_and_classify(client, p["id"], p["name"])
        print(f"    status={status}  business_outcome={outcome}")
        result = {**p, "new_status": status, "new_outcome": outcome, "new_exec_id": exec_id}
        if outcome in NON_DELIVERING:
            result["deleted_reason"] = f"business_outcome={outcome}"
            if not args.no_delete and not args.dry_run:
                delete_persona(client, p["id"])
                print(f"    DELETED (false positive)")
            else:
                print(f"    WOULD DELETE (--no-delete or --dry-run)")
        results.append(result)

    # Step 3: report
    print("\n" + "=" * 60)
    print("RETEST RESULTS")
    print("=" * 60)
    delivered = sum(1 for r in results if r.get("new_outcome") == "value_delivered")
    no_input = sum(1 for r in results if r.get("new_outcome") == "no_input_available")
    blocked = sum(1 for r in results if r.get("new_outcome") == "precondition_failed")
    partial = sum(1 for r in results if r.get("new_outcome") == "partial")
    unknown = sum(1 for r in results if r.get("new_outcome") in (None, "unknown"))
    deleted = sum(1 for r in results if r.get("deleted_reason"))

    print(f"  value_delivered:     {delivered}")
    print(f"  no_input_available:  {no_input}")
    print(f"  precondition_failed: {blocked}")
    print(f"  partial:             {partial}")
    print(f"  unknown / no tag:    {unknown}")
    print(f"  deleted total:       {deleted}")

    # Save report
    out = Path(__file__).parent.parent.parent / "docs" / "tests" / "results" / f"retest-{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "cutoff": args.cutoff,
        "dry_run": args.dry_run,
        "no_delete": args.no_delete,
        "totals": {
            "scanned": len(results),
            "value_delivered": delivered,
            "no_input_available": no_input,
            "precondition_failed": blocked,
            "partial": partial,
            "unknown": unknown,
            "deleted": deleted,
        },
        "results": results,
    }, indent=2))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
