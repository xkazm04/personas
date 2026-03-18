"""
Haiku 4.5 vs Sonnet benchmark — runs 5 scenarios in Japanese,
captures timing, dimension quality, and structural compliance.

Usage:
  PYTHONUNBUFFERED=1 uvx --with httpx python tools/test-mcp/run_haiku_benchmark.py
"""
import httpx
import json
import time
import sys

BASE = "http://127.0.0.1:17320"
c = httpx.Client(base_url=BASE, timeout=30)

SCENARIOS = [
    {"id": 1,  "name": "Email Triage",       "intent": "Gmailの重要なメールを監視して、Notionのタスクリストにサマリーを投稿して"},
    {"id": 11, "name": "PR Reviewer",         "intent": "GitHubのプルリクエストをレビューして、コードレビューコメントを投稿し、Linearにフォローアップタスクを作成して"},
    {"id": 16, "name": "Vague Intent",        "intent": "もっと生産的になれるよう手伝って"},
    {"id": 18, "name": "Simple (Notion)",     "intent": "プロジェクトタグが付いたすべての新しいNotionページを毎日のサマリーに記録して"},
    {"id": 20, "name": "Contradictory",       "intent": "すべてのアクションに手動承認が必要な完全自動化エージェントを作って"},
]

# Sonnet baseline from previous 70/70 regression (Japanese runs)
SONNET_BASELINE = {
    1:  {"time": 45, "cells": 8, "turns": 1, "name": "Email Task Manager"},
    11: {"time": 91, "cells": 8, "turns": 3, "name": "PR Review Assistant"},
    16: {"time": 60, "cells": 8, "turns": 3, "name": "Email Triage Manager"},
    18: {"time": 50, "cells": 8, "turns": 1, "name": "Project Page Tracker"},
    20: {"time": 81, "cells": 8, "turns": 3, "name": "Email Approval Manager"},
}


def reset():
    try:
        state = c.get("/state").json()
        for p in state.get("personas", []):
            c.post("/delete-agent", json={"name_or_id": p["id"]})
        c.post("/eval", json={"js": 'import("@/stores/agentStore").then(m=>m.useAgentStore.getState().resetBuildSession())'})
        time.sleep(0.5)
    except Exception:
        pass


def set_language(lang):
    c.post("/eval", json={"js": f'import("@/stores/i18nStore").then(m=>m.useI18nStore.getState().setLanguage("{lang}"))'})
    time.sleep(0.2)


def get_dimension_quality(state):
    """Analyze dimension data quality from cell states and data."""
    cells = state.get("buildCellStates", {})
    resolved = sum(1 for v in cells.values() if v in ("resolved", "updated"))

    # Try to get cell data via eval
    try:
        r = c.post("/eval", json={"js": """
            (async()=>{
                const s = (await import('@/stores/agentStore')).useAgentStore.getState();
                const data = s.buildCellData || {};
                const draft = s.buildDraft;
                const result = {};
                for (const [key, val] of Object.entries(data)) {
                    const items = val?.items || [];
                    const raw = val?.raw || {};
                    result[key] = {
                        item_count: items.length,
                        has_structured: !!raw.connectors || !!raw.triggers,
                        first_item: items[0] || null,
                    };
                }
                return JSON.stringify({
                    dimensions: result,
                    has_agent_ir: !!draft,
                    agent_ir_name: draft?.name || null,
                    agent_ir_has_prompt: !!(draft?.system_prompt || draft?.structured_prompt),
                    agent_ir_tool_count: draft?.tools?.length || 0,
                    agent_ir_trigger_count: draft?.triggers?.length || 0,
                });
            })()
        """}).json()
        # The eval result may be in the success field
        return r
    except Exception:
        return {}


