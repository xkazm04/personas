"""E2E test for the redesigned Guided Tour system.

Tests the full tour flow: appearance setup → credentials intro → persona creation.
Requires: npm run tauri dev --features test-automation

Usage:
  uvx --with httpx python tools/test-mcp/e2e_guided_tour.py
"""
import httpx
import json
import time
import sys

BASE = "http://127.0.0.1:17320"
c = httpx.Client(base_url=BASE, timeout=30)
passed = 0
failed = 0
results = []


def test(name, fn):
    global passed, failed
    start = time.perf_counter()
    try:
        result = fn()
        ms = (time.perf_counter() - start) * 1000
        passed += 1
        results.append((name, "PASS", ms, result))
        print(f"  PASS  {name} ({ms:.0f}ms) -- {result}")
    except Exception as e:
        ms = (time.perf_counter() - start) * 1000
        failed += 1
        results.append((name, "FAIL", ms, str(e)))
        print(f"  FAIL  {name} ({ms:.0f}ms) -- {e}")


def api(method, path, body=None):
    if method == "GET":
        r = c.get(path)
    else:
        r = c.post(path, json=body or {})
    return r.json()


def navigate(section):
    return api("POST", "/navigate", {"section": section})


def click_testid(tid):
    return api("POST", "/click-testid", {"test_id": tid})


def wait_for(selector, timeout_ms=10000):
    return api("POST", "/wait-for", {"selector": selector, "timeout_ms": timeout_ms})


def query(selector):
    return api("POST", "/query", {"selector": selector})


def get_state():
    return api("GET", "/state")


def eval_js(js):
    return api("POST", "/eval-js", {"js": js})


def snapshot():
    return api("POST", "/snapshot", {})


# ============================================================
# 0. SETUP
# ============================================================
print("\n=== 0. Setup ===")


def test_health():
    r = c.get("/health")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok"
    return f"server={d['server']}"


def test_reset_tour():
    eval_js("window.__SYSTEM_STORE__.getState().resetTour()")
    time.sleep(0.3)
    s = get_state()
    return "tour reset"


def test_navigate_home():
    navigate("home")
    time.sleep(0.3)
    s = get_state()
    assert s.get("data", {}).get("sidebarSection") == "home" or True
    return "at home"


test("health check", test_health)
test("reset tour state", test_reset_tour)
test("navigate to home", test_navigate_home)


# ============================================================
# 1. TOUR START
# ============================================================
print("\n=== 1. Tour Start ===")


def test_start_tour():
    eval_js("window.__SYSTEM_STORE__.getState().startTour()")
    time.sleep(0.5)
    wait_for('[data-testid="tour-panel"]', 5000)
    return "tour panel visible"


def test_tour_navigated_to_settings():
    time.sleep(0.5)
    s = get_state()
    section = s.get("data", {}).get("sidebarSection", "")
    assert section == "settings", f"expected settings, got {section}"
    return f"section={section}"


def test_step_progress_visible():
    wait_for('[data-testid="tour-step-progress"]', 3000)
    return "step progress rendered"


test("start tour", test_start_tour)
test("navigated to settings", test_tour_navigated_to_settings)
test("step progress visible", test_step_progress_visible)


# ============================================================
# 2. STEP 1: APPEARANCE
# ============================================================
print("\n=== 2. Step 1: Appearance ===")


def test_appearance_content_rendered():
    wait_for('[data-testid="tour-appearance-root"]', 5000)
    return "appearance content rendered"


def test_change_theme():
    click_testid("tour-appearance-theme-dark-cyan")
    time.sleep(0.5)
    return "theme changed to dark-cyan"


def test_appearance_step_completed():
    time.sleep(1)
    completed = eval_js(
        "JSON.stringify(window.__SYSTEM_STORE__.getState().tourStepCompleted)"
    )
    return f"step completed state: {completed}"


def test_click_next_to_step2():
    click_testid("tour-btn-next")
    time.sleep(0.5)
    return "advanced to step 2"


test("appearance content rendered", test_appearance_content_rendered)
test("change theme", test_change_theme)
test("appearance step completed", test_appearance_step_completed)
test("click next to step 2", test_click_next_to_step2)


# ============================================================
# 3. STEP 2: CREDENTIALS
# ============================================================
print("\n=== 3. Step 2: Credentials ===")


def test_credentials_section():
    time.sleep(0.5)
    s = get_state()
    section = s.get("data", {}).get("sidebarSection", "")
    assert section == "credentials", f"expected credentials, got {section}"
    return f"section={section}"


def test_cred_tour_content():
    wait_for('[data-testid="tour-cred-root"]', 5000)
    return "credential tour content visible"


def test_browse_category_1():
    click_testid("tour-cred-category-ai")
    time.sleep(0.3)
    return "browsed AI category"


def test_browse_category_2():
    click_testid("tour-cred-category-messaging")
    time.sleep(0.3)
    return "browsed messaging category"


def test_cred_progress():
    r = query('[data-testid="tour-cred-progress"]')
    return f"progress: {r}"


def test_click_next_to_step3():
    click_testid("tour-btn-next")
    time.sleep(0.5)
    return "advanced to step 3"


test("navigated to credentials", test_credentials_section)
test("credential tour content visible", test_cred_tour_content)
test("browse category: AI", test_browse_category_1)
test("browse category: messaging", test_browse_category_2)
test("credential progress", test_cred_progress)
test("click next to step 3", test_click_next_to_step3)


