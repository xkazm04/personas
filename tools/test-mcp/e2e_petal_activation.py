#!/usr/bin/env python3
"""
E2E: Petal-activation test for 10 templates.

For each template: adopt (seed -> build -> promote) via /adopt-template, then
execute EACH capability via /execute-persona {use_case_id}, and verify the
OUTPUT petals fired as the persona's baked metadata requests:

  * Messages      -> persona_messages rows tied to the execution
  * Events        -> persona_events rows emitted by the execution
  * Human review  -> persona_manual_reviews rows from the execution

Expectations come from the BUILT persona's design_context.useCases[]:
  - review_policy.mode == "always"            -> MUST create >=1 review
  - notification_channels non-empty / messaging output -> SHOULD message
  - event_subscriptions emit / generation_settings.events==on -> MAY emit

"Petal set but IGNORED" detection (the bug class we care about):
  - policy_events rows with action='dropped' for an execution  -> a configured
    output was suppressed by a policy mismatch (HARD FAIL).
  - review_policy=always but 0 reviews produced                -> ignored (FAIL).

Requires the app running with the test-automation server:
    npm run tauri:dev:test          # exposes http://127.0.0.1:17320

Usage:
    python tools/test-mcp/e2e_petal_activation.py                 # all 10
    python tools/test-mcp/e2e_petal_activation.py --only router   # subset (id substrings)
    python tools/test-mcp/e2e_petal_activation.py --smoke         # first template only
"""
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

if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

BASE = os.environ.get("PERSONAS_TEST_BASE", "http://127.0.0.1:17320")
TIMEOUT = 35.0
DB_PATH = os.path.join(os.environ.get("APPDATA", ""), "com.personas.desktop", "personas.db")
TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "scripts" / "templates"
RESULTS_DIR = Path(__file__).resolve().parent.parent.parent / "docs" / "tests" / "results"

# The 10 templates under test (by template id).
TARGET_IDS = [
    "skill-librarian",
    "ai-document-intelligence-hub",
    "router",
    "ai-research-report-generator",
    "financial-stocks-signaller",
    "codebase-health-scanner",
    "real-time-database-watcher",
    "idea-harvester",
    "email-morning-digest",
    "dev-clone",
]

# Per-capability execution cap (the build/exec call the live LLM).
EXEC_POLL_SECS = 5
EXEC_POLL_TRIES = 90  # ~7.5 min per capability

client = httpx.Client(base_url=BASE, timeout=TIMEOUT)


def api_get(path):
    for attempt in range(3):
        try:
            return client.get(path).json()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)


def api_post(path, body=None):
    for attempt in range(3):
        try:
            return client.post(path, json=body or {}).json()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)


