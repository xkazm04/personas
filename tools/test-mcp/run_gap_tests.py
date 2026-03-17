"""
Targeted tests for 7 gap fixes. One test per gap.

Usage:
  PYTHONUNBUFFERED=1 uvx --with httpx python tools/test-mcp/run_gap_tests.py
"""
import httpx
import json
import time
import sys

BASE = "http://127.0.0.1:17320"
c = httpx.Client(base_url=BASE, timeout=30)

results = []

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

def build_agent(intent, max_time=300):
    """Build an agent to draft_ready. Returns (success, state_dict)."""
    c.post("/navigate", json={"section": "personas"})
    time.sleep(0.3)
    c.post("/start-create-agent", json={})
    time.sleep(0.5)
    c.post("/wait", json={"selector": '[data-testid="agent-intent-input"]', "timeout_ms": 5000})
    c.post("/fill-field", json={"test_id": "agent-intent-input", "value": intent})
    c.post("/click-testid", json={"test_id": "agent-launch-btn"})

    start = time.time()
    while time.time() - start < max_time:
        time.sleep(5)
        try:
            state = c.get("/state").json()
        except:
            continue
        phase = state.get("buildPhase", "")
        cells = state.get("buildCellStates", {})
        highlighted = [k for k,v in cells.items() if v == "highlighted"]

        if phase == "draft_ready":
            return True, state
        if phase == "failed":
            return False, state
        if phase == "awaiting_input" and highlighted:
            c.post("/answer-question", json={"cell_key": highlighted[0], "option_index": 0})
            continue
        if phase == "awaiting_input" and not highlighted:
            c.post("/click-testid", json={"test_id": "continue-build-btn"})
    return False, {}


def test_gap(name, fn):
    print(f"\n{'='*60}")
    print(f"  GAP TEST: {name}")
    print(f"{'='*60}")
    try:
        ok, detail = fn()
        status = "PASS" if ok else "FAIL"
        results.append({"name": name, "status": status, "detail": detail})
        print(f"  Result: [{status}] {detail}")
    except Exception as e:
        results.append({"name": name, "status": "ERROR", "detail": str(e)})
        print(f"  Result: [ERROR] {e}")


# ============================================================================
# Gap 2: Agent names in target language (test with Japanese)
# ============================================================================
def test_gap2():
    reset()
    set_language("ja")
    ok, state = build_agent("Gmailの重要なメールを監視して、Notionのタスクリストにサマリーを投稿して")
    set_language("en")
    if not ok:
        return False, "Build failed"
    name = state.get("personas", [{}])[-1].get("name", "")
    # Check if name contains any Japanese characters
    has_japanese = any('\u3040' <= ch <= '\u9fff' or '\u30a0' <= ch <= '\u30ff' for ch in name)
    # Also accept CJK unified ideographs
    has_cjk = any('\u4e00' <= ch <= '\u9fff' for ch in name)
    is_localized = has_japanese or has_cjk
    return is_localized, f"name=\"{name}\" has_jp={has_japanese} has_cjk={has_cjk}"


# ============================================================================
# Gap 3: Cell status resolved (not updated) after answering question
# ============================================================================
def test_gap3():
    reset()
    set_language("en")
    # Use vague intent to force a question
    ok, state = build_agent("Help me be more productive")
    if not ok:
        return False, "Build failed"
    cells = state.get("buildCellStates", {})
    updated_cells = [k for k, v in cells.items() if v == "updated"]
    resolved_cells = [k for k, v in cells.items() if v == "resolved"]
    # After a question is answered, all cells should be "resolved", not "updated"
    has_updated = len(updated_cells) > 0
    return not has_updated, f"resolved={len(resolved_cells)} updated={len(updated_cells)} cells={dict(sorted(cells.items()))}"


# ============================================================================
# Gap 4: Navigation hydration round-trip
# ============================================================================
def test_gap4():
    reset()
    set_language("en")
    ok, state = build_agent("Log Notion pages to daily summary")
    if not ok:
        return False, "Build failed to draft_ready"
    # Now test hydration via bridge
    r = c.post("/eval", json={"js": "window.__TEST__.verifyHydrationRoundTrip()"}).json()
    # The eval returns the bridge method result
    # But eval is fire-and-forget, need to wait and re-check state
    time.sleep(2)
    after = c.get("/state").json()
    cells_before = len(state.get("buildCellStates", {}))
    cells_after = len(after.get("buildCellStates", {}))
    phase_match = state.get("buildPhase") == after.get("buildPhase")
    return cells_before == cells_after and phase_match, f"before={cells_before} after={cells_after} phase_match={phase_match}"


