#!/usr/bin/env python3
"""
Targeted 12-template adoption + execution sweep.

User-picked subset of bundled templates the overnight session didn't cover,
or where the original run had business_outcome issues that may now resolve
under the post-2026-05-11 changes (new EXECUTION_MODE_DIRECTIVE, manual_review
gate, adoption pre-flight, circuit breaker).

For each template:
  1. Adopt via the same direct `/adopt-template` route as e2e_30_adoption.py.
  2. Trigger an execution.
  3. Poll persona_executions for terminal status + business_outcome.
  4. Record artifact counts (messages / memories / events / reviews).
  5. Report which ones land `value_delivered`.

Requires: `npm run tauri:dev:test` running on port 17320.
"""
from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:17320"
TIMEOUT = 35.0
DB_PATH = Path(os.environ["APPDATA"]) / "com.personas.desktop" / "personas.db"
TEMPLATES_DIR = Path(__file__).parent.parent.parent / "scripts" / "templates"
RESULTS_DIR = Path(__file__).parent.parent.parent / "docs" / "tests" / "results"

# Exact slug list with per-template input. The input is what we hand the
# persona's first turn via `execute_persona.inputData` so it has something
# concrete to act on — without this, every run lands `no_input_available`
# because the templates don't carry sample data on disk. Each value is a
# small JSON object with a `task` key (the high-signal "what to do now") and
# `sample_data` (a synthetic dataset the persona can process, exemplary but
# realistic). Mirrors what a real trigger would deliver.
TARGETS: list[dict] = [
    {
        "slug": "autonomous-art-director",
        "input": {
            "task": "Generate a visual identity brief for a new product launch.",
            "brief": {
                "product": "Halo, an AI-native task manager that schedules itself",
                "audience": "Independent founders and PMs",
                "tone": "Confident, minimal, optimistic",
                "channels": ["landing page", "twitter card", "app icon"],
            },
        },
    },
    {
        "slug": "self-evolving-codebase-memory",
        "input": {
            "task": "Ingest a small codebase summary and store reusable patterns as memory entries.",
            "codebase_summary": {
                "lang": "rust",
                "modules": ["auth", "db", "engine"],
                "patterns": [
                    {"name": "Result<T, AppError>", "where": "all DB repos", "rationale": "uniform error type"},
                    {"name": "Arc<Mutex<Option<Client>>>", "where": "connector clients", "rationale": "lazy + replaceable"},
                ],
            },
        },
    },
    {
        "slug": "knowledge-base-health-auditor",
        "input": {
            "task": "Audit this knowledge-base snapshot and produce a health report with concrete actions.",
            "snapshot": {
                "pages": [
                    {"title": "Onboarding", "last_edited": "2025-11-02", "links_in": 3, "links_out": 2},
                    {"title": "Old runbook v1", "last_edited": "2024-05-01", "links_in": 0, "links_out": 4},
                    {"title": "API design", "last_edited": "2026-04-30", "links_in": 8, "links_out": 1},
                    {"title": "TBD draft", "last_edited": "2025-01-15", "links_in": 0, "links_out": 0},
                ],
                "stale_threshold_days": 90,
            },
        },
    },
    {
        "slug": "newsletter-curator",
        "input": {
            "task": "Curate this week's newsletter from the candidate items.",
            "candidates": [
                {"title": "Claude 4.6 Sonnet released", "url": "https://example.com/a", "summary": "New context features"},
                {"title": "MCP gets streaming", "url": "https://example.com/b", "summary": "Protocol update"},
                {"title": "Rust 1.84 announced", "url": "https://example.com/c", "summary": "Stabilizations"},
                {"title": "Random crypto pump", "url": "https://example.com/d", "summary": "Off-topic"},
            ],
            "audience": "AI/dev productivity readership",
            "max_items": 3,
        },
    },
    {
        "slug": "qa-guardian",
        "input": {
            "task": "Review this PR diff and produce a QA report (risks, test gaps, suggested checks).",
            "pr": {
                "title": "feat(executions): add business_outcome tracking",
                "files_changed": ["src-tauri/src/engine/runner/mod.rs", "src-tauri/src/db/migrations/incremental.rs"],
                "diff_summary": "Adds business_outcome column; runner parses outcome_assessment.business_outcome and persists; no test coverage added",
            },
        },
    },
    {
        "slug": "technical-decision-tracker",
        "input": {
            "task": "Record this ADR and flag any conflict with prior decisions.",
            "adr": {
                "id": "ADR-0042",
                "title": "Adopt Kafka for event streaming backbone",
                "decision": "All cross-service events flow through a single Kafka cluster.",
                "context": "Current setup uses ad-hoc HTTP webhooks; observability and replay are missing.",
                "consequences": ["Ops cost increases", "Need schema registry"],
            },
            "prior_decisions": [
                {"id": "ADR-0038", "title": "Single-region deployment", "summary": "All infra in eu-west-1"},
                {"id": "ADR-0021", "title": "Async via SQS for queue work", "summary": "SQS for low-volume jobs"},
            ],
        },
    },
    {
        "slug": "ai-document-intelligence-hub",
        "input": {
            "task": "Extract structured intelligence from this document and produce a summary + key entities.",
            "document": {
                "title": "Q1 Customer Health Review",
                "content": (
                    "Acme Corp expanded usage 34% MoM; primary champion is Maya Chen (VP Eng). "
                    "They renewed for $480K ARR after switching from monthly to annual. Open risks: "
                    "consolidated procurement under their parent company Global Holdings. "
                    "Next milestone: integration with their internal data lake by 2026-08-01."
                ),
            },
        },
    },
    {
        "slug": "ai-weekly-research",
        "input": {
            "task": "Compile the weekly AI research roundup from these sources.",
            "topic": "Long-context evaluation benchmarks",
            "sources": [
                {"title": "Lost-in-the-Middle revisited (Anthropic)", "url": "https://example.com/a"},
                {"title": "Needle in a Haystack at 1M tokens", "url": "https://example.com/b"},
                {"title": "Context utilization metrics", "url": "https://example.com/c"},
            ],
            "audience": "Engineering leadership",
        },
    },
    {
        "slug": "product-scout",
        "input": {
            "task": "Score these product opportunities against our existing roadmap and flag the top picks.",
            "opportunities": [
                {"name": "Multi-persona chat router", "evidence": "5 users asked in last 30 days", "ease": "medium"},
                {"name": "GitHub PR auto-review bot", "evidence": "0 users asked, my hypothesis", "ease": "high"},
                {"name": "Notion sync v2", "evidence": "2 active threads, 1 paying customer asked", "ease": "medium"},
            ],
            "current_roadmap": ["business_outcome tracking", "adoption pre-flight", "circuit breaker"],
        },
    },
    {
        "slug": "dev-clone",
        "input": {
            "task": "Learn from these recent commits and capture the developer's working style as memories.",
            "commits": [
                {"sha": "b72a7116f", "msg": "feat(notifications): execution bell click opens detail modal on Overview › Activity"},
                {"sha": "877663b15", "msg": "feat(personas): SetupStatusBadge placement + circuit-breaker auto-disable"},
                {"sha": "ada2c9353", "msg": "feat(executions): add business_outcome tracking + manual_review directive"},
            ],
            "observations_so_far": [
                "Pairs related concerns in single commits (UI + behavior)",
                "Writes long, why-focused commit bodies",
            ],
        },
    },
    {
        "slug": "daily-standup-compiler",  # internal "name" is "Daily Personal Briefer"
        "input": {
            "task": "Compile today's standup digest from these items.",
            "yesterday": [
                "Shipped business_outcome end-to-end",
                "Added adoption pre-flight",
                "Built SetupStatusBadge + circuit breaker",
            ],
            "today_planned": [
                "Targeted 12-template retest",
                "Push every template to value_delivered",
            ],
            "blockers": ["Templates without sample data fall to no_input_available — addressing via inputData"],
        },
    },
    {
        "slug": "idea-harvester",
        "input": {
            "task": "Harvest and rank these raw ideas, classify by domain.",
            "raw_ideas": [
                "Bell notifications could group by persona",
                "Use_case-level retry budget separate from persona-level",
                "Inline diff view inside ExecutionDetailModal",
                "Auto-link related ADRs by semantic similarity",
                "Promote heuristic for classifying false-positive executions into a Rust scheduler",
            ],
            "domains": ["UX", "Reliability", "AI"],
        },
    },
]

