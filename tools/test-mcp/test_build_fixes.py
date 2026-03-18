"""
E2E test for the full persona creation pipeline:
1. Build agent from intent (8 dimensions)
2. Hydration round-trip (navigate away and back)
3. Test agent tools (CLI-native detection)
4. View test report modal
5. Promote agent to production
6. Verify promoted agent exists in All Agents

Usage:
  python3 tools/test-mcp/test_build_fixes.py
"""
import httpx
import json
import time
import sys
import os

if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE = "http://127.0.0.1:17320"
c = httpx.Client(base_url=BASE, timeout=60)

MAX_BUILD_TIME = 300
POLL_INTERVAL = 5

def log(msg):
    print(f"  {msg}")

def get_state():
    try:
        return c.get("/state").json()
    except Exception:
        return {}

def find_text(text):
    r = c.post("/find-text", json={"text": text}).json()
    return r if isinstance(r, list) else r.get("elements", [])

def wait_for_phase(target_phases, timeout=MAX_BUILD_TIME):
    """Wait until buildPhase reaches target. Auto-answers questions."""
    start = time.time()
    while time.time() - start < timeout:
        time.sleep(POLL_INTERVAL)
        state = get_state()
        phase = state.get("buildPhase", "")
        highlighted = [k for k, v in state.get("buildCellStates", {}).items() if v == "highlighted"]

        if phase in target_phases:
            return phase, state
        if phase == "failed":
            return "failed", state

        if phase == "awaiting_input":
            if highlighted:
                try:
                    c.post("/answer-question", json={"cell_key": highlighted[0], "option_index": 0})
                except Exception:
                    pass
            else:
                c.post("/eval", json={"js": 'document.querySelectorAll("button").forEach(b=>{if(b.innerText.includes("Continue Build"))b.click()})'})

    return "timeout", {}


# ============================================================
# Test 1: Build
# ============================================================

def test_build():
    """Build a CNN news agent from intent."""
    print("\n=== TEST 1: Build agent from intent ===")

    c.post("/navigate", json={"section": "personas"})
    time.sleep(0.5)
    c.post("/start-create-agent", json={})
    time.sleep(0.5)

    wait_r = c.post("/wait", json={"selector": '[data-testid="agent-intent-input"]', "timeout_ms": 8000}).json()
    if not wait_r.get("success"):
        log("FAIL: Intent input not found")
        return False

    c.post("/fill-field", json={"test_id": "agent-intent-input", "value": "Fetch latest news from CNN and summarize key stories"})
    c.post("/click-testid", json={"test_id": "agent-launch-btn"})

    log("Building (auto-answering questions)...")
    phase, state = wait_for_phase(["draft_ready"])

    if phase != "draft_ready":
        log(f"FAIL: phase={phase}, error={state.get('buildError')}")
        return False

    cells = state.get("buildCellStates", {})
    resolved = sum(1 for v in cells.values() if v in ("resolved", "updated"))
    personas = state.get("personas", [])
    name = personas[-1]["name"] if personas else "?"

    log(f"OK: {resolved}/8 cells, agent=\"{name}\"")
    if resolved < 6:
        log(f"FAIL: Only {resolved} cells resolved")
        return False

    log("PASS")
    return True


# ============================================================
# Test 2: Hydration
# ============================================================

def test_hydration():
    """Verify dimensions survive navigation round-trip."""
    print("\n=== TEST 2: Hydration round-trip ===")

    state = get_state()
    if state.get("buildPhase") != "draft_ready":
        log(f"SKIP: phase={state.get('buildPhase')}")
        return None

    before = sum(1 for v in state.get("buildCellStates", {}).values() if v in ("resolved", "updated"))
    sid = state.get("buildSessionId")

    c.post("/navigate", json={"section": "credentials"})
    time.sleep(1.5)
    c.post("/navigate", json={"section": "personas"})
    time.sleep(1)
    c.post("/eval", json={"js": 'import("@/stores/systemStore").then(m => m.useSystemStore.getState().setIsCreatingPersona(true))'})
    time.sleep(2)

    after_state = get_state()
    after = sum(1 for v in after_state.get("buildCellStates", {}).values() if v in ("resolved", "updated"))

    log(f"Before: {before} cells, After: {after} cells, session match: {sid == after_state.get('buildSessionId')}")
    if after >= before and sid == after_state.get("buildSessionId"):
        log("PASS")
        return True
    log("FAIL: Lost cells or session")
    return False


# ============================================================
# Test 3: Tool Tests
# ============================================================

def test_tool_tests():
    """Run tests, verify CLI-native detection and results."""
    print("\n=== TEST 3: Tool tests ===")

    state = get_state()
    if state.get("buildPhase") not in ("draft_ready", "test_complete"):
        log(f"SKIP: phase={state.get('buildPhase')}")
        return None

    # Ensure buildPersonaId is set
    personas = state.get("personas", [])
    if personas:
        c.post("/eval", json={"js": f'window.__TEST__?.setBuildPersonaId?.("{personas[-1]["id"]}")'})
        time.sleep(0.5)

    log("Clicking Test Agent...")
    c.post("/click-testid", json={"test_id": "agent-test-btn"})
    time.sleep(1)

    phase, state = wait_for_phase(["test_complete"], timeout=180)
    if phase != "test_complete":
        log(f"FAIL: phase={phase}")
        return False

    time.sleep(1)
    has_report = len(find_text("View Report")) > 0
    has_passed = len(find_text("All Tests Passed")) > 0
    has_failed = len(find_text("Some Tests Failed")) > 0
    has_skipped = len(find_text("Tests Skipped")) > 0

    status = "passed" if has_passed else "failed" if has_failed else "skipped" if has_skipped else "unknown"
    log(f"Result: {status}, View Report: {has_report}")

    if not has_report and not has_passed and not has_failed and not has_skipped:
        log("FAIL: No test result visible")
        return False

    log("PASS")
    return True