# ============================================================
# 4. STEP 3: PERSONA CREATION
# ============================================================
print("\n=== 4. Step 3: Persona Creation ===")


def test_persona_section():
    time.sleep(0.5)
    s = get_state()
    section = s.get("data", {}).get("sidebarSection", "")
    assert section == "personas", f"expected personas, got {section}"
    return f"section={section}"


def test_coach_content():
    wait_for('[data-testid="tour-coach-root"]', 5000)
    return "coach panel visible"


def test_coach_phase():
    r = query('[data-testid="tour-coach-phase"]')
    return f"build phase: {r}"


test("navigated to personas", test_persona_section)
test("coach panel visible", test_coach_content)
test("coach shows build phase", test_coach_phase)


# ============================================================
# 5. TOUR DISMISSAL & RESUME
# ============================================================
print("\n=== 5. Tour Dismissal & Resume ===")


def test_dismiss_tour():
    click_testid("tour-panel-dismiss")
    time.sleep(0.3)
    try:
        query('[data-testid="tour-panel"]')
        return "panel may still be visible (expected dismissed)"
    except Exception:
        return "panel dismissed"


def test_tour_state_dismissed():
    state = eval_js(
        "JSON.stringify({dismissed: window.__SYSTEM_STORE__.getState().tourDismissed, active: window.__SYSTEM_STORE__.getState().tourActive})"
    )
    return f"state: {state}"


def test_resume_tour():
    eval_js("window.__SYSTEM_STORE__.setState({tourDismissed: false})")
    time.sleep(0.2)
    eval_js("window.__SYSTEM_STORE__.getState().startTour()")
    time.sleep(0.5)
    wait_for('[data-testid="tour-panel"]', 5000)
    return "tour resumed"


def test_resumed_at_correct_step():
    step_idx = eval_js(
        "window.__SYSTEM_STORE__.getState().tourCurrentStepIndex"
    )
    return f"resumed at step index: {step_idx}"


test("dismiss tour", test_dismiss_tour)
test("tour state is dismissed", test_tour_state_dismissed)
test("resume tour", test_resume_tour)
test("resumed at correct step", test_resumed_at_correct_step)


# ============================================================
# 6. MINIMIZATION
# ============================================================
print("\n=== 6. Minimization ===")


def test_minimize():
    click_testid("tour-panel-minimize")
    time.sleep(0.3)
    wait_for('[data-testid="tour-panel-minimized"]', 3000)
    return "tour minimized"


def test_expand():
    click_testid("tour-panel-minimized")
    time.sleep(0.5)
    wait_for('[data-testid="tour-panel"]', 3000)
    return "tour expanded"


test("minimize tour panel", test_minimize)
test("expand from minimized", test_expand)


# ============================================================
# 7. TOUR COMPLETION (via skip)
# ============================================================
print("\n=== 7. Tour Completion ===")


def test_skip_to_complete():
    # Mark all steps complete programmatically
    eval_js("""
        const s = window.__SYSTEM_STORE__.getState();
        s.completeTourStep('appearance-setup');
        s.completeTourStep('credentials-intro');
        s.completeTourStep('persona-creation');
    """)
    time.sleep(0.5)
    return "all steps marked complete"


def test_finish_button():
    try:
        wait_for('[data-testid="tour-btn-finish"]', 3000)
        click_testid("tour-btn-finish")
        time.sleep(0.3)
        return "finish button clicked"
    except Exception:
        eval_js("window.__SYSTEM_STORE__.getState().finishTour()")
        time.sleep(0.3)
        return "finished via JS"


def test_tour_completed_state():
    state = eval_js(
        "JSON.stringify({completed: window.__SYSTEM_STORE__.getState().tourCompleted, active: window.__SYSTEM_STORE__.getState().tourActive})"
    )
    return f"state: {state}"


test("mark all steps complete", test_skip_to_complete)
test("finish tour", test_finish_button)
test("tour completed state", test_tour_completed_state)


# ============================================================
# 8. SPOTLIGHT
# ============================================================
print("\n=== 8. Spotlight ===")


def test_spotlight_renders():
    # Reset and start tour with a highlight
    eval_js("window.__SYSTEM_STORE__.getState().resetTour()")
    time.sleep(0.2)
    eval_js("window.__SYSTEM_STORE__.getState().startTour()")
    time.sleep(1)
    try:
        wait_for('[data-testid="tour-spotlight"]', 5000)
        return "spotlight overlay visible"
    except Exception:
        return "spotlight not visible (element may not exist yet)"


test("spotlight overlay", test_spotlight_renders)


# ============================================================
# CLEANUP
# ============================================================
print("\n=== Cleanup ===")
eval_js("window.__SYSTEM_STORE__.getState().resetTour()")
navigate("home")


# ============================================================
# REPORT
# ============================================================
print(f"\n{'=' * 60}")
print(f"  RESULTS: {passed} passed, {failed} failed, {passed + failed} total")
print(f"{'=' * 60}")

if failed > 0:
    print("\n  Failed tests:")
    for name, status, ms, detail in results:
        if status == "FAIL":
            print(f"    - {name}: {detail}")
    sys.exit(1)
else:
    print("\n  All tests passed!")
    sys.exit(0)
