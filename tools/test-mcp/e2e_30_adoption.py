#!/usr/bin/env python3
"""
E2E Test: 30 Template Adoptions × Full Lifecycle

Adopts 30 templates via instant_adopt_template, executes each persona,
and verifies Overview modules (Executions, Messages, Knowledge, Events)
and the Matrix tab are populated.

Usage:
  python e2e_30_adoption.py                    # Run all
  python e2e_30_adoption.py --start 1 --end 10 # Run subset
  python e2e_30_adoption.py --template 5       # Single template

Requires: npx tauri dev --features test-automation (port 17320)
"""

import argparse
import httpx
import json
import os
import sqlite3
import sys
import io
import time
from datetime import datetime
from pathlib import Path

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

BASE = "http://127.0.0.1:17320"
TIMEOUT = 35.0
DB_PATH = os.path.join(os.environ.get("APPDATA", ""), "com.personas.desktop", "personas.db")
TEMPLATES_DIR = Path(__file__).parent.parent.parent / "scripts" / "templates"
RESULTS_DIR = Path(__file__).parent.parent.parent / "docs" / "tests" / "results"

client = httpx.Client(base_url=BASE, timeout=TIMEOUT)


def api_get(path):
    for attempt in range(3):
        try:
            return client.get(path).json()
        except Exception as e:
            if attempt == 2: raise
            time.sleep(2)


def api_post(path, body=None):
    for attempt in range(3):
        try:
            return client.post(path, json=body or {}).json()
        except Exception as e:
            if attempt == 2: raise
            time.sleep(2)