def db_query(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def db_scalar(sql, params=()):
    rows = db_query(sql, params)
    if not rows:
        return None
    return list(rows[0].values())[0]


def load_templates():
    by_id = {}
    for cat in TEMPLATES_DIR.iterdir():
        if not cat.is_dir() or cat.name.startswith("_"):
            continue
        for f in cat.glob("*.json"):
            if any(f.name.endswith(f".{lng}.json") for lng in
                   ("ar", "bn", "cs", "de", "es", "fr", "hi", "id", "ja", "ko", "ru", "vi", "zh")):
                continue
            try:
                t = json.load(open(f, encoding="utf-8"))
            except Exception:
                continue
            if t.get("id") in TARGET_IDS:
                by_id[t["id"]] = {
                    "id": t["id"],
                    "name": t["name"],
                    "payload_json": json.dumps(t.get("payload", {})),
                }
    return [by_id[i] for i in TARGET_IDS if i in by_id], [i for i in TARGET_IDS if i not in by_id]


def get_capabilities(persona_id):
    """Read the built persona's capabilities + their baked output metadata."""
    dc = db_scalar("SELECT design_context FROM personas WHERE id = ?", (persona_id,))
    if not dc:
        return []
    try:
        parsed = json.loads(dc)
    except Exception:
        return []
    ucs = parsed.get("useCases") or parsed.get("use_cases") or []
    caps = []
    for uc in ucs:
        if not isinstance(uc, dict):
            continue
        gen = uc.get("generation_settings") or {}
        rp = uc.get("review_policy") or {}
        subs = uc.get("event_subscriptions") or []
        chans = uc.get("notification_channels") or []
        emits = [s for s in subs if isinstance(s, dict) and s.get("direction") == "emit"]
        caps.append({
            "id": uc.get("id"),
            "title": uc.get("title") or uc.get("name") or uc.get("id"),
            "trigger": ((uc.get("suggested_trigger") or {}).get("trigger_type")
                        or (uc.get("suggested_trigger") or {}).get("type") or "manual"),
            "expect_review": (rp.get("mode") == "always") or (gen.get("reviews") == "on"),
            "review_off": gen.get("reviews") == "off",
            "expect_event": len(emits) > 0 or gen.get("events") == "on",
            "events_off": gen.get("events") == "off",
            "expect_message": len(chans) > 0,
        })
    return caps


def execute_capability(persona_id, name, cap):
    """SIMULATE one capability and wait for its execution to go terminal.

    We use `simulate_use_case` (not `execute_persona`) so the run bypasses the
    connector-readiness gate (`is_simulation` skips the needs_credentials check)
    yet still PERSISTS protocol outputs — messages/events/reviews are written to
    the DB; only outbound delivery (Slack/email/incident/backlog) is skipped.
    That's exactly what petal verification needs without configuring credentials
    for 10 templates. Returns the execution row dict (or None on timeout)."""
    if not cap.get("id"):
        return {"_error": "capability has no use_case id"}
    r = api_post("/bridge-exec", {
        "method": "invokeCommand",
        "params": {"command": "simulate_use_case",
                   "params": {"personaId": persona_id, "useCaseId": cap["id"]}},
        "timeout_secs": 120,
    })
    if not r.get("success"):
        return {"_error": r.get("error", "bridge invokeCommand failed")}
    res = r.get("result")
    if isinstance(res, str):
        try:
            res = json.loads(res)
        except Exception:
            res = {}
    res = res or {}
    if res.get("error"):
        return {"_error": res["error"]}
    exec_id = res.get("id")
    if not exec_id:
        return {"_error": f"no execution id in simulate result: {res}"}
    for _ in range(EXEC_POLL_TRIES):
        time.sleep(EXEC_POLL_SECS)
        rows = db_query(
            "SELECT id, status, use_case_id, cost_usd, error_message FROM persona_executions WHERE id = ?",
            (exec_id,),
        )
        if rows and rows[0]["status"] in ("completed", "failed", "incomplete", "cancelled"):
            return rows[0]
    return None


def verify_outputs(persona_id, execution_id, cap):
    """Count the petal outputs tied to this execution + policy drops."""
    msgs = db_scalar("SELECT COUNT(*) FROM persona_messages WHERE execution_id = ?", (execution_id,)) or 0
    reviews = db_scalar("SELECT COUNT(*) FROM persona_manual_reviews WHERE execution_id = ?", (execution_id,)) or 0
    # Events have no execution_id FK — scope by use_case + source + recency.
    if cap.get("id"):
        events = db_scalar(
            "SELECT COUNT(*) FROM persona_events WHERE source_id = ? AND use_case_id = ? "
            "AND created_at >= datetime('now','-10 minutes')",
            (persona_id, cap["id"]),
        ) or 0
    else:
        events = db_scalar(
            "SELECT COUNT(*) FROM persona_events WHERE source_id = ? AND created_at >= datetime('now','-10 minutes')",
            (persona_id,),
        ) or 0
    # "Set but ignored": a configured output dropped by policy.
    drops = []
    try:
        drops = db_query(
            "SELECT policy_kind, action FROM policy_events WHERE execution_id = ? AND action = 'dropped'",
            (execution_id,),
        )
    except Exception:
        pass  # table may not exist on older schemas
    return {"messages": msgs, "events": events, "reviews": reviews, "policy_drops": drops}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated id substrings")
    ap.add_argument("--smoke", action="store_true", help="first matched template only")
    args = ap.parse_args()

    health = api_get("/health")
    assert health.get("status") == "ok", f"test-automation server not healthy: {health}"
    print(f"server: {health}")

    templates, missing = load_templates()
    if missing:
        print(f"!! template ids not found: {missing}")
    if args.only:
        subs = [s.strip() for s in args.only.split(",")]
        templates = [t for t in templates if any(s in t["id"] for s in subs)]
    if args.smoke:
        templates = templates[:1]
    print(f"testing {len(templates)} templates\n")

    started = datetime.now()
    results = {}

    for i, tmpl in enumerate(templates, 1):
        print(f"\n{'='*64}\n  [{i}/{len(templates)}] {tmpl['name']} ({tmpl['id']})\n{'='*64}")
        tr = {"adopt": False, "capabilities": []}
        results[tmpl["id"]] = tr

        print("  adopting...")
        a = api_post("/adopt-template", {"template_name": tmpl["name"], "design_result_json": tmpl["payload_json"]})
        if not a.get("success"):
            tr["error"] = a.get("error", "adopt failed")
            print(f"  ADOPT FAILED: {tr['error']}")
            continue
        pid = (a.get("result", {}).get("persona", {}) or {}).get("id")
        tr["adopt"] = True
        tr["persona_id"] = pid
        try:
            api_post("/refresh-personas")
        except Exception:
            pass
        time.sleep(1)
        print(f"  adopted persona {pid}")

        caps = get_capabilities(pid)
        if not caps:
            tr["error"] = "no capabilities in design_context"
            print("  !! no capabilities found")
            continue

        for cap in caps:
            if cap["trigger"] == "event_listener":
                print(f"  - {cap['title']}: skip (event_listener trigger)")
                continue
            print(f"  - simulating capability: {cap['title']} ({cap['id']})")
            ex = execute_capability(pid, tmpl["name"], cap)
            cap_res = {"id": cap["id"], "title": cap["title"], "expect": {
                "review": cap["expect_review"], "message": cap["expect_message"], "event": cap["expect_event"]}}
            if ex is None:
                cap_res["status"] = "timeout"
                print("      TIMEOUT")
                tr["capabilities"].append(cap_res)
                continue
            if ex.get("_error"):
                cap_res["status"] = "exec_error"
                cap_res["error"] = ex["_error"]
                print(f"      EXEC ERROR: {ex['_error']}")
                tr["capabilities"].append(cap_res)
                continue
            cap_res["status"] = ex["status"]
            cap_res["execution_id"] = ex["id"]
            out = verify_outputs(pid, ex["id"], cap)
            cap_res["out"] = out
            # Verdicts
            issues = []
            if out["policy_drops"]:
                issues.append(f"IGNORED(policy-drop:{[d['policy_kind'] for d in out['policy_drops']]})")
            if cap["expect_review"] and out["reviews"] == 0:
                issues.append("review-petal-set-but-0-reviews")
            if cap["review_off"] and out["reviews"] > 0:
                issues.append("review-OFF-but-review-produced")
            if cap["events_off"] and out["events"] > 0:
                issues.append("events-OFF-but-event-produced")
            cap_res["issues"] = issues
            flag = "ISSUES:" + ",".join(issues) if issues else "ok"
            print(f"      {ex['status']} | msg={out['messages']} evt={out['events']} rev={out['reviews']} "
                  f"drops={len(out['policy_drops'])} -> {flag}")
            tr["capabilities"].append(cap_res)

    # Summary
    dur = datetime.now() - started
    print(f"\n{'='*64}\n  PETAL ACTIVATION SUMMARY  ({dur})\n{'='*64}")
    total_issues = 0
    for tid, tr in results.items():
        if not tr["adopt"]:
            print(f"  [!!] {tid:<34} ADOPT FAILED: {tr.get('error')}")
            total_issues += 1
            continue
        caps = tr["capabilities"]
        cap_issues = sum(len(c.get("issues", [])) for c in caps) + sum(
            1 for c in caps if c.get("status") not in ("completed", None))
        total_issues += cap_issues
        icon = "OK" if cap_issues == 0 else "!!"
        print(f"  [{icon}] {tid:<34} caps={len(caps)} issues={cap_issues}")
        for c in caps:
            if c.get("issues") or c.get("status") not in ("completed",):
                print(f"        - {c['title']}: status={c.get('status')} issues={c.get('issues')} out={c.get('out')}")

    print(f"\n  templates: {len(results)} | total issues: {total_issues}")
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = RESULTS_DIR / f"petal_activation_{ts}.json"
    json.dump({"started": str(started), "duration_s": dur.total_seconds(), "results": results},
              open(out_file, "w"), indent=2)
    print(f"  results: {out_file}")
    sys.exit(1 if total_issues else 0)


if __name__ == "__main__":
    main()