def run_scenario(scenario):
    sid = scenario["id"]
    r = {
        "id": sid, "name": scenario["name"],
        "status": "UNKNOWN", "cells": 0, "turns": 0, "time_s": 0,
        "agent_name": None, "quality": {},
    }

    try:
        reset()
        set_language("ja")

        c.post("/navigate", json={"section": "personas"})
        time.sleep(0.3)
        c.post("/start-create-agent", json={})
        time.sleep(0.5)
        c.post("/wait", json={"selector": '[data-testid="agent-intent-input"]', "timeout_ms": 5000})
        c.post("/fill-field", json={"test_id": "agent-intent-input", "value": scenario["intent"]})
        c.post("/click-testid", json={"test_id": "agent-launch-btn"})

        start = time.time()
        turn = 0

        while time.time() - start < 300:
            time.sleep(5)
            try:
                state = c.get("/state").json()
            except:
                continue

            phase = state.get("buildPhase", "")
            cells = state.get("buildCellStates", {})
            highlighted = [k for k, v in cells.items() if v == "highlighted"]

            if phase == "failed":
                r["status"] = "FAIL"
                break
            if phase == "draft_ready":
                r["cells"] = sum(1 for v in cells.values() if v in ("resolved", "updated"))
                r["turns"] = turn + 1
                r["time_s"] = time.time() - start
                personas = state.get("personas", [])
                if personas:
                    r["agent_name"] = personas[-1]["name"]
                r["status"] = "PASS"
                r["quality"] = get_dimension_quality(state)
                break
            if phase == "awaiting_input" and highlighted:
                c.post("/answer-question", json={"cell_key": highlighted[0], "option_index": 0})
                turn += 1
                continue
            if phase == "awaiting_input" and not highlighted:
                try:
                    c.post("/click-testid", json={"test_id": "continue-build-btn"})
                except:
                    c.post("/eval", json={"js": 'document.querySelectorAll("button").forEach(b=>{if(b.innerText.includes("Continue Build"))b.click()})'})
                turn += 1
        else:
            r["status"] = "TIMEOUT"
            r["time_s"] = 300

    except Exception as e:
        r["status"] = "ERROR"

    return r


def main():
    try:
        h = c.get("/health").json()
        print(f"Server: {h.get('server')} v{h.get('version')}")
    except Exception:
        print("ERROR: Cannot connect to test server")
        sys.exit(1)

    print(f"\n{'='*70}")
    print(f"  HAIKU 4.5 BENCHMARK — Japanese intents, 5 scenarios")
    print(f"{'='*70}\n")

    results = []
    for scenario in SCENARIOS:
        sid = scenario["id"]
        print(f"--- S{sid}: {scenario['name']} ---")
        r = run_scenario(scenario)
        results.append(r)

        baseline = SONNET_BASELINE.get(sid, {})
        icon = {"PASS": "+", "FAIL": "!", "TIMEOUT": "~", "ERROR": "X"}.get(r["status"], "?")
        time_delta = ""
        if r["status"] == "PASS" and baseline.get("time"):
            diff = r["time_s"] - baseline["time"]
            pct = (diff / baseline["time"]) * 100
            time_delta = f" ({pct:+.0f}% vs Sonnet)"

        print(f"  [{icon}] {r['status']} cells={r['cells']}/8 turns={r['turns']} time={r['time_s']:.0f}s{time_delta} name=\"{r['agent_name'] or '?'}\"")
        print()

    set_language("en")

    # Comparison table
    print(f"\n{'='*70}")
    print(f"  HAIKU 4.5 vs SONNET 4 COMPARISON")
    print(f"{'='*70}")
    print(f"{'Scenario':<20s} {'Sonnet time':>11s} {'Haiku time':>10s} {'Delta':>8s} {'Sonnet cells':>12s} {'Haiku cells':>11s} {'Turns S':>7s} {'Turns H':>7s}")
    print(f"{'-'*20} {'-'*11} {'-'*10} {'-'*8} {'-'*12} {'-'*11} {'-'*7} {'-'*7}")

    haiku_times = []
    sonnet_times = []

    for r in results:
        sid = r["id"]
        baseline = SONNET_BASELINE.get(sid, {})
        s_time = baseline.get("time", "?")
        h_time = f"{r['time_s']:.0f}s" if r["status"] == "PASS" else r["status"]
        delta = ""
        if r["status"] == "PASS" and isinstance(s_time, (int, float)):
            diff = r["time_s"] - s_time
            delta = f"{diff:+.0f}s"
            haiku_times.append(r["time_s"])
            sonnet_times.append(s_time)

        s_cells = f"{baseline.get('cells', '?')}/8"
        h_cells = f"{r['cells']}/8" if r["status"] == "PASS" else "?"
        s_turns = str(baseline.get("turns", "?"))
        h_turns = str(r["turns"]) if r["status"] == "PASS" else "?"

        print(f"{r['name']:<20s} {str(s_time)+'s':>11s} {h_time:>10s} {delta:>8s} {s_cells:>12s} {h_cells:>11s} {s_turns:>7s} {h_turns:>7s}")

    if haiku_times and sonnet_times:
        print(f"\n  Sonnet avg: {sum(sonnet_times)/len(sonnet_times):.0f}s | Haiku avg: {sum(haiku_times)/len(haiku_times):.0f}s | Speedup: {(1 - sum(haiku_times)/sum(sonnet_times))*100:.0f}%")

    passed = sum(1 for r in results if r["status"] == "PASS")
    print(f"  Pass rate: {passed}/{len(results)}")

    reset()
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