TARGET_SLUGS = [t["slug"] for t in TARGETS]
INPUT_BY_SLUG = {t["slug"]: t["input"] for t in TARGETS}

client = httpx.Client(base_url=BASE, timeout=TIMEOUT)


def db_scalar(sql, params=()):
    conn = sqlite3.connect(str(DB_PATH))
    try:
        row = conn.execute(sql, params).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def db_query(sql, params=()):
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def find_template(slug: str):
    for cat in TEMPLATES_DIR.iterdir():
        if not cat.is_dir() or cat.name.startswith("_"):
            continue
        f = cat / f"{slug}.json"
        if f.exists():
            data = json.loads(f.read_text(encoding="utf-8"))
            return {
                "slug": slug,
                "name": data["name"],
                "category": data.get("category", ["other"])[0],
                "payload_json": json.dumps(data.get("payload", {})),
            }
    return None


def adopt(t):
    print(f"  Adopting: {t['name']} ({t['slug']})")
    r = client.post(
        "/adopt-template",
        json={"template_name": t["name"], "design_result_json": t["payload_json"]},
    ).json()
    if not r.get("success"):
        print(f"    ADOPT FAILED: {r.get('error', 'unknown')}")
        return None, None, None
    result = r.get("result") or {}
    persona = result.get("persona") or {}
    pid = persona.get("id") or ""
    name = persona.get("name") or t["name"]
    setup = result.get("setup_status") or "ready"
    print(f"    Adopted persona_id={pid[:8]}  name='{name}'  setup_status={setup}")
    # Surface missing credentials immediately so the user can act
    if result.get("missing_credentials"):
        print(f"    missing_credentials={result['missing_credentials']}")
    # Force store refresh so frontend bridge knows
    try:
        client.post("/refresh-personas")
    except Exception:
        pass
    time.sleep(1)
    return pid, name, setup


