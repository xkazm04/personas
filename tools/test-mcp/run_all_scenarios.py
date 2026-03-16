"""
Full E2E test runner for all 20 PersonaMatrix build scenarios.
Runs each scenario, auto-answers questions, validates results, and produces a report.

Usage:
  uvx --with httpx python tools/test-mcp/run_all_scenarios.py
"""
import httpx
import json
import time
import sys

BASE = "http://127.0.0.1:17320"
c = httpx.Client(base_url=BASE, timeout=30)

# All 20 scenarios from matrix-build-test-scenarios.md
SCENARIOS = [
    # 1-5: Template-Similar
    {"id": 1, "name": "Email Intake Triage", "intent": "Monitor my Gmail for important emails and post summaries to a task list in Notion", "creds_hit": ["Gmail", "Notion"], "creds_missing": []},
    {"id": 2, "name": "Sprint Automation", "intent": "Automate our Linear sprint workflow — create tasks from requirements, track blockers, post daily standups", "creds_hit": ["Linear"], "creds_missing": ["Slack"]},
    {"id": 3, "name": "Expense Processing", "intent": "Process expense receipts from Gmail, extract amounts, and log them to Airtable for monthly reporting", "creds_hit": ["Gmail", "Airtable"], "creds_missing": []},
    {"id": 4, "name": "Research Report Generator", "intent": "Research trending topics in my industry weekly and compile findings into a Notion knowledge base", "creds_hit": ["Notion"], "creds_missing": []},
    {"id": 5, "name": "CRM Data Quality", "intent": "Audit our Attio CRM for duplicate contacts, missing fields, and stale deals — post findings to a report", "creds_hit": ["Attio"], "creds_missing": []},
    # 6-10: Credential-Rich
    {"id": 6, "name": "Meeting Lifecycle Manager", "intent": "Before each Google Calendar meeting, create an agenda in Notion. After the meeting, generate action items and track them in Asana", "creds_hit": ["Google Calendar", "Notion", "Asana"], "creds_missing": []},
    {"id": 7, "name": "Error Monitoring Dashboard", "intent": "Watch Sentry for new error spikes and critical issues, create tracking tickets in Linear, and log incidents in Airtable", "creds_hit": ["Sentry", "Linear", "Airtable"], "creds_missing": []},
    {"id": 8, "name": "Appointment Scheduler", "intent": "Sync my Cal.com bookings with Google Calendar and create preparation notes in Notion for each upcoming appointment", "creds_hit": ["Cal.com", "Google Calendar", "Notion"], "creds_missing": []},
    {"id": 9, "name": "AI Image Asset Creator", "intent": "Generate product images using Leonardo AI based on briefs in an Airtable board, store results back in Airtable with metadata", "creds_hit": ["Leonardo AI", "Airtable"], "creds_missing": []},
    {"id": 10, "name": "Uptime and Incident Logger", "intent": "Monitor Better Stack for incidents, log them to Supabase with timestamps, and create follow-up tasks in ClickUp", "creds_hit": ["Better Stack", "Supabase", "ClickUp"], "creds_missing": []},
    # 11-15: Missing Credentials
    {"id": 11, "name": "GitHub PR Reviewer", "intent": "Review pull requests on GitHub, post code review comments, and create follow-up tasks in Linear", "creds_hit": ["Linear"], "creds_missing": ["GitHub"]},
    {"id": 12, "name": "Slack Standup Bot", "intent": "Run daily standups in Slack — ask team for updates, compile responses, post summary", "creds_hit": [], "creds_missing": ["Slack"]},
    {"id": 13, "name": "E-commerce Order Monitor", "intent": "Monitor Shopify orders, update inventory in Airtable, and send shipping notifications via Twilio SMS", "creds_hit": ["Airtable"], "creds_missing": ["Shopify", "Twilio"]},
    {"id": 14, "name": "HubSpot Lead Scorer", "intent": "Score incoming leads in HubSpot CRM based on engagement data, prioritize high-value prospects, and alert the sales team", "creds_hit": [], "creds_missing": ["HubSpot", "Slack"]},
    {"id": 15, "name": "Jira Sprint Tracker", "intent": "Track Jira sprint progress, detect overdue issues, and post daily reports to a Telegram channel", "creds_hit": [], "creds_missing": ["Jira", "Telegram"]},
    # 16-20: Edge Cases
    {"id": 16, "name": "Vague Intent", "intent": "Help me be more productive", "creds_hit": [], "creds_missing": []},
    {"id": 17, "name": "Multi-Domain Complex", "intent": "Build me an agent that monitors Gmail for client invoices, extracts amounts to Airtable, creates follow-up tasks in Asana for overdue payments, and schedules reminder meetings in Google Calendar", "creds_hit": ["Gmail", "Airtable", "Asana", "Google Calendar"], "creds_missing": []},
    {"id": 18, "name": "Single-Service Simple", "intent": "Log all new Notion pages with a project tag to a daily summary", "creds_hit": ["Notion"], "creds_missing": []},
    {"id": 19, "name": "Non-English Intent", "intent": "Automatisiere meine E-Mail-Sortierung — wichtige Mails nach Notion, Termine in den Kalender", "creds_hit": ["Gmail", "Notion", "Google Calendar"], "creds_missing": []},
    {"id": 20, "name": "Contradictory Requirements", "intent": "Build a fully automated agent that requires manual approval for every single action", "creds_hit": [], "creds_missing": []},
]