def db_scalar(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute(sql, params).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def db_query(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# Discover templates
# ═══════════════════════════════════════════════════════════════════════════════

OUR_TEMPLATE_SLUGS = {
    "access-request-manager", "budget-spending-monitor", "contact-enrichment-agent",
    "contact-sync-manager", "content-performance-reporter", "content-schedule-manager",
    "daily-standup-compiler", "database-performance-monitor", "email-follow-up-tracker",
    "email-lead-extractor", "email-task-extractor", "expense-receipt-tracker",
    "gmail-morning-digest", "gmail-support-assistant", "idea-harvester",
    "incident-logger", "invoice-tracker", "newsletter-curator",
    "notion-docs-auditor", "onboarding-tracker", "research-knowledge-curator",
    "research-paper-indexer", "sales-deal-analyzer", "sales-deal-tracker",
    "sales-proposal-generator", "service-health-reporter", "support-email-router",
    "survey-insights-analyzer", "technical-decision-tracker", "weekly-review-reporter",
}

def discover_templates():
    """Find our 30 generated best-practice templates."""
    templates = []

    for cat_dir in TEMPLATES_DIR.iterdir():
        if not cat_dir.is_dir() or cat_dir.name.startswith('_'):
            continue
        for f in cat_dir.glob("*.json"):
            try:
                with open(f, encoding='utf-8') as fh:
                    t = json.load(fh)
                if t.get("id") in OUR_TEMPLATE_SLUGS:
                    payload = t.get("payload", {})
                    templates.append({
                        "path": str(f),
                        "id": t["id"],
                        "name": t["name"],
                        "category": t.get("category", ["other"])[0],
                        "payload_json": json.dumps(payload),
                    })
            except Exception as e:
                print(f"  SKIP {f.name}: {e}")

    templates.sort(key=lambda t: t["name"])
    return templates


# ═══════════════════════════════════════════════════════════════════════════════
# Adoption + Execution + Verification
# ═══════════════════════════════════════════════════════════════════════════════

def adopt_template(tmpl):
    """Adopt a template via the direct Rust endpoint. Returns persona_id or None."""
    print(f"  Adopting: {tmpl['name']}...")
    r = api_post("/adopt-template", {
        "template_name": tmpl["name"],
        "design_result_json": tmpl["payload_json"],
    })
    if r.get("success"):
        result = r.get("result", {})
        persona = result.get("persona", {})
        pid = persona.get("id", "")
        name = persona.get("name", tmpl["name"])
        print(f"    Adopted! Persona: {name} ({pid[:12]}...)")
        # Force store refresh so bridge knows about new persona
        try:
            api_post("/refresh-personas")
        except Exception:
            pass
        time.sleep(1)
        return pid, name
    else:
        print(f"    FAILED: {r.get('error', 'unknown')}")
        return None, None


def execute_persona(persona_id, name):
    """Execute persona and wait for completion. Returns True/False."""
    print(f"  Executing: {name}...")
    # Use full name — "T: " prefix ensures uniqueness
    r = api_post("/execute-persona", {"name_or_id": name})
    if not r.get("success"):
        print(f"    Execute start failed: {r.get('error')}")
        return False

    # Poll DB for completion
    for attempt in range(90):
        time.sleep(5)
        row = db_query(
            "SELECT status, cost_usd, duration_ms FROM persona_executions WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
            (persona_id,)
        )
        if row and row[0]["status"] == "completed":
            cost = row[0].get("cost_usd", 0)
            dur = row[0].get("duration_ms", 0)
            print(f"    Completed: cost=${cost:.3f} duration={dur}ms")
            return True
        if row and row[0]["status"] == "failed":
            print(f"    FAILED")
            return False
        if attempt % 12 == 11:
            status = row[0]["status"] if row else "no-record"
            print(f"    Still executing... ({status})")

    print(f"    TIMEOUT")
    return False


def verify_overview(persona_id):
    """Verify Overview modules are populated."""
    checks = {}

    # Executions
    exec_count = db_scalar("SELECT COUNT(*) FROM persona_executions WHERE persona_id = ? AND status = 'completed'", (persona_id,))
    checks["executions"] = (exec_count or 0) > 0

    # Messages
    msg_count = db_scalar("SELECT COUNT(*) FROM persona_messages WHERE persona_id = ?", (persona_id,))
    checks["messages"] = (msg_count or 0) > 0

    # Memories
    mem_count = db_scalar("SELECT COUNT(*) FROM persona_memories WHERE persona_id = ?", (persona_id,))
    checks["memories"] = (mem_count or 0) > 0

    # Events (check if persona emitted or received any)
    evt_count = db_scalar(
        "SELECT COUNT(*) FROM persona_events WHERE source_id = ? OR target_persona_id = ?",
        (persona_id, persona_id)
    )
    checks["events"] = (evt_count or 0) > 0

    # Manual Reviews
    rev_count = db_scalar("SELECT COUNT(*) FROM persona_manual_reviews WHERE persona_id = ?", (persona_id,))
    checks["reviews"] = (rev_count or 0) > 0

    passed = sum(1 for v in checks.values() if v)
    total = len(checks)
    print(f"    Verify: exec={checks['executions']} msg={checks['messages']} mem={checks['memories']} evt={checks['events']} rev={checks['reviews']} ({passed}/{total})")
    return checks


def verify_matrix(persona_id):
    """Verify PersonaMatrix data is available for the Matrix tab."""
    # Check design_context
    dc = db_scalar("SELECT design_context FROM personas WHERE id = ?", (persona_id,))
    has_dc = dc is not None and len(dc or "") > 10

    # Check last_design_result
    dr = db_scalar("SELECT last_design_result FROM personas WHERE id = ?", (persona_id,))
    has_dr = dr is not None and len(dr or "") > 10

    # Check structured_prompt
    sp = db_scalar("SELECT structured_prompt FROM personas WHERE id = ?", (persona_id,))
    has_sp = sp is not None and len(sp or "") > 10

    ok = has_dc or has_dr
    print(f"    Matrix: design_context={has_dc} last_design_result={has_dr} structured_prompt={has_sp} -> {'OK' if ok else 'MISSING'}")
    return ok


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=30)
    parser.add_argument("--template", type=int)
    args = parser.parse_args()

    # Health check
    health = api_get("/health")
    assert health.get("status") == "ok", f"Server not healthy: {health}"
    print(f"Server: {health}")

    # Discover templates
    templates = discover_templates()
    print(f"Found {len(templates)} templates")

    # Filter range
    if args.template:
        templates = [templates[args.template - 1]] if args.template <= len(templates) else []
    else:
        templates = templates[args.start - 1:args.end]

    print(f"Testing {len(templates)} templates\n")

    results = {}
    start_time = datetime.now()

    for i, tmpl in enumerate(templates, 1):
        print(f"\n{'='*60}")
        print(f"  [{i}/{len(templates)}] {tmpl['name']} ({tmpl['category']})")
        print(f"{'='*60}")

        # Phase 1: Adopt
        pid, name = adopt_template(tmpl)
        if not pid:
            results[tmpl["name"]] = {"adopt": False, "execute": False, "verify": {}, "matrix": False}
            continue

        results[tmpl["name"]] = {"adopt": True, "persona_id": pid, "persona_name": name}

        # Phase 2: Execute
        exec_ok = execute_persona(pid, name)
        results[tmpl["name"]]["execute"] = exec_ok

        if not exec_ok:
            results[tmpl["name"]]["verify"] = {}
            results[tmpl["name"]]["matrix"] = False
            continue

        # Phase 3: Verify Overview
        checks = verify_overview(pid)
        results[tmpl["name"]]["verify"] = checks

        # Phase 4: Verify Matrix
        matrix_ok = verify_matrix(pid)
        results[tmpl["name"]]["matrix"] = matrix_ok

    # Summary
    duration = datetime.now() - start_time
    print(f"\n{'='*60}")
    print(f"  ADOPTION TEST RESULTS")
    print(f"  Duration: {duration}")
    print(f"{'='*60}")

    adopted = sum(1 for r in results.values() if r.get("adopt"))
    executed = sum(1 for r in results.values() if r.get("execute"))
    with_messages = sum(1 for r in results.values() if r.get("verify", {}).get("messages"))
    with_memory = sum(1 for r in results.values() if r.get("verify", {}).get("memories"))
    with_matrix = sum(1 for r in results.values() if r.get("matrix"))

    for name, r in sorted(results.items()):
        icon = "OK" if r.get("execute") else "!!"
        print(f"  [{icon}] {name[:40]:<40} adopt={'Y' if r.get('adopt') else 'N'} "
              f"exec={'Y' if r.get('execute') else 'N'} "
              f"msg={'Y' if r.get('verify',{}).get('messages') else '-'} "
              f"mem={'Y' if r.get('verify',{}).get('memories') else '-'} "
              f"matrix={'Y' if r.get('matrix') else '-'}")

    print(f"\n  Adopted:  {adopted}/{len(results)}")
    print(f"  Executed: {executed}/{len(results)}")
    print(f"  Messages: {with_messages}/{len(results)}")
    print(f"  Memory:   {with_memory}/{len(results)}")
    print(f"  Matrix:   {with_matrix}/{len(results)}")

    # Save results
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    result_file = RESULTS_DIR / f"adoption_{ts}.json"
    with open(result_file, "w") as f:
        json.dump({"timestamp": str(start_time), "duration_s": duration.total_seconds(), "results": results}, f, indent=2)
    print(f"\n  Results: {result_file}")


if __name__ == "__main__":
    main()