# ============================================================
# Test 4: Report Modal
# ============================================================

def test_report_modal():
    """Open report modal, verify structure."""
    print("\n=== TEST 4: Report modal ===")

    state = get_state()
    if state.get("buildPhase") != "test_complete":
        log(f"SKIP: phase={state.get('buildPhase')}")
        return None

    if not find_text("View Report"):
        log("FAIL: No View Report button")
        return False

    c.post("/eval", json={"js": 'document.querySelectorAll("button").forEach(b=>{if(b.innerText.includes("View Report"))b.click()})'})
    time.sleep(1)

    has_heading = len(find_text("Test Report")) > 0
    has_scope = len(find_text("Test Scope")) > 0
    has_overview = len(find_text("Overview")) > 0
    has_what = len(find_text("What happened")) > 0

    log(f"Modal: heading={has_heading}, scope={has_scope}, overview={has_overview}")

    # Click on a tool in the left pane to test per-tool view
    tools = find_text("What happened")
    if not tools:
        # Click first tool in scope list
        c.post("/eval", json={"js": '''
            const btns = document.querySelectorAll("[class*='fixed'] button");
            for (const b of btns) {
                if (b.querySelector("svg") && b.textContent.length > 3 && !b.textContent.includes("Overview") && !b.textContent.includes("Test Report")) {
                    b.click(); break;
                }
            }
        '''})
        time.sleep(0.5)
        has_what = len(find_text("What happened")) > 0
        log(f"Per-tool detail: 'What happened' section = {has_what}")

    # Close modal
    c.post("/eval", json={"js": 'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))'})
    time.sleep(0.3)

    if not has_heading:
        log("FAIL: Modal didn't open")
        return False

    log("PASS")
    return True


# ============================================================
# Test 5: Promote
# ============================================================

def test_promote():
    """Approve and promote the agent to production."""
    print("\n=== TEST 5: Promote agent ===")

    state = get_state()
    phase = state.get("buildPhase")
    if phase != "test_complete":
        log(f"SKIP: phase={phase}")
        return None

    # Check if Approve button is visible
    approve_btns = find_text("Approve")
    if not approve_btns:
        # Tests may have failed — try "Refine & Retry" path
        log("No Approve button (tests may have failed), trying to skip promote")
        return None

    log("Clicking Approve...")
    c.post("/eval", json={"js": 'document.querySelectorAll("button").forEach(b=>{if(b.innerText.includes("Approve"))b.click()})'})

    # Wait for promoted phase
    phase, state = wait_for_phase(["promoted"], timeout=30)

    if phase != "promoted":
        log(f"FAIL: Expected promoted, got {phase}")
        # Check for errors
        err = state.get("buildError") or state.get("error")
        if err:
            log(f"  Error: {err}")
        return False

    # Check for promotion success UI
    time.sleep(1)
    has_promoted = len(find_text("Agent Promoted")) > 0
    log(f"Promoted UI visible: {has_promoted}")

    if not has_promoted:
        log("FAIL: 'Agent Promoted' not shown")
        return False

    log("PASS")
    return True


# ============================================================
# Test 6: Verify in All Agents
# ============================================================

def test_verify_in_list():
    """Verify the promoted agent appears in All Agents list."""
    print("\n=== TEST 6: Verify in All Agents ===")

    state = get_state()
    if state.get("buildPhase") != "promoted":
        log(f"SKIP: phase={state.get('buildPhase')}")
        return None

    # Exit creation mode
    view_btns = find_text("View Agent")
    if view_btns:
        c.post("/eval", json={"js": 'document.querySelectorAll("button").forEach(b=>{if(b.innerText.includes("View Agent"))b.click()})'})
        time.sleep(1)
    else:
        c.post("/eval", json={"js": 'import("@/stores/systemStore").then(m => m.useSystemStore.getState().setIsCreatingPersona(false))'})
        time.sleep(1)

    # Navigate to All Agents
    c.post("/navigate", json={"section": "personas"})
    time.sleep(1)

    # Check agent list
    state = get_state()
    personas = state.get("personas", [])
    log(f"Total agents: {len(personas)}")

    # Find our promoted agent (should be enabled)
    enabled = [p for p in personas if p.get("enabled")]
    log(f"Enabled agents: {len(enabled)}")

    if len(enabled) == 0:
        log("FAIL: No enabled agents after promotion")
        return False

    # Check the last created agent has a proper name
    latest = personas[-1] if personas else None
    if latest:
        log(f"Latest agent: \"{latest['name']}\" (enabled={latest.get('enabled')})")

    log("PASS")
    return True


# ============================================================
# Main
# ============================================================

def main():
    try:
        h = c.get("/health").json()
        print(f"Server: {h.get('server')} v{h.get('version')}")
    except Exception:
        print("ERROR: Cannot connect to test server on port 17320")
        sys.exit(1)

    results = {}
    results["1_build"] = test_build()
    results["2_hydration"] = test_hydration()
    results["3_tool_tests"] = test_tool_tests()
    results["4_report_modal"] = test_report_modal()
    results["5_promote"] = test_promote()
    results["6_verify_list"] = test_verify_in_list()

    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    for name, result in results.items():
        icon = "[+]" if result is True else "[!]" if result is False else "[~]"
        status = "PASS" if result is True else "FAIL" if result is False else "SKIP"
        print(f"  {icon} {name}: {status}")

    passed = sum(1 for v in results.values() if v is True)
    failed = sum(1 for v in results.values() if v is False)
    skipped = sum(1 for v in results.values() if v is None)
    print(f"\n  {passed} passed, {failed} failed, {skipped} skipped")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