MAX_BUILD_TIME = 180  # seconds max per scenario
POLL_INTERVAL = 5


def reset_state():
    """Delete all agents and reset build state."""
    try:
        state = c.get("/state").json()
        for p in state.get("personas", []):
            c.post("/delete-agent", json={"name_or_id": p["id"]})
        c.post("/eval", json={"js": 'import("@/stores/agentStore").then(m=>m.useAgentStore.getState().resetBuildSession())'})
        time.sleep(0.5)
    except Exception:
        pass


def run_scenario(scenario):
    """Run a single build scenario end-to-end. Returns result dict."""
    sid = scenario["id"]
    result = {
        "id": sid,
        "name": scenario["name"],
        "intent": scenario["intent"][:60],
        "status": "UNKNOWN",
        "phase": None,
        "cells_resolved": 0,
        "cells_total": 0,
        "cells_detail": {},
        "turns": 0,
        "questions_asked": 0,
        "questions_detail": [],
        "time_s": 0,
        "agent_name": None,
        "name_quality": "UNKNOWN",
        "activity_events": [],
        "errors": [],
    }

    try:
        # Reset
        reset_state()

        # Start creation
        c.post("/navigate", json={"section": "personas"})
        time.sleep(0.3)
        c.post("/start-create-agent", json={})
        time.sleep(0.5)
        wait_r = c.post("/wait", json={"selector": '[data-testid="agent-intent-input"]', "timeout_ms": 5000}).json()
        if not wait_r.get("success"):
            result["status"] = "FAIL"
            result["errors"].append("Intent input not found")
            return result

        c.post("/fill-field", json={"test_id": "agent-intent-input", "value": scenario["intent"]})
        c.post("/click-testid", json={"test_id": "agent-launch-btn"})

        start = time.time()
        last_activity = ""
        turn = 0

        # Monitor loop
        while time.time() - start < MAX_BUILD_TIME:
            time.sleep(POLL_INTERVAL)
            elapsed = time.time() - start

            try:
                state = c.get("/state").json()
            except Exception:
                continue

            phase = state.get("buildPhase", "")
            cells = state.get("buildCellStates", {})
            activity = state.get("buildActivity", "") or ""
            resolved = sum(1 for v in cells.values() if v in ("resolved", "updated"))
            highlighted = [k for k, v in cells.items() if v == "highlighted"]

            # Track activity changes
            if activity and activity != last_activity:
                result["activity_events"].append(f"[{elapsed:.0f}s] {activity}")
                last_activity = activity

            # Terminal states
            if phase == "failed":
                result["status"] = "FAIL"
                result["errors"].append(state.get("buildError", "Unknown error"))
                break

            if phase == "draft_ready":
                result["phase"] = phase
                result["cells_resolved"] = resolved
                result["cells_total"] = len(cells)
                result["cells_detail"] = cells
                result["turns"] = turn + 1
                result["time_s"] = elapsed

                # Get agent name
                personas = state.get("personas", [])
                if personas:
                    name = personas[-1]["name"]
                    result["agent_name"] = name
                    intent_start = scenario["intent"][:15].lower()
                    is_raw = name.lower().startswith(intent_start)
                    is_short = len(name.split()) <= 5
                    result["name_quality"] = "PASS" if (not is_raw and is_short) else "FAIL"

                result["status"] = "PASS"
                break

            # Handle questions
            if phase == "awaiting_input" and highlighted:
                for cell_key in highlighted:
                    result["questions_asked"] += 1
                    result["questions_detail"].append(cell_key)

                # Auto-answer first highlighted question
                try:
                    answer_r = c.post("/answer-question", json={"cell_key": highlighted[0], "option_index": 0}).json()
                    if not answer_r.get("success"):
                        # Try clicking Continue Build instead
                        c.post("/eval", json={"js": 'document.querySelectorAll("button").forEach(b=>{if(b.innerText.includes("Continue Build"))b.click()})'})
                except Exception:
                    pass
                turn += 1
                continue

            # No questions but awaiting_input — click Continue Build
            if phase == "awaiting_input" and not highlighted:
                try:
                    c.post("/eval", json={"js": 'document.querySelectorAll("button").forEach(b=>{if(b.innerText.includes("Continue Build"))b.click()})'})
                except Exception:
                    pass
                turn += 1

        else:
            result["status"] = "TIMEOUT"
            result["errors"].append(f"Exceeded {MAX_BUILD_TIME}s")
            result["time_s"] = MAX_BUILD_TIME

    except Exception as e:
        result["status"] = "ERROR"
        result["errors"].append(str(e))

    return result