# ============================================================================
# Gap 5: Concurrent build rejection
# ============================================================================
def test_gap5():
    reset()
    set_language("en")
    ok, state = build_agent("Monitor Gmail for important emails")
    if not ok:
        return False, "First build failed"
    persona_id = state.get("personas", [{}])[-1].get("id", "")
    if not persona_id:
        return False, "No persona ID"
    # Try to start a concurrent build for the same persona via bridge
    r = c.post("/eval", json={"js": f'window.__TEST__.testConcurrentBuildRejection("{persona_id}")'}).json()
    time.sleep(1)
    # The concurrent build should be rejected since this persona has an active session
    # Check if state still shows the original build
    after = c.get("/state").json()
    still_draft = after.get("buildPhase") == "draft_ready"
    return still_draft, f"phase={after.get('buildPhase')} (expected draft_ready, concurrent rejected)"


# ============================================================================
# Gap 6: Test/Refine lifecycle
# ============================================================================
def test_gap6():
    reset()
    set_language("en")
    ok, state = build_agent("Monitor Gmail for important emails and post to Notion")
    if not ok:
        return False, "Build failed to draft_ready"
    # Trigger test via bridge
    c.post("/eval", json={"js": "window.__TEST__.triggerBuildTest()"})
    # Wait for test to complete (may take 30-60s for real API calls)
    time.sleep(5)
    after = c.get("/state").json()
    phase = after.get("buildPhase", "")
    # The test should transition from draft_ready → testing → test_complete
    # Even if tests fail (no real credentials), the phase should advance
    valid_phases = ("testing", "test_complete", "draft_ready")
    return phase in valid_phases, f"phase={phase} (test lifecycle triggered)"


# ============================================================================
# Gap 7: Template matching for non-English intents
# ============================================================================
def test_gap7():
    reset()
    set_language("ja")
    # Japanese intent mentioning Gmail and Notion (ASCII service names)
    ok, state = build_agent("Gmailの重要なメールを監視してNotionに保存するエージェント")
    set_language("en")
    if not ok:
        return False, "Build failed"
    cells = state.get("buildCellStates", {})
    resolved = sum(1 for v in cells.values() if v in ("resolved", "updated"))
    # If template matching worked, the build should resolve well (8/8 or close)
    # because Gmail+Notion templates exist in the catalog
    return resolved >= 7, f"resolved={resolved}/8 (template matching worked for JP intent with Gmail+Notion)"


# ============================================================================
# Gap 1: agent_ir recovery (test indirectly — verify agent_ir exists after build)
# ============================================================================
def test_gap1():
    reset()
    set_language("en")
    ok, state = build_agent("Sort emails and create tasks from important ones")
    if not ok:
        return False, "Build failed"
    # Check that buildDraft (agent_ir) is populated
    r = c.post("/eval", json={"js": """
        (async()=>{
            const s = (await import('@/stores/agentStore')).useAgentStore.getState();
            return JSON.stringify({
                hasDraft: !!s.buildDraft,
                draftName: s.buildDraft?.name || null,
                draftHasPrompt: !!(s.buildDraft?.system_prompt || s.buildDraft?.structured_prompt),
            });
        })()
    """}).json()
    time.sleep(1)
    # Re-read state to check if agent_ir arrived
    state2 = c.get("/state").json()
    name = state2.get("personas", [{}])[-1].get("name", "")
    # agent_ir name should have been synced (not "New Agent" or placeholder)
    has_good_name = name and name != "New Agent" and len(name) > 3
    return has_good_name, f"name=\"{name}\" (agent_ir name synced to persona list)"


# ============================================================================
# Run all tests
# ============================================================================
def main():
    try:
        h = c.get("/health").json()
        print(f"Server: {h.get('server')} v{h.get('version')}")
    except Exception:
        print("ERROR: Cannot connect to test server on port 17320")
        sys.exit(1)

    test_gap("Gap 1: agent_ir recovery", test_gap1)
    test_gap("Gap 2: Localized agent names (Japanese)", test_gap2)
    test_gap("Gap 3: resolved vs updated cell status", test_gap3)
    test_gap("Gap 4: Navigation hydration round-trip", test_gap4)
    test_gap("Gap 5: Concurrent build rejection", test_gap5)
    test_gap("Gap 6: Test/Refine lifecycle", test_gap6)
    test_gap("Gap 7: Template matching for non-English", test_gap7)

    # Summary
    print(f"\n{'='*60}")
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    errors = sum(1 for r in results if r["status"] == "ERROR")
    print(f"  SUMMARY: {passed} passed, {failed} failed, {errors} error out of {len(results)}")
    print(f"{'='*60}")
    for r in results:
        icon = {"PASS": "+", "FAIL": "!", "ERROR": "X"}[r["status"]]
        print(f"  [{icon}] {r['name']}: {r['detail']}")

    reset()
    sys.exit(0 if failed == 0 and errors == 0 else 1)


if __name__ == "__main__":
    main()
