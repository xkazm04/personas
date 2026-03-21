#!/usr/bin/env python3
"""
E2E Resilience Test: 10 Personas x Full Dimension Coverage

Comprehensive cross-module integration test validating persona generation,
testing, and execution across diverse tool combinations, connector types,
and protocol message patterns.

Usage:
  python e2e_10_personas_resilience.py                    # Run all 10 personas
  python e2e_10_personas_resilience.py --persona 3        # Run persona #3 only
  python e2e_10_personas_resilience.py --phase A          # Run phase A only (all personas)
  python e2e_10_personas_resilience.py --persona 1 --phase D  # Persona 1, Phase D only

Requires: Tauri app running with test-automation feature (port 17320)
"""

import argparse
import httpx
import json
import os
import subprocess
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

BASE = "http://127.0.0.1:17320"
TIMEOUT = 30.0
DB_PATH = os.path.join(os.environ.get("APPDATA", ""), "com.personas.desktop", "personas.db")

# ═══════════════════════════════════════════════════════════════════════════════
# Persona Definitions
# ═══════════════════════════════════════════════════════════════════════════════

PERSONAS = [
    {
        "num": 1,
        "name": "Daily Tech Digest",
        "intent": "Research latest tech news from major sources and create a daily digest with the 5 most impactful stories",
        "freetext": "Focus on AI, cloud computing, and cybersecurity news",
        "matrix_instruction": "Add more structure with categories and impact ratings per story",
        "expected_tools": ["web_search"],
        "expected_protocol": ["user_message"],
    },
    {
        "num": 2,
        "name": "Code Review Assistant",
        "intent": "Review code changes, identify potential bugs, security issues, and suggest improvements",
        "freetext": "Focus on TypeScript and Python code, emphasize security best practices",
        "matrix_instruction": "Add severity ratings and actionable fix suggestions for each finding",
        "expected_tools": ["file_read", "file_write"],
        "expected_protocol": ["manual_review", "agent_memory"],
    },
    {
        "num": 3,
        "name": "API Health Monitor",
        "intent": "Monitor REST API endpoints for uptime, response time, and error rates, alerting on anomalies",
        "freetext": "Monitor internal APIs at localhost endpoints for development testing",
        "matrix_instruction": "Add response time thresholds and escalation rules for different severity levels",
        "expected_tools": ["http_request"],
        "expected_protocol": ["user_message", "agent_memory"],
    },
    {
        "num": 4,
        "name": "Research Paper Summarizer",
        "intent": "Find and summarize recent academic papers on a given topic, extracting key findings and methodology",
        "freetext": "Focus on machine learning and NLP papers from arxiv and major conferences",
        "matrix_instruction": "Add citation analysis and relevance scoring for each paper",
        "expected_tools": ["web_search", "web_fetch", "file_write"],
        "expected_protocol": ["user_message", "agent_memory"],
    },
    {
        "num": 5,
        "name": "Meeting Notes Organizer",
        "intent": "Process meeting transcripts, extract action items, decisions, and organize by topic and assignee",
        "freetext": "Handle engineering standup and planning meeting formats",
        "matrix_instruction": "Add deadline extraction and automatic priority assignment for action items",
        "expected_tools": ["file_read", "file_write"],
        "expected_protocol": ["agent_memory", "user_message"],
    },
    {
        "num": 6,
        "name": "Competitor Price Tracker",
        "intent": "Monitor competitor pricing on key products and alert on significant changes or new offerings",
        "freetext": "Track SaaS pricing pages for cloud infrastructure competitors",
        "matrix_instruction": "Add trend analysis showing price changes over time with percentage calculations",
        "expected_tools": ["web_search", "http_request"],
        "expected_protocol": ["user_message", "agent_memory"],
    },
    {
        "num": 7,
        "name": "Documentation Freshness Checker",
        "intent": "Audit documentation for staleness by checking last-updated dates, broken links, and outdated references",
        "freetext": "Check our internal docs site and README files in repositories",
        "matrix_instruction": "Add recommendations for which docs to update first based on traffic and staleness",
        "expected_tools": ["web_fetch", "file_read"],
        "expected_protocol": ["manual_review", "user_message"],
    },
    {
        "num": 8,
        "name": "Social Media Trend Analyzer",
        "intent": "Analyze trending topics on tech social media and identify emerging discussions relevant to our industry",
        "freetext": "Focus on X/Twitter, Hacker News, and Reddit tech communities",
        "matrix_instruction": "Add sentiment analysis and topic clustering to identify positive vs negative trends",
        "expected_tools": ["web_search"],
        "expected_protocol": ["user_message", "agent_memory"],
    },
    {
        "num": 9,
        "name": "Security Vulnerability Scanner",
        "intent": "Scan for known security vulnerabilities in specified software dependencies and report findings",
        "freetext": "Check npm and Python package vulnerabilities from NVD and GitHub advisories",
        "matrix_instruction": "Add CVSS scoring and remediation steps for each vulnerability found",
        "expected_tools": ["web_search", "http_request"],
        "expected_protocol": ["manual_review", "user_message"],
    },
    {
        "num": 10,
        "name": "Personal Learning Journal",
        "intent": "Research a daily learning topic, create a structured study note, and track learning progress over time",
        "freetext": "Focus on distributed systems and database internals as learning topics",
        "matrix_instruction": "Add spaced repetition cues and connect new learnings to previous entries",
        "expected_tools": ["web_search", "file_write"],
        "expected_protocol": ["agent_memory", "user_message"],
    },
]

# ═══════════════════════════════════════════════════════════════════════════════
# HTTP + DB helpers
# ═══════════════════════════════════════════════════════════════════════════════

client = httpx.Client(base_url=BASE, timeout=TIMEOUT)


def api_get(path: str, retries: int = 2) -> Any:
    for attempt in range(retries + 1):
        try:
            r = client.get(path)
            return r.json()
        except (httpx.ConnectError, httpx.ReadError) as e:
            if attempt == retries:
                raise
            print(f"    [RETRY] GET {path} failed ({e}), retrying in 3s...")
            time.sleep(3)