def execute_and_wait(persona_id, name, slug, timeout_secs=900):
    print(f"  Executing: {name}")
    body: dict = {"name_or_id": name}
    if slug in INPUT_BY_SLUG:
        body["input_data"] = INPUT_BY_SLUG[slug]
    r = client.post("/execute-persona", json=body, timeout=30).json()
    if not r.get("success"):
        print(f"    execute_start failed: {r.get('error')}")
        return None
    started = datetime.utcnow().isoformat() + "Z"
    deadline = time.time() + timeout_secs
    last = None
    while time.time() < deadline:
        time.sleep(5)
        rows = db_query(
            "SELECT id, status, business_outcome, cost_usd, duration_ms FROM persona_executions "
            "WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
            (persona_id,),
        )
        if not rows:
            continue
        last = rows[0]
        if last["status"] in ("completed", "failed", "incomplete", "cancelled"):
            return last
    return last  # may be running on timeout


def verify_artifacts(persona_id):
    return {
        "messages":  db_scalar("SELECT COUNT(*) FROM persona_messages WHERE persona_id=?",       (persona_id,)) or 0,
        "memories":  db_scalar("SELECT COUNT(*) FROM persona_memories WHERE persona_id=?",       (persona_id,)) or 0,
        "events":    db_scalar("SELECT COUNT(*) FROM persona_events WHERE source_id=? OR target_persona_id=?", (persona_id, persona_id)) or 0,
        "reviews":   db_scalar("SELECT COUNT(*) FROM persona_manual_reviews WHERE persona_id=?", (persona_id,)) or 0,
    }