def print_result(r):
    """Print a single scenario result."""
    status_icon = {"PASS": "+", "FAIL": "!", "TIMEOUT": "~", "ERROR": "X", "UNKNOWN": "?"}.get(r["status"], "?")
    cells = f"{r['cells_resolved']}/{r['cells_total']}" if r["cells_total"] else "?"
    name = r.get("agent_name", "?") or "?"
    print(f"  [{status_icon}] #{r['id']:2d} {r['name']:<28s} {r['status']:<7s} cells={cells:<5s} turns={r['turns']} time={r['time_s']:.0f}s name=\"{name}\"")
    if r["questions_detail"]:
        print(f"       questions: {r['questions_detail']}")
    if r["errors"]:
        print(f"       errors: {r['errors']}")


def main():
    # Health check
    try:
        h = c.get("/health").json()
        print(f"Server: {h.get('server')} v{h.get('version')}")
    except Exception:
        print("ERROR: Cannot connect to test server on port 17320")
        sys.exit(1)

    # Determine which scenarios to run
    if len(sys.argv) > 1:
        ids = [int(x) for x in sys.argv[1].split(",")]
        scenarios = [s for s in SCENARIOS if s["id"] in ids]
    else:
        scenarios = SCENARIOS

    print(f"\nRunning {len(scenarios)} scenarios...\n")

    results = []
    for scenario in scenarios:
        print(f"--- Scenario #{scenario['id']}: {scenario['name']} ---")
        r = run_scenario(scenario)
        print_result(r)
        results.append(r)
        print()

    # Summary
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    timeout = sum(1 for r in results if r["status"] == "TIMEOUT")
    errors = sum(1 for r in results if r["status"] == "ERROR")

    print("=" * 70)
    print(f"RESULTS: {passed} passed, {failed} failed, {timeout} timeout, {errors} error out of {len(results)}")
    print("=" * 70)

    # Timing
    times = [r["time_s"] for r in results if r["status"] == "PASS"]
    if times:
        print(f"Timing: avg={sum(times)/len(times):.0f}s min={min(times):.0f}s max={max(times):.0f}s total={sum(times):.0f}s")

    # Turn stats
    turns = [r["turns"] for r in results if r["status"] == "PASS"]
    if turns:
        print(f"Turns:  avg={sum(turns)/len(turns):.1f} min={min(turns)} max={max(turns)}")

    # Name quality
    name_pass = sum(1 for r in results if r.get("name_quality") == "PASS")
    name_fail = sum(1 for r in results if r.get("name_quality") == "FAIL")
    print(f"Names:  {name_pass} good, {name_fail} bad")

    # Questions
    all_q = sum(r["questions_asked"] for r in results)
    print(f"Questions total: {all_q}")

    # Failed scenarios detail
    fails = [r for r in results if r["status"] != "PASS"]
    if fails:
        print(f"\nFailed scenarios:")
        for r in fails:
            print(f"  #{r['id']} {r['name']}: {r['status']} - {r['errors']}")

    # Activity events coverage
    with_activity = sum(1 for r in results if r["activity_events"])
    print(f"\nActivity events: {with_activity}/{len(results)} scenarios had activity updates")

    # Final cleanup
    reset_state()

    sys.exit(0 if failed == 0 and errors == 0 else 1)


if __name__ == "__main__":
    main()