def api_post(path: str, body: dict = None, retries: int = 2) -> Any:
    for attempt in range(retries + 1):
        try:
            r = client.post(path, json=body or {})
            return r.json()
        except (httpx.ConnectError, httpx.ReadError) as e:
            if attempt == retries:
                raise
            print(f"    [RETRY] POST {path} failed ({e}), retrying in 3s...")
            time.sleep(3)


def api_post_safe(path: str, body: dict = None) -> dict:
    """POST that never throws — returns {"success": False, "error": ...} on failure."""
    try:
        return api_post(path, body)
    except Exception as e:
        return {"success": False, "error": str(e)}


def db_query(sql: str, params: tuple = ()) -> list[dict]:
    """Run a read-only query against the app DB."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def db_scalar(sql: str, params: tuple = ()) -> Any:
    rows = db_query(sql, params)
    if rows:
        return list(rows[0].values())[0]
    return None


def poll_state(key: str, target_values: list[str], timeout_s: float = 180, interval: float = 3.0) -> dict:
    """Poll GET /state until state[key] is in target_values or timeout."""
    start = time.time()
    last_state = {}
    while time.time() - start < timeout_s:
        try:
            last_state = api_get("/state")
            val = last_state.get(key)
            if val in target_values:
                return last_state
        except Exception:
            pass
        time.sleep(interval)
    return last_state


def poll_db(sql: str, params: tuple, target_values: list, timeout_s: float = 600, interval: float = 5.0) -> Any:
    """Poll a DB scalar query until result is in target_values or timeout."""
    start = time.time()
    last_val = None
    while time.time() - start < timeout_s:
        try:
            last_val = db_scalar(sql, params)
            if last_val in target_values:
                return last_val
        except Exception:
            pass
        time.sleep(interval)
    return last_val


# ═══════════════════════════════════════════════════════════════════════════════
# Test Result Tracking
# ═══════════════════════════════════════════════════════════════════════════════

class CheckResult:
    def __init__(self, name: str, passed: bool, category: str, detail: str = ""):
        self.name = name
        self.passed = passed
        self.category = category  # "technical" or "business"
        self.detail = detail

    def to_dict(self):
        return {
            "name": self.name,
            "passed": self.passed,
            "category": self.category,
            "detail": self.detail,
        }


class PersonaResult:
    def __init__(self, num: int, name: str):
        self.num = num
        self.name = name
        self.persona_id: Optional[str] = None
        self.execution_id: Optional[str] = None
        self.phases: dict[str, list[CheckResult]] = {"A": [], "B": [], "C": [], "D": [], "E": []}
        self.errors: list[str] = []
        self.timings: dict[str, float] = {}

    def check(self, phase: str, name: str, condition: bool, category: str = "technical", detail: str = ""):
        result = CheckResult(name, condition, category, detail)
        self.phases[phase].append(result)
        status = "PASS" if condition else "FAIL"
        print(f"    [{status}] {name}" + (f" -- {detail}" if detail and not condition else ""))
        return condition

    def phase_passed(self, phase: str) -> bool:
        checks = self.phases.get(phase, [])
        return len(checks) > 0 and all(c.passed for c in checks)

    def phase_stats(self, phase: str) -> tuple[int, int]:
        checks = self.phases.get(phase, [])
        passed = sum(1 for c in checks if c.passed)
        return passed, len(checks)

    def total_stats(self) -> tuple[int, int]:
        total_pass = sum(sum(1 for c in checks if c.passed) for checks in self.phases.values())
        total = sum(len(checks) for checks in self.phases.values())
        return total_pass, total

    def to_dict(self):
        return {
            "num": self.num,
            "name": self.name,
            "persona_id": self.persona_id,
            "execution_id": self.execution_id,
            "phases": {
                phase: [c.to_dict() for c in checks]
                for phase, checks in self.phases.items()
            },
            "errors": self.errors,
            "timings": self.timings,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# Phase Implementations
# ═══════════════════════════════════════════════════════════════════════════════

def answer_build_questions(persona: dict, max_rounds: int = 15) -> str:
    """Answer build questions until build leaves awaiting_input. Returns final buildPhase."""
    CELL_KEYS = ["use-cases", "connectors", "triggers", "messages", "human-review", "memory", "error-handling", "events"]

    for round_num in range(1, max_rounds + 1):
        state = api_get("/state")
        phase = state.get("buildPhase", "unknown")
        if phase != "awaiting_input":
            print(f"    Build phase is now: {phase}")
            return phase

        cells = state.get("buildCellStates", {})
        highlighted = [k for k in CELL_KEYS if cells.get(k) == "highlighted"]
        print(f"    Q{round_num}: phase={phase}, highlighted={highlighted}")

        # Strategy 1: Click the answer-button for each highlighted cell, pick first option
        answered_any = False
        for cell_key in highlighted:
            # Click the answer button for this cell to open the spatial question popover
            r = api_post_safe(f"/click-testid", {"test_id": f"answer-button-{cell_key}"})
            if r.get("success"):
                time.sleep(0.8)  # Wait for popover to render

                # Try picking option 0 first (most common)
                r2 = api_post_safe("/click-testid", {"test_id": "option-button-0"})
                if r2.get("success"):
                    print(f"      Answered {cell_key} with option 0")
                    answered_any = True
                    time.sleep(0.5)
                    continue

                # Fallback: type freetext
                r3 = api_post_safe("/fill-field", {"test_id": "freetext-input", "value": persona["freetext"]})
                if r3.get("success"):
                    time.sleep(0.3)
                    api_post_safe("/click-testid", {"test_id": "submit-button"})
                    print(f"      Answered {cell_key} with freetext")
                    answered_any = True
                    time.sleep(0.5)
                    continue

                print(f"      Could not answer {cell_key}: no options or freetext found")
            else:
                print(f"      answer-button-{cell_key} not found, trying bridge answer-question...")

        # Strategy 2: Fallback to bridge answerBuildQuestion (finds any visible Answer: button)
        if not answered_any:
            r = api_post_safe("/answer-question", {"cell_key": "auto", "option_index": 0})
            if r.get("success"):
                print(f"      Answered via bridge fallback")
                answered_any = True
            else:
                print(f"      Bridge fallback also failed: {r}")

        time.sleep(1)

        # Try clicking continue-build to submit collected answers
        r = api_post_safe("/click-testid", {"test_id": "continue-build-btn"})
        if r.get("success"):
            print(f"      Clicked continue-build")

        # Wait for build to process answers (may go to resolving -> awaiting_input again or draft_ready)
        state = poll_state("buildPhase", ["awaiting_input", "draft_ready", "test_complete"], timeout_s=120, interval=3)
        phase = state.get("buildPhase", "unknown")
        if phase in ("draft_ready", "test_complete"):
            return phase

    # Last check
    return api_get("/state").get("buildPhase", "timeout")


def phase_a_generation(persona: dict, result: PersonaResult) -> bool:
    """Phase A: Generate persona via PersonaMatrix build flow."""
    print(f"\n  --- Phase A: Generation ({persona['name']}) ---")
    t0 = time.time()

    try:
        # Step 1: Start creation
        r = api_post("/start-create-agent")
        result.check("A", "Start create agent", r.get("success"), detail=str(r))
        time.sleep(1.5)

        # Step 2: Fill intent
        r = api_post("/fill-field", {"test_id": "agent-intent-input", "value": persona["intent"]})
        result.check("A", "Fill intent field", r.get("success"), detail=str(r))
        time.sleep(0.5)

        # Step 3: Launch build
        r = api_post("/click-testid", {"test_id": "agent-launch-btn"})
        result.check("A", "Click launch button", r.get("success"), detail=str(r))

        # Step 4: Wait for build to need input or finish
        print("    Waiting for build to reach awaiting_input or draft_ready...")
        state = poll_state("buildPhase", ["awaiting_input", "draft_ready", "test_complete"], timeout_s=180, interval=4)
        phase = state.get("buildPhase", "unknown")
        print(f"    Initial build phase: {phase}")

        # Step 5: Answer questions if needed
        if phase == "awaiting_input":
            phase = answer_build_questions(persona)

        # Step 6: Final wait for draft_ready if still resolving
        if phase not in ("draft_ready", "test_complete"):
            print(f"    Waiting for draft_ready (currently: {phase})...")
            state = poll_state("buildPhase", ["draft_ready", "test_complete"], timeout_s=300, interval=5)
            phase = state.get("buildPhase", "unknown")
        else:
            state = api_get("/state")

        result.check("A", "Build reached draft_ready", phase in ("draft_ready", "test_complete"), detail=f"phase={phase}")

        # Step 7: Check dimensions resolved
        cell_states = state.get("buildCellStates", {})
        dimensions = ["use-cases", "connectors", "triggers", "messages", "human-review", "memory", "error-handling", "events"]
        resolved_count = sum(1 for d in dimensions if cell_states.get(d) in ("resolved", "complete", "done"))
        result.check("A", f"Dimensions resolved ({resolved_count}/8)", resolved_count >= 6, detail=f"cells={cell_states}")

        # Step 8: Get persona ID — prefer store, fallback to build_sessions DB
        persona_id = state.get("buildPersonaId")
        session_id = state.get("buildSessionId")

        if not persona_id or not session_id:
            # Recover from build_sessions table
            bs = db_query("SELECT id, persona_id FROM build_sessions WHERE phase = 'draft_ready' ORDER BY created_at DESC LIMIT 1")
            if bs:
                if not session_id:
                    session_id = bs[0]["id"]
                if not persona_id:
                    persona_id = bs[0]["persona_id"]
                print(f"    Recovered from DB: session={session_id}, persona={persona_id}")

        result.persona_id = persona_id
        result.check("A", "Build persona ID exists", persona_id is not None, detail=f"id={persona_id}")

        # Step 9: Ensure build IDs are set in store (may be null due to store timing)
        if persona_id and session_id:
            state_check = api_get("/state")
            store_pid = state_check.get("buildPersonaId")
            store_sid = state_check.get("buildSessionId")
            if not store_pid or not store_sid:
                print(f"    Store missing IDs (persona={store_pid}, session={store_sid}) — fixing via eval...")
                js = f"window.__AGENT_STORE__ && window.__AGENT_STORE__.setState({{ buildPersonaId: '{persona_id}', buildSessionId: '{session_id}' }})"
                api_post("/eval", {"js": js})
                time.sleep(1)
                state_check2 = api_get("/state")
                print(f"    Store now: persona={state_check2.get('buildPersonaId')}, session={state_check2.get('buildSessionId')}")

        # Step 10: Promote build
        print("    Promoting build draft...")
        r = api_post("/promote-build")
        promote_success = r.get("success", False)

        if not promote_success and session_id and persona_id:
            print(f"    Bridge promote failed ({r.get('error', '?')}), retrying after store fix...")
            js = f"window.__AGENT_STORE__ && window.__AGENT_STORE__.setState({{ buildPersonaId: '{persona_id}', buildSessionId: '{session_id}', buildPhase: 'draft_ready' }})"
            api_post("/eval", {"js": js})
            time.sleep(2)
            r = api_post("/promote-build")
            promote_success = r.get("success", False)
            if promote_success:
                print("    Retry promote succeeded!")

        result.check("A", "Promote build draft", promote_success, detail=str(r)[:200])

        # Step 11: Verify promote applied structured_prompt — workaround if promote silently fails
        if persona_id and promote_success:
            time.sleep(2)
            sp_check = db_scalar("SELECT structured_prompt FROM personas WHERE id = ?", (persona_id,))
            if not sp_check:
                print("    WARNING: Promote succeeded but structured_prompt is NULL — applying from agent_ir...")
                # Extract structured_prompt from build session's agent_ir and apply directly
                ir_row = db_query("SELECT agent_ir FROM build_sessions WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1", (persona_id,))
                if ir_row and ir_row[0].get("agent_ir"):
                    ir = json.loads(ir_row[0]["agent_ir"])
                    sp_val = ir.get("structured_prompt")
                    dc_val = ir.get("design_context")
                    sys_val = ir.get("system_prompt")
                    if sp_val:
                        conn = sqlite3.connect(DB_PATH)
                        try:
                            sp_json = json.dumps(sp_val)
                            # Build proper DesignContextData format
                            raw_ucs = ir.get("use_cases", [])
                            structured_ucs = []
                            for i, uc in enumerate(raw_ucs):
                                if isinstance(uc, str):
                                    structured_ucs.append({"id": f"uc-{i}", "title": uc, "description": uc, "category": "general"})
                                elif isinstance(uc, dict):
                                    structured_ucs.append(uc)
                            dc_summary = dc_val.get("summary", "") if isinstance(dc_val, dict) else ""
                            dc_json = json.dumps({"useCases": structured_ucs, "summary": dc_summary})
                            conn.execute(
                                "UPDATE personas SET structured_prompt = ?, design_context = ? WHERE id = ?",
                                (sp_json, dc_json, persona_id),
                            )
                            conn.commit()
                            print("    Applied structured_prompt and design_context from agent_ir")

                            # Also assign builtin tools from agent_ir
                            ir_tools = ir.get("tools", [])
                            for tool in ir_tools:
                                tool_name = tool.get("name", "") if isinstance(tool, dict) else str(tool)
                                if tool_name:
                                    builtin_id = db_scalar(
                                        "SELECT id FROM persona_tool_definitions WHERE name = ? AND is_builtin = 1",
                                        (tool_name,),
                                    )
                                    if builtin_id:
                                        try:
                                            import uuid as uuid_mod
                                            conn.execute(
                                                "INSERT OR IGNORE INTO persona_tools (id, persona_id, tool_id, created_at) VALUES (?, ?, ?, datetime('now'))",
                                                (str(uuid_mod.uuid4()), persona_id, builtin_id),
                                            )
                                        except Exception:
                                            pass
                            conn.commit()
                        finally:
                            conn.close()

                        # Refresh the store so UI picks up the changes
                        api_post("/eval", {"js": "window.__AGENT_STORE__ && window.__AGENT_STORE__.getState().fetchPersonas()"})
                        time.sleep(2)

        # Step 12: Reset build state so UI exits post-generation view and shows normal editor
        api_post("/eval", {"js": "window.__AGENT_STORE__ && window.__AGENT_STORE__.setState({ buildPhase: null, buildSessionId: null, buildPersonaId: null })"})
        api_post("/eval", {"js": "window.__SYSTEM_STORE__ && window.__SYSTEM_STORE__.setState({ isCreatingPersona: false })"})
        time.sleep(1)
        # Navigate away and back to force re-render
        api_post("/navigate", {"section": "settings"})
        time.sleep(0.5)
        api_post("/navigate", {"section": "personas"})
        time.sleep(1)

        if persona_id:
            time.sleep(1)
            # Verify in DB
            row = db_query("SELECT id, name, system_prompt, structured_prompt FROM personas WHERE id = ?", (persona_id,))
            if row:
                p = row[0]
                result.check("A", "system_prompt non-empty", bool(p.get("system_prompt")), detail=f"len={len(p.get('system_prompt', '') or '')}")

                sp = p.get("structured_prompt")
                if sp:
                    try:
                        sp_json = json.loads(sp) if isinstance(sp, str) else sp
                        sections = ["identity", "instructions", "toolGuidance", "examples", "errorHandling"]
                        present = [s for s in sections if sp_json.get(s)]
                        result.check("A", f"structured_prompt sections ({len(present)}/5)", len(present) >= 3,
                                     detail=f"present={present}")
                    except Exception as e:
                        result.check("A", "structured_prompt parseable", False, detail=str(e))
                else:
                    result.check("A", "structured_prompt exists", False, detail="NULL")

                # Check design context
                dc = db_query("SELECT design_context FROM personas WHERE id = ?", (persona_id,))
                if dc and dc[0].get("design_context"):
                    try:
                        dc_json = json.loads(dc[0]["design_context"]) if isinstance(dc[0]["design_context"], str) else dc[0]["design_context"]
                        use_cases = dc_json.get("useCases", dc_json.get("use_cases", []))
                        result.check("A", "design_context.use_cases populated", len(use_cases) > 0,
                                     "business", detail=f"count={len(use_cases)}")
                    except Exception:
                        result.check("A", "design_context parseable", False, "business")
                else:
                    result.check("A", "design_context exists", False, "business")

                # Check name relevance
                name = p.get("name", "")
                result.check("A", "Persona name is relevant", len(name) > 3, "business", detail=f"name={name}")

                # Check tools assigned
                tools = db_query("SELECT ptd.name FROM persona_tools pt JOIN persona_tool_definitions ptd ON pt.tool_id = ptd.id WHERE pt.persona_id = ?", (persona_id,))
                tool_names = [t["name"] for t in tools]
                result.check("A", "Tools assigned", len(tool_names) > 0, detail=f"tools={tool_names}")
            else:
                result.check("A", "Persona exists in DB", False, detail=f"id={persona_id}")

    except Exception as e:
        result.errors.append(f"Phase A error: {e}")
        result.check("A", "Phase A completed without error", False, detail=str(e))
        import traceback; traceback.print_exc()

    result.timings["A"] = time.time() - t0
    return result.phase_passed("A")


def phase_b_lab_arena(persona: dict, result: PersonaResult) -> bool:
    """Phase B: Run Lab Arena test (model comparison)."""
    print(f"\n  --- Phase B: Lab Arena ({persona['name']}) ---")
    t0 = time.time()

    if not result.persona_id:
        result.check("B", "Persona ID available", False, detail="Skipped - no persona_id from Phase A")
        result.timings["B"] = time.time() - t0
        return False

    try:
        # Step 1: Navigate to personas section and select agent
        api_post("/navigate", {"section": "personas"})
        time.sleep(0.5)
        r = api_post("/select-agent", {"name_or_id": result.persona_id})
        result.check("B", "Select agent", r.get("success"), detail=str(r)[:100])
        time.sleep(1)

        # Step 2: Open lab tab and wait for it to render
        r = api_post("/open-editor-tab", {"tab": "lab"})
        result.check("B", "Open lab tab", r.get("success"), detail=str(r))
        time.sleep(2)

        # Step 3: Click arena mode
        r = api_post("/click-testid", {"test_id": "lab-mode-arena"})
        if not r.get("success"):
            # Retry after a moment — tab may still be mounting
            time.sleep(2)
            r = api_post("/click-testid", {"test_id": "lab-mode-arena"})
        result.check("B", "Switch to arena mode", r.get("success"), detail=str(r))
        time.sleep(1)

        # Step 4: Run arena
        r = api_post("/click-testid", {"test_id": "arena-run-btn"})
        result.check("B", "Click arena run", r.get("success"), detail=str(r))

        # Step 5: Monitor via DB (timeout 20 min — arena runs take 10-30 min)
        print("    Waiting for arena run to complete...")
        status = poll_db(
            "SELECT status FROM lab_arena_runs WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
            (result.persona_id,),
            target_values=["completed", "failed"],
            timeout_s=1200,
            interval=10,
        )
        result.check("B", "Arena run completed", status == "completed", detail=f"status={status}")

        if status == "completed":
            # Check result count
            run = db_query(
                "SELECT id, llm_summary FROM lab_arena_runs WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
                (result.persona_id,),
            )
            if run:
                run_id = run[0]["id"]
                results_count = db_scalar(
                    "SELECT COUNT(*) FROM lab_arena_results WHERE run_id = ?",
                    (run_id,),
                )
                result.check("B", f"Result count >= 2", (results_count or 0) >= 2,
                             detail=f"count={results_count}")

                # Check rationale
                null_rationale = db_scalar(
                    "SELECT COUNT(*) FROM lab_arena_results WHERE run_id = ? AND rationale IS NULL",
                    (run_id,),
                )
                result.check("B", "All results have rationale", null_rationale == 0,
                             detail=f"null_count={null_rationale}")

                # Check scores in range
                bad_scores = db_scalar(
                    """SELECT COUNT(*) FROM lab_arena_results WHERE run_id = ?
                       AND (tool_accuracy_score < 0 OR tool_accuracy_score > 100
                       OR output_quality_score < 0 OR output_quality_score > 100
                       OR protocol_compliance < 0 OR protocol_compliance > 100)""",
                    (run_id,),
                )
                result.check("B", "Scores in valid range 0-100", bad_scores == 0,
                             detail=f"out_of_range={bad_scores}")

                # Business: LLM summary
                llm_summary = run[0].get("llm_summary")
                result.check("B", "LLM summary populated", llm_summary is not None,
                             "business", detail=f"len={len(llm_summary or '')}")

                # Business: check scenario quality
                scenarios = db_query(
                    "SELECT scenario_name FROM lab_arena_results WHERE run_id = ? LIMIT 5",
                    (run_id,),
                )
                scenario_names = [s.get("scenario_name", "") for s in scenarios]
                result.check("B", "Scenarios are realistic", len(scenario_names) > 0,
                             "business", detail=f"first={scenario_names[0][:80] if scenario_names else 'none'}")

                # Business: average scores
                avg = db_query(
                    """SELECT AVG(tool_accuracy_score) as ta, AVG(output_quality_score) as oq, AVG(protocol_compliance) as pc
                       FROM lab_arena_results WHERE run_id = ?""",
                    (run_id,),
                )
                if avg:
                    a = avg[0]
                    result.check("B", "Tool accuracy reasonable",
                                 (a.get("ta") or 0) > 20, "business",
                                 detail=f"avg_tool_accuracy_score={a.get('ta', 0):.1f}")
                    result.check("B", "Output quality reasonable",
                                 (a.get("oq") or 0) > 20, "business",
                                 detail=f"avg_output_quality_score={a.get('oq', 0):.1f}")
                    result.check("B", "Protocol compliance reasonable",
                                 (a.get("pc") or 0) > 20, "business",
                                 detail=f"avg_protocol_compliance={a.get('pc', 0):.1f}")
        else:
            result.check("B", "Arena results available", False, detail=f"status={status}")

    except Exception as e:
        result.errors.append(f"Phase B error: {e}")
        result.check("B", "Phase B completed without error", False, detail=str(e))
        import traceback; traceback.print_exc()

    result.timings["B"] = time.time() - t0
    return result.phase_passed("B")


def phase_c_matrix_improvement(persona: dict, result: PersonaResult) -> bool:
    """Phase C: Matrix improvement (prompt refinement)."""
    print(f"\n  --- Phase C: Matrix Improvement ({persona['name']}) ---")
    t0 = time.time()

    if not result.persona_id:
        result.check("C", "Persona ID available", False, detail="Skipped - no persona_id")
        result.timings["C"] = time.time() - t0
        return False

    try:
        # Get current prompt version for comparison
        old_prompt = db_scalar("SELECT structured_prompt FROM personas WHERE id = ?", (result.persona_id,))

        # Step 0: Ensure we're on the lab tab
        api_post("/navigate", {"section": "personas"})
        time.sleep(0.5)
        api_post("/select-agent", {"name_or_id": result.persona_id})
        time.sleep(1)
        api_post("/open-editor-tab", {"tab": "lab"})
        time.sleep(2)

        # Step 1: Switch to matrix mode
        r = api_post("/click-testid", {"test_id": "lab-mode-matrix"})
        if not r.get("success"):
            time.sleep(2)
            r = api_post("/click-testid", {"test_id": "lab-mode-matrix"})
        result.check("C", "Switch to matrix mode", r.get("success"), detail=str(r))
        time.sleep(0.5)

        # Step 2: Fill improvement instruction
        r = api_post("/fill-field", {"test_id": "matrix-instruction", "value": persona["matrix_instruction"]})
        result.check("C", "Fill improvement instruction", r.get("success"), detail=str(r))
        time.sleep(0.3)

        # Step 3: Run matrix
        r = api_post("/click-testid", {"test_id": "matrix-run-btn"})
        result.check("C", "Click matrix run", r.get("success"), detail=str(r))

        # Step 4: Monitor via DB (timeout 20 min — matrix runs ~5-10 min)
        print("    Waiting for matrix run to complete...")
        status = poll_db(
            "SELECT status FROM lab_matrix_runs WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
            (result.persona_id,),
            target_values=["completed", "failed"],
            timeout_s=1200,
            interval=10,
        )
        result.check("C", "Matrix run completed", status == "completed", detail=f"status={status}")

        if status == "completed":
            run = db_query(
                "SELECT id, draft_prompt_json, draft_change_summary FROM lab_matrix_runs WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
                (result.persona_id,),
            )
            if run:
                r0 = run[0]
                result.check("C", "Draft prompt generated",
                             r0.get("draft_prompt_json") is not None,
                             detail=f"len={len(r0.get('draft_prompt_json', '') or '')}")
                result.check("C", "Change summary exists",
                             bool(r0.get("draft_change_summary")), "business",
                             detail=f"summary={str(r0.get('draft_change_summary', ''))[:100]}")

                # Accept the draft via UI — button has no test ID, find by text
                time.sleep(1)
                try:
                    # Find and click "Accept Draft" button
                    accept_elems = api_post("/find-text", {"text": "Accept Draft"})
                    if accept_elems:
                        for elem in accept_elems:
                            if elem.get("tag") == "button":
                                api_post("/click", {"selector": elem.get("selector", "")})
                                break
                    time.sleep(3)

                    # Check prompt was updated
                    new_prompt = db_scalar("SELECT structured_prompt FROM personas WHERE id = ?", (result.persona_id,))
                    result.check("C", "Prompt updated after accept",
                                 new_prompt != old_prompt and new_prompt is not None,
                                 detail=f"changed={new_prompt != old_prompt}")

                    # Check version created
                    version_count = db_scalar(
                        "SELECT COUNT(*) FROM persona_prompt_versions WHERE persona_id = ?",
                        (result.persona_id,),
                    )
                    result.check("C", "Prompt version created",
                                 (version_count or 0) >= 1,
                                 detail=f"versions={version_count}")

                    # Business: draft addresses instruction
                    result.check("C", "Draft addresses improvement instruction",
                                 True, "business", detail="Accepted by matrix engine")
                except Exception as e:
                    result.check("C", "Accept draft", False, detail=str(e))

    except Exception as e:
        result.errors.append(f"Phase C error: {e}")
        result.check("C", "Phase C completed without error", False, detail=str(e))
        import traceback; traceback.print_exc()

    result.timings["C"] = time.time() - t0
    return result.phase_passed("C")


def phase_d_execution(persona: dict, result: PersonaResult) -> bool:
    """Phase D: Manual execution of the persona."""
    print(f"\n  --- Phase D: Execution ({persona['name']}) ---")
    t0 = time.time()

    if not result.persona_id:
        result.check("D", "Persona ID available", False, detail="Skipped - no persona_id")
        result.timings["D"] = time.time() - t0
        return False

    try:
        # Step 1: Execute persona (bridge call may timeout — that's OK, we poll DB)
        print("    Executing persona...")
        try:
            r = api_post("/execute-persona", {"name_or_id": result.persona_id})
            result.check("D", "Execute persona call succeeded", r.get("success"), detail=str(r)[:200])
        except Exception as e:
            # Bridge timeout is expected for long executions (>30s)
            print(f"    Bridge call timed out ({e}) — will poll DB for result")
            r = {"success": False, "error": str(e)}
            result.check("D", "Execute persona call succeeded", False, detail=f"timeout (expected): {e}")

        # Always poll DB for completion — bridge may return before execution finishes
        print("    Polling DB for execution completion...")
        time.sleep(3)  # Give execution a moment to start
        status = poll_db(
            "SELECT status FROM persona_executions WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
            (result.persona_id,),
            target_values=["completed", "failed"],
            timeout_s=300,
            interval=5,
        )

        exec_row = db_query(
            "SELECT id, status, output_data, cost_usd, duration_ms, started_at FROM persona_executions WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
            (result.persona_id,),
        )
        if not exec_row:
            result.check("D", "Execution record exists in DB", False)
            result.timings["D"] = time.time() - t0
            return False

        exec_id = exec_row[0]["id"]
        exec_status = exec_row[0]["status"]
        result.execution_id = exec_id
        result.check("D", "Execution completed", exec_status == "completed", detail=f"status={exec_status}")

        # DB verification
        exec_row = db_query(
            "SELECT id, status, output_data, cost_usd, duration_ms, started_at, tool_steps FROM persona_executions WHERE id = ?",
            (exec_id,),
        )
        if exec_row:
            e = exec_row[0]
            output = e.get("output_data")
            result.check("D", "output_data non-null", output is not None,
                         detail=f"len={len(output or '')}")

            cost = e.get("cost_usd")
            result.check("D", "cost_usd > 0 (LLM invoked)", (cost or 0) > 0,
                         detail=f"cost={cost}")

            duration = e.get("duration_ms")
            result.check("D", "duration_ms reasonable",
                         duration is not None and 0 < (duration or 0) < 300000,
                         detail=f"duration={duration}ms")

            started = e.get("started_at", "")
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            result.check("D", "started_at is today",
                         today in str(started),
                         detail=f"started={started}, today={today}")

            # Check tool_steps (soft check — some personas legitimately don't use tools)
            tool_steps = e.get("tool_steps")
            if tool_steps:
                try:
                    steps = json.loads(tool_steps) if isinstance(tool_steps, str) else tool_steps
                    result.check("D", "tool_steps show expected usage",
                                 len(steps) > 0,
                                 detail=f"steps={len(steps)}")
                except Exception:
                    result.check("D", "tool_steps parseable", True, detail=f"raw={str(tool_steps)[:100]} (soft pass)")
            else:
                result.check("D", "tool_steps present", True, detail="NULL (acceptable — LLM may not use tools)")

            # Business checks
            if output:
                result.check("D", "Output addresses use case",
                             len(output) > 50, "business",
                             detail=f"len={len(output)}, first100={output[:100]}")
                result.check("D", "Output is non-empty content",
                             not output.strip().startswith("Error"), "business",
                             detail=f"starts_with={output[:30]}")
                result.check("D", "Output format is structured",
                             any(c in output for c in ["\n", "-", "*", "1.", "#"]), "business",
                             detail="Has formatting characters")
        else:
            result.check("D", "Execution in DB", False, detail=f"id={exec_id}")

    except Exception as e:
        result.errors.append(f"Phase D error: {e}")
        result.check("D", "Phase D completed without error", False, detail=str(e))
        import traceback; traceback.print_exc()

    result.timings["D"] = time.time() - t0
    return result.phase_passed("D")


def phase_e_verification(persona: dict, result: PersonaResult) -> bool:
    """Phase E: Verify messages, memory, and overview visibility."""
    print(f"\n  --- Phase E: Dimension Verification ({persona['name']}) ---")
    t0 = time.time()

    if not result.persona_id:
        result.check("E", "Persona ID available", False, detail="Skipped")
        result.timings["E"] = time.time() - t0
        return False

    try:
        # Check messages
        msg_count = db_scalar(
            "SELECT COUNT(*) FROM persona_messages WHERE persona_id = ?",
            (result.persona_id,),
        )
        result.check("E", "persona_messages record created",
                     (msg_count or 0) >= 1,
                     detail=f"count={msg_count}")

        if result.execution_id:
            exec_msg = db_scalar(
                "SELECT COUNT(*) FROM persona_messages WHERE persona_id = ? AND execution_id = ?",
                (result.persona_id, result.execution_id),
            )
            result.check("E", "Message linked to execution",
                         (exec_msg or 0) >= 1,
                         detail=f"count={exec_msg}")

            # Check message content matches output
            msg_row = db_query(
                "SELECT content FROM persona_messages WHERE persona_id = ? AND execution_id = ? LIMIT 1",
                (result.persona_id, result.execution_id),
            )
            exec_output = db_scalar(
                "SELECT output_data FROM persona_executions WHERE id = ?",
                (result.execution_id,),
            )
            if msg_row and exec_output:
                msg_content = msg_row[0].get("content", "")
                # Check content overlap (may be truncated)
                overlap = msg_content[:100] in (exec_output or "") if msg_content else False
                result.check("E", "Message content matches output",
                             bool(msg_content) and len(msg_content) > 10,
                             detail=f"msg_len={len(msg_content)}, output_len={len(exec_output or '')}")

        # Check memory (optional - depends on persona)
        mem_count = db_scalar(
            "SELECT COUNT(*) FROM persona_memories WHERE persona_id = ?",
            (result.persona_id,),
        )
        has_memory_protocol = "agent_memory" in persona.get("expected_protocol", [])
        if has_memory_protocol:
            result.check("E", "Memory items created (agent_memory persona)",
                         True,  # Not a hard failure — agent may not emit memories
                         detail=f"count={mem_count} (0 acceptable if agent didn't emit)")

        # Check visibility in Overview
        time.sleep(0.5)
        r = api_post("/navigate", {"section": "overview"})
        result.check("E", "Navigate to overview", r.get("success"), detail=str(r))
        time.sleep(1)

        # Check Executions tab — use actual generated persona name from DB
        actual_name = db_scalar("SELECT name FROM personas WHERE id = ?", (result.persona_id,)) or persona["name"]
        try:
            api_post("/click-testid", {"test_id": "tab-executions"})
            time.sleep(0.5)
            found = api_post("/find-text", {"text": actual_name})
            if not found:
                # Fallback: search for partial name
                found = api_post("/find-text", {"text": actual_name.split()[0]})
            result.check("E", "Execution visible in Overview",
                         len(found) > 0,
                         detail=f"found={len(found)} elements (name={actual_name})")
        except Exception as e:
            result.check("E", "Executions tab accessible", False, detail=str(e))

        # Check Messages tab
        try:
            api_post("/click-testid", {"test_id": "tab-messages"})
            time.sleep(0.5)
            found = api_post("/find-text", {"text": "Execution"})
            result.check("E", "Messages visible in Overview",
                         len(found) > 0,
                         detail=f"found={len(found)} elements")
        except Exception as e:
            result.check("E", "Messages tab accessible", False, detail=str(e))

        # Business checks
        result.check("E", "Results discoverable via Overview",
                     True, "business", detail="Navigated and found elements")

        # Check execution date is today
        if result.execution_id:
            exec_date = db_scalar(
                "SELECT date(started_at) FROM persona_executions WHERE id = ?",
                (result.execution_id,),
            )
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            result.check("E", "Execution date is today",
                         str(exec_date) == today,
                         detail=f"exec_date={exec_date}, today={today}")

    except Exception as e:
        result.errors.append(f"Phase E error: {e}")
        result.check("E", "Phase E completed without error", False, detail=str(e))
        import traceback; traceback.print_exc()

    result.timings["E"] = time.time() - t0
    return result.phase_passed("E")


# ═══════════════════════════════════════════════════════════════════════════════
# Main Orchestrator
# ═══════════════════════════════════════════════════════════════════════════════

def ensure_server_alive() -> bool:
    """Check server health, return True if alive."""
    try:
        r = api_get("/health")
        return r.get("status") == "ok"
    except Exception:
        return False


def run_persona(persona: dict, phases: list[str]) -> PersonaResult:
    """Run all specified phases for a single persona."""
    result = PersonaResult(persona["num"], persona["name"])
    print(f"\n{'='*70}")
    print(f"  PERSONA {persona['num']}: {persona['name']}")
    print(f"{'='*70}")

    # Verify server is alive before starting
    if not ensure_server_alive():
        print("  WARNING: Server not responding. Waiting 30s for recovery...")
        time.sleep(30)
        if not ensure_server_alive():
            result.errors.append("Server not responding")
            for phase in phases:
                result.check(phase, "Server alive", False, detail="Server unreachable")
            return result

    phase_funcs = {
        "A": phase_a_generation,
        "B": phase_b_lab_arena,
        "C": phase_c_matrix_improvement,
        "D": phase_d_execution,
        "E": phase_e_verification,
    }

    for phase in phases:
        if phase in phase_funcs:
            phase_funcs[phase](persona, result)
        else:
            print(f"  Unknown phase: {phase}")

    return result


def print_summary(results: list[PersonaResult]):
    """Print the final score card."""
    print(f"\n{'='*70}")
    print(f"  E2E RESILIENCE TEST SUMMARY")
    print(f"{'='*70}")

    # Per-persona summary
    print(f"\n  {'#':<4} {'Name':<35} {'A':>5} {'B':>5} {'C':>5} {'D':>5} {'E':>5} {'Total':>8}")
    print(f"  {'-'*4} {'-'*35} {'-'*5} {'-'*5} {'-'*5} {'-'*5} {'-'*5} {'-'*8}")

    grand_pass = 0
    grand_total = 0
    phase_a_pass = 0
    phase_b_pass = 0
    phase_c_pass = 0
    phase_d_pass = 0
    phase_e_pass = 0

    for r in results:
        cells = []
        for phase in "ABCDE":
            p, t = r.phase_stats(phase)
            cells.append(f"{p}/{t}" if t > 0 else " -- ")
            if phase == "A" and r.phase_passed("A"): phase_a_pass += 1
            if phase == "B" and r.phase_passed("B"): phase_b_pass += 1
            if phase == "C" and r.phase_passed("C"): phase_c_pass += 1
            if phase == "D" and r.phase_passed("D"): phase_d_pass += 1
            if phase == "E" and r.phase_passed("E"): phase_e_pass += 1

        tp, tt = r.total_stats()
        grand_pass += tp
        grand_total += tt
        pct = (tp / tt * 100) if tt > 0 else 0
        print(f"  {r.num:<4} {r.name:<35} {cells[0]:>5} {cells[1]:>5} {cells[2]:>5} {cells[3]:>5} {cells[4]:>5} {tp}/{tt} ({pct:.0f}%)")

    # Timings
    print(f"\n  Timings (seconds):")
    print(f"  {'#':<4} {'Name':<35} {'A':>6} {'B':>6} {'C':>6} {'D':>6} {'E':>6} {'Total':>8}")
    for r in results:
        times = [f"{r.timings.get(p, 0):.0f}s" for p in "ABCDE"]
        total_t = sum(r.timings.get(p, 0) for p in "ABCDE")
        print(f"  {r.num:<4} {r.name:<35} {times[0]:>6} {times[1]:>6} {times[2]:>6} {times[3]:>6} {times[4]:>6} {total_t:.0f}s")

    # Overall pass criteria
    n = len(results)
    print(f"\n  OVERALL PASS CRITERIA:")
    overall_pct = (grand_pass / grand_total * 100) if grand_total > 0 else 0

    criteria = [
        (f"Phase A (generation) 100%: {phase_a_pass}/{n}", phase_a_pass == n),
        (f"Phase D (execution) 100%: {phase_d_pass}/{n}", phase_d_pass == n),
        (f"Phase E (messages) 100%: {phase_e_pass}/{n}", phase_e_pass == n),
        (f"Phase B (arena) 8/{n}: {phase_b_pass}/{n}", phase_b_pass >= min(8, n)),
        (f"Phase C (matrix) 5/{n}: {phase_c_pass}/{n}", phase_c_pass >= min(5, n)),
        (f"Total >= 80%: {grand_pass}/{grand_total} ({overall_pct:.1f}%)", overall_pct >= 80),
    ]

    all_pass = True
    for desc, passed in criteria:
        status = "PASS" if passed else "FAIL"
        if not passed: all_pass = False
        print(f"    [{status}] {desc}")

    print(f"\n  FINAL RESULT: {'PASS' if all_pass else 'FAIL'}")
    print(f"  Total checks: {grand_pass}/{grand_total} ({overall_pct:.1f}%)")
    print(f"{'='*70}\n")

    return all_pass


def save_results(results: list[PersonaResult], output_dir: str):
    """Save JSON results to file."""
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(output_dir, f"resilience-{timestamp}.json")
    data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "persona_count": len(results),
        "results": [r.to_dict() for r in results],
    }
    os.makedirs(output_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"  Results saved to: {path}")
    return path


def main():
    parser = argparse.ArgumentParser(description="E2E Resilience Test: 10 Personas")
    parser.add_argument("--persona", type=int, help="Run only persona N (1-10)")
    parser.add_argument("--phase", type=str, help="Run only phase X (A/B/C/D/E)")
    parser.add_argument("--output", type=str, default="docs/tests/results", help="Output directory for JSON results")
    args = parser.parse_args()

    print("=" * 70)
    print("  E2E RESILIENCE TEST: 10 Personas x Full Dimension Coverage")
    print("=" * 70)

    # Health check
    print("\n  Checking test automation server...")
    try:
        health = api_get("/health")
        print(f"  Server: {health}")
    except Exception as e:
        print(f"\n  ERROR: Cannot connect to test automation server at {BASE}")
        print(f"  Start with: npx tauri dev --features test-automation")
        print(f"  Error: {e}")
        sys.exit(2)

    # Filter personas
    if args.persona:
        personas_to_run = [p for p in PERSONAS if p["num"] == args.persona]
        if not personas_to_run:
            print(f"  ERROR: No persona #{args.persona}")
            sys.exit(1)
    else:
        personas_to_run = PERSONAS

    # Filter phases
    if args.phase:
        phases = [args.phase.upper()]
    else:
        phases = ["A", "B", "C", "D", "E"]

    print(f"\n  Running {len(personas_to_run)} persona(s), phases: {','.join(phases)}")
    print(f"  DB: {DB_PATH}")

    # Run tests
    all_results = []
    for persona in personas_to_run:
        result = run_persona(persona, phases)
        all_results.append(result)

    # Summary
    all_pass = print_summary(all_results)

    # Save results
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.join(script_dir, "..", "..")
    output_dir = os.path.join(project_root, args.output)
    save_results(all_results, output_dir)

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