def main():
    health = client.get("/health").json()
    assert health.get("status") == "ok", f"server not healthy: {health}"
    print(f"Server: {health}")
    print(f"Targeting {len(TARGET_SLUGS)} templates\n")

    results = []
    started_at = datetime.now()
    for i, slug in enumerate(TARGET_SLUGS, 1):
        print(f"\n{'='*60}")
        print(f"  [{i}/{len(TARGET_SLUGS)}] {slug}")
        print(f"{'='*60}")
        t = find_template(slug)
        if not t:
            print(f"  NOT FOUND on disk — skipping")
            results.append({"slug": slug, "found": False})
            continue

        pid, name, setup = adopt(t)
        if not pid:
            results.append({"slug": slug, "name": t["name"], "adopt": False})
            continue

        row = {
            "slug": slug,
            "name": t["name"],
            "persona_id": pid,
            "persona_name": name,
            "adopt": True,
            "setup_status": setup,
        }

        exe = execute_and_wait(pid, name, slug)
        if exe:
            row["exec_status"] = exe["status"]
            row["business_outcome"] = exe.get("business_outcome")
            row["cost_usd"] = exe.get("cost_usd")
            row["duration_ms"] = exe.get("duration_ms")
            print(f"    Exec status={exe['status']}  business_outcome={exe.get('business_outcome')}  cost=${(exe.get('cost_usd') or 0):.4f}  dur={(exe.get('duration_ms') or 0)}ms")
            row["artifacts"] = verify_artifacts(pid)
            print(f"    Artifacts: messages={row['artifacts']['messages']}  memories={row['artifacts']['memories']}  events={row['artifacts']['events']}  reviews={row['artifacts']['reviews']}")
        else:
            print(f"    No execution row found")
            row["exec_status"] = "missing"

        results.append(row)

    # Summary
    duration = datetime.now() - started_at
    print(f"\n{'='*60}")
    print(f"  TARGETED ADOPTION RESULTS  ({duration})")
    print(f"{'='*60}")
    delivered = sum(1 for r in results if r.get("business_outcome") == "value_delivered")
    no_input = sum(1 for r in results if r.get("business_outcome") == "no_input_available")
    blocked = sum(1 for r in results if r.get("business_outcome") == "precondition_failed")
    partial = sum(1 for r in results if r.get("business_outcome") == "partial")
    unknown = sum(1 for r in results if r.get("business_outcome") in (None, "unknown"))
    completed = sum(1 for r in results if r.get("exec_status") == "completed")
    for r in results:
        bo = r.get("business_outcome") or "—"
        ok = "OK" if r.get("business_outcome") == "value_delivered" else "  "
        print(f"  [{ok}] {r.get('name', r['slug'])[:42]:<42} status={r.get('exec_status','?'):<10} business={bo}")
    print(f"\n  Adopted:        {sum(1 for r in results if r.get('adopt'))}/{len(results)}")
    print(f"  Completed:      {completed}")
    print(f"  Value delivered: {delivered}")
    print(f"  No input:        {no_input}")
    print(f"  Blocked:         {blocked}")
    print(f"  Partial:         {partial}")
    print(f"  Unknown:         {unknown}")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = RESULTS_DIR / f"targeted-12-{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    out.write_text(json.dumps({
        "started_at": started_at.isoformat(),
        "duration_s": duration.total_seconds(),
        "results": results,
        "totals": {
            "adopted": sum(1 for r in results if r.get("adopt")),
            "completed": completed,
            "value_delivered": delivered,
            "no_input_available": no_input,
            "precondition_failed": blocked,
            "partial": partial,
            "unknown": unknown,
        },
    }, indent=2))
    print(f"\n  Wrote {out}")


if __name__ == "__main__":
    main()
