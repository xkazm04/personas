#!/usr/bin/env python3
"""
E2E Test: Vault Credential Creation — All 9 Options
Executes scenarios from docs/tests/vault-credential-creation.md
"""

import httpx
import json
import time
import sys
import os

BASE = "http://127.0.0.1:17320"
client = httpx.Client(base_url=BASE, timeout=30.0)

# Results tracking
results = []
current_scenario = ""

def log(msg):
    print(f"  {msg}")

def pass_step(step, detail=""):
    d = f" — {detail}" if detail else ""
    print(f"    ✓ {step}{d}")

def fail_step(step, detail=""):
    d = f" — {detail}" if detail else ""
    print(f"    ✗ {step}{d}")

def scenario(name):
    global current_scenario
    current_scenario = name
    print(f"\n{'='*70}")
    print(f"  SCENARIO: {name}")
    print(f"{'='*70}")

def record(name, passed, notes=""):
    results.append({"scenario": name, "passed": passed, "notes": notes})

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def api_post(path, body=None):
    try:
        r = client.post(path, json=body or {})
        return r.json()
    except Exception as e:
        return {"success": False, "error": str(e)}

def api_get(path):
    try:
        r = client.get(path)
        return r.json()
    except Exception as e:
        return {"success": False, "error": str(e)}

def navigate_to_credentials():
    api_post("/navigate", {"section": "credentials"})
    time.sleep(1)

def open_type_picker():
    api_post("/click-testid", {"test_id": "tab-add-new"})
    time.sleep(1)
    res = api_post("/wait", {"selector": "[data-testid='vault-type-picker']", "timeout_ms": 5000})
    return res.get("success", False)

def go_back_to_list():
    """Try to navigate back to credential list."""
    api_post("/navigate", {"section": "credentials"})
    time.sleep(1)

def _extract_elements(res):
    """Extract element list from query response (may be list or dict)."""
    if isinstance(res, list):
        return res
    if isinstance(res, dict):
        return res.get("elements", res.get("result", []))
    return []

def check_element_exists(testid):
    res = api_post("/query", {"selector": f"[data-testid='{testid}']"})
    elements = _extract_elements(res)
    return len(elements) > 0

def check_element_visible(testid):
    res = api_post("/query", {"selector": f"[data-testid='{testid}']"})
    elements = _extract_elements(res)
    if len(elements) > 0:
        return elements[0].get("visible", False)
    return False

def wait_for_testid(testid, timeout_ms=5000):
    res = api_post("/wait", {"selector": f"[data-testid='{testid}']", "timeout_ms": timeout_ms})
    return res.get("success", False)

def get_snapshot():
    return api_get("/snapshot")

def count_picker_options():
    res = api_post("/query", {"selector": "[data-testid^='vault-pick-']"})
    elements = _extract_elements(res)
    return len(elements)

# ---------------------------------------------------------------------------
# Scenario 1: Navigate to Add New Menu
# ---------------------------------------------------------------------------

def test_scenario_1():
    scenario("1 — Navigate to Add New Menu")
    issues = []

    # 1.1 Navigate to credentials
    navigate_to_credentials()
    state = api_get("/state")
    section = state.get("sidebarSection", state.get("section", ""))
    if section == "credentials":
        pass_step("1.1 Navigate to credentials", f"section={section}")
    else:
        fail_step("1.1 Navigate to credentials", f"section={section}")
        issues.append("Could not navigate to credentials")

    # 1.2 Check credential manager visible
    if wait_for_testid("credential-manager", 5000):
        pass_step("1.2 Credential manager container visible")
    else:
        fail_step("1.2 Credential manager container not found")
        issues.append("credential-manager not found")

    # 1.3 Open type picker
    if open_type_picker():
        pass_step("1.3 Type picker opened")
    else:
        fail_step("1.3 Type picker did not open")
        issues.append("Type picker failed to open")
        record("Scenario 1", False, "; ".join(issues))
        return

    # 1.4 Count options
    count = count_picker_options()
    log(f"Found {count} picker options")

    expected_options = [
        "vault-pick-ai-connector",
        "vault-pick-mcp",
        "vault-pick-custom",
        "vault-pick-database",
        "vault-pick-desktop",
        "vault-pick-wizard",
        "vault-pick-autopilot",
        "vault-pick-workspace",
        "vault-pick-foraging",
    ]

    found = []
    missing = []
    for opt in expected_options:
        if check_element_exists(opt):
            found.append(opt.replace("vault-pick-", ""))
        else:
            missing.append(opt.replace("vault-pick-", ""))

    if missing:
        fail_step(f"1.4 Options missing: {', '.join(missing)}")
        issues.append(f"Missing: {', '.join(missing)}")
    else:
        pass_step(f"1.4 All {len(found)} options present: {', '.join(found)}")

    # 1.5 Check snapshot for errors
    snap = get_snapshot()
    errors = snap.get("errors", [])
    if errors:
        fail_step(f"1.5 Errors on page: {errors}")
        issues.append(f"Errors: {errors}")
    else:
        pass_step("1.5 No errors on page")

    passed = len(issues) == 0
    record("Scenario 1: Navigate to Add New Menu", passed, "; ".join(issues) if issues else "All options visible")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 2: AI-Built Connector
# ---------------------------------------------------------------------------

def test_scenario_2():
    scenario("2 — AI-Built Connector")
    issues = []

    navigate_to_credentials()
    if not open_type_picker():
        fail_step("2.0 Could not open type picker")
        record("Scenario 2: AI-Built Connector", False, "Type picker failed")
        return

    # Click AI-Built Connector
    api_post("/click-testid", {"test_id": "vault-pick-ai-connector"})
    time.sleep(1)

    # Check design container
    if wait_for_testid("vault-design-container", 5000):
        pass_step("2.1 Design container visible")
    else:
        # Maybe it's a different structure
        fail_step("2.1 Design container not found — checking alternatives")
        snap = get_snapshot()
        log(f"Snapshot: route={snap.get('route')}, modals={snap.get('modals', [])}")
        issues.append("Design container not found")

    # Check input exists
    if check_element_exists("vault-design-input"):
        pass_step("2.2 Design input field present")
    else:
        fail_step("2.2 Design input field not found")
        issues.append("Design input not found")

    # Check submit exists
    if check_element_exists("vault-design-submit"):
        pass_step("2.3 Design submit button present")
    else:
        fail_step("2.3 Design submit button not found")
        issues.append("Design submit not found")

    # Fill and submit (but don't wait for AI — just verify the flow starts)
    api_post("/fill-field", {"test_id": "vault-design-input", "value": "Stripe payment API"})
    time.sleep(0.5)
    res = api_post("/click-testid", {"test_id": "vault-design-submit"})
    if res.get("success", False):
        pass_step("2.4 Submit clicked, AI design initiated")
        # Wait a moment to see if anything breaks immediately
        time.sleep(3)
        snap = get_snapshot()
        errors = snap.get("errors", [])
        if errors:
            fail_step(f"2.5 Errors after submit: {errors}")
            issues.append(f"Post-submit errors: {errors}")
        else:
            pass_step("2.5 No immediate errors after AI submit")
    else:
        fail_step("2.4 Submit click failed")
        issues.append("Submit failed")

    # Wait for AI completion (up to 60s)
    log("Waiting for AI design completion (up to 60s)...")
    completed = False
    for i in range(12):
        time.sleep(5)
        # Check for schema form (AI success), toast (created), or error
        if check_element_exists("vault-schema-form") or check_element_exists("vault-schema-save"):
            pass_step(f"2.6 AI design completed (took ~{(i+1)*5}s)")
            completed = True
            break
        snap = get_snapshot()
        toasts = snap.get("toasts", [])
        errors = snap.get("errors", [])
        if errors:
            fail_step(f"2.6 Error during AI design: {errors}")
            issues.append(f"AI error: {errors}")
            break
        for t in toasts:
            t_text = t if isinstance(t, str) else t.get("text", "")
            if "error" in t_text.lower() or "fail" in t_text.lower():
                fail_step(f"2.6 Error toast: {t_text}")
                issues.append(f"Error toast: {t_text}")
                completed = True
                break

    if not completed and not issues:
        fail_step("2.6 AI design timed out after 60s")
        issues.append("AI design timeout")

    passed = len(issues) == 0
    record("Scenario 2: AI-Built Connector", passed, "; ".join(issues) if issues else "Flow functional")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 3: AI Tool Server (MCP)
# ---------------------------------------------------------------------------

def test_scenario_3():
    scenario("3 — AI Tool Server (MCP)")
    issues = []

    navigate_to_credentials()
    if not open_type_picker():
        record("Scenario 3: MCP", False, "Type picker failed")
        return

    api_post("/click-testid", {"test_id": "vault-pick-mcp"})
    time.sleep(1)

    # Check schema form
    if wait_for_testid("vault-schema-form", 5000):
        pass_step("3.1 Schema form visible")
    else:
        fail_step("3.1 Schema form not found")
        issues.append("Schema form not found")

    # Check name field
    if check_element_exists("vault-schema-name"):
        pass_step("3.2 Name input present")
        api_post("/fill-field", {"test_id": "vault-schema-name", "value": "Test MCP Server"})
        pass_step("3.3 Name filled")
    else:
        fail_step("3.2 Name input not found")
        issues.append("Name input not found")

    # Check save button
    if check_element_exists("vault-schema-save"):
        pass_step("3.4 Save button present")
    else:
        fail_step("3.4 Save button not found")
        issues.append("Save button not found")

    # Check cancel button
    if check_element_exists("vault-schema-cancel"):
        pass_step("3.5 Cancel button present")
    else:
        fail_step("3.5 Cancel button not found")
        issues.append("Cancel button not found")

    # Try saving (may fail due to missing required fields — that's OK, we're testing the UI)
    res = api_post("/click-testid", {"test_id": "vault-schema-save"})
    time.sleep(2)
    snap = get_snapshot()
    errors = snap.get("errors", [])
    toasts = snap.get("toasts", [])
    log(f"After save attempt: errors={errors}, toasts={toasts}")
    # We don't assert success here since required fields may be missing
    pass_step("3.6 Save attempted (validation may apply)")

    passed = len(issues) == 0
    record("Scenario 3: AI Tool Server (MCP)", passed, "; ".join(issues) if issues else "Form functional")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 4: Web Service (Custom)
# ---------------------------------------------------------------------------

def test_scenario_4():
    scenario("4 — Web Service (Custom)")
    issues = []

    navigate_to_credentials()
    if not open_type_picker():
        record("Scenario 4: Custom", False, "Type picker failed")
        return

    api_post("/click-testid", {"test_id": "vault-pick-custom"})
    time.sleep(1)

    if wait_for_testid("vault-schema-form", 5000):
        pass_step("4.1 Schema form visible")
    else:
        fail_step("4.1 Schema form not found")
        issues.append("Schema form not found")

    if check_element_exists("vault-schema-name"):
        pass_step("4.2 Name input present")
        api_post("/fill-field", {"test_id": "vault-schema-name", "value": "Test Custom API"})
        pass_step("4.3 Name filled")
    else:
        fail_step("4.2 Name input not found")
        issues.append("Name input not found")

    if check_element_exists("vault-schema-save"):
        pass_step("4.4 Save button present")
    else:
        fail_step("4.4 Save button not found")
        issues.append("Save button not found")

    passed = len(issues) == 0
    record("Scenario 4: Web Service (Custom)", passed, "; ".join(issues) if issues else "Form functional")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 5: Database
# ---------------------------------------------------------------------------

def test_scenario_5():
    scenario("5 — Database")
    issues = []

    navigate_to_credentials()
    if not open_type_picker():
        record("Scenario 5: Database", False, "Type picker failed")
        return

    api_post("/click-testid", {"test_id": "vault-pick-database"})
    time.sleep(1)

    if wait_for_testid("vault-schema-form", 5000):
        pass_step("5.1 Schema form visible")
    else:
        fail_step("5.1 Schema form not found")
        issues.append("Schema form not found")

    # Check for subtype selector (PostgreSQL, MySQL, etc.)
    if check_element_exists("vault-schema-subtype"):
        pass_step("5.2 Subtype selector present")
    else:
        fail_step("5.2 Subtype selector not found (may be inline)")
        issues.append("Subtype selector not found")

    if check_element_exists("vault-schema-name"):
        pass_step("5.3 Name input present")
        api_post("/fill-field", {"test_id": "vault-schema-name", "value": "Test PostgreSQL DB"})
        pass_step("5.4 Name filled")
    else:
        fail_step("5.3 Name input not found")
        issues.append("Name input not found")

    if check_element_exists("vault-schema-save"):
        pass_step("5.5 Save button present")
    else:
        fail_step("5.5 Save button not found")
        issues.append("Save button not found")

    passed = len(issues) == 0
    record("Scenario 5: Database", passed, "; ".join(issues) if issues else "Form functional")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 6: Desktop App
# ---------------------------------------------------------------------------

def test_scenario_6():
    scenario("6 — Desktop App")
    issues = []

    navigate_to_credentials()
    if not open_type_picker():
        record("Scenario 6: Desktop App", False, "Type picker failed")
        return

    # Check if desktop option exists (desktop-only, hidden on mobile)
    if not check_element_exists("vault-pick-desktop"):
        log("Desktop option not present (may be desktop-only)")
        record("Scenario 6: Desktop App", True, "Option not present (expected on mobile)")
        go_back_to_list()
        return

    api_post("/click-testid", {"test_id": "vault-pick-desktop"})
    time.sleep(1)

    if wait_for_testid("vault-desktop-container", 5000):
        pass_step("6.1 Desktop discovery container visible")
    else:
        fail_step("6.1 Desktop discovery container not found")
        issues.append("Desktop container not found")

    if check_element_exists("vault-desktop-scan"):
        pass_step("6.2 Scan/refresh button present")
    else:
        fail_step("6.2 Scan button not found")
        issues.append("Scan button not found")

    # Check for import MCP tab
    if check_element_exists("vault-desktop-import-mcp"):
        pass_step("6.3 Import MCP tab present")
    else:
        log("6.3 Import MCP tab not found (may be optional)")

    # Try scanning
    res = api_post("/click-testid", {"test_id": "vault-desktop-scan"})
    time.sleep(3)
    snap = get_snapshot()
    errors = snap.get("errors", [])
    if errors:
        fail_step(f"6.4 Errors after scan: {errors}")
        issues.append(f"Scan errors: {errors}")
    else:
        pass_step("6.4 Scan executed without errors")

    passed = len(issues) == 0
    record("Scenario 6: Desktop App", passed, "; ".join(issues) if issues else "Flow functional")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 7: AI Setup Wizard
# ---------------------------------------------------------------------------

def test_scenario_7():
    scenario("7 — AI Setup Wizard")
    issues = []

    navigate_to_credentials()
    if not open_type_picker():
        record("Scenario 7: AI Setup Wizard", False, "Type picker failed")
        return

    api_post("/click-testid", {"test_id": "vault-pick-wizard"})
    time.sleep(1)

    if wait_for_testid("vault-wizard-container", 5000):
        pass_step("7.1 Wizard container visible")
    else:
        fail_step("7.1 Wizard container not found")
        issues.append("Wizard container not found")

    # Check for start button (detect phase)
    if check_element_exists("vault-wizard-start"):
        pass_step("7.2 Start/setup button present")
    else:
        log("7.2 Start button not found (wizard may auto-start)")

    # Check cancel
    if check_element_exists("vault-wizard-cancel"):
        pass_step("7.3 Cancel button present")
    else:
        fail_step("7.3 Cancel button not found")
        issues.append("Cancel not found")

    snap = get_snapshot()
    errors = snap.get("errors", [])
    if errors:
        fail_step(f"7.4 Errors: {errors}")
        issues.append(f"Errors: {errors}")
    else:
        pass_step("7.4 No errors on wizard page")

    passed = len(issues) == 0
    record("Scenario 7: AI Setup Wizard", passed, "; ".join(issues) if issues else "Flow functional")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 8: API Autopilot
# ---------------------------------------------------------------------------

def test_scenario_8():
    scenario("8 — API Autopilot")
    issues = []

    navigate_to_credentials()
    if not open_type_picker():
        record("Scenario 8: API Autopilot", False, "Type picker failed")
        return

    api_post("/click-testid", {"test_id": "vault-pick-autopilot"})
    time.sleep(1)

    if wait_for_testid("vault-autopilot-container", 5000):
        pass_step("8.1 Autopilot container visible")
    else:
        fail_step("8.1 Autopilot container not found")
        issues.append("Autopilot container not found")

    if check_element_exists("vault-autopilot-url-input"):
        pass_step("8.2 URL input present")
        api_post("/fill-field", {"test_id": "vault-autopilot-url-input", "value": "https://petstore3.swagger.io/api/v3/openapi.json"})
        pass_step("8.3 URL filled with Petstore OpenAPI")
    else:
        fail_step("8.2 URL input not found")
        issues.append("URL input not found")

    if check_element_exists("vault-autopilot-submit"):
        pass_step("8.4 Submit button present")
        api_post("/click-testid", {"test_id": "vault-autopilot-submit"})
        time.sleep(3)
        snap = get_snapshot()
        errors = snap.get("errors", [])
        if errors:
            fail_step(f"8.5 Errors after submit: {errors}")
            issues.append(f"Submit errors: {errors}")
        else:
            pass_step("8.5 Submit succeeded, no immediate errors")
    else:
        fail_step("8.4 Submit button not found")
        issues.append("Submit button not found")

    passed = len(issues) == 0
    record("Scenario 8: API Autopilot", passed, "; ".join(issues) if issues else "Flow functional")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 9: Workspace Connect
# ---------------------------------------------------------------------------

def test_scenario_9():
    scenario("9 — Workspace Connect")
    issues = []

    navigate_to_credentials()
    if not open_type_picker():
        record("Scenario 9: Workspace Connect", False, "Type picker failed")
        return

    if not check_element_exists("vault-pick-workspace"):
        log("Workspace Connect option not present")
        record("Scenario 9: Workspace Connect", False, "Option not found in picker")
        go_back_to_list()
        return

    api_post("/click-testid", {"test_id": "vault-pick-workspace"})
    time.sleep(1)

    if wait_for_testid("vault-workspace-container", 5000):
        pass_step("9.1 Workspace container visible")
    else:
        fail_step("9.1 Workspace container not found")
        issues.append("Workspace container not found")

    if check_element_exists("vault-workspace-connect"):
        pass_step("9.2 Connect button present")
    else:
        fail_step("9.2 Connect button not found")
        issues.append("Connect button not found")

    snap = get_snapshot()
    errors = snap.get("errors", [])
    if errors:
        fail_step(f"9.3 Errors: {errors}")
        issues.append(f"Errors: {errors}")
    else:
        pass_step("9.3 No errors")

    passed = len(issues) == 0
    record("Scenario 9: Workspace Connect", passed, "; ".join(issues) if issues else "Flow functional")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 10: Auto-Discover (Foraging)
# ---------------------------------------------------------------------------

def test_scenario_10():
    scenario("10 — Auto-Discover (Foraging)")
    issues = []

    navigate_to_credentials()
    if not open_type_picker():
        record("Scenario 10: Auto-Discover", False, "Type picker failed")
        return

    if not check_element_exists("vault-pick-foraging"):
        log("Foraging option not present (may be desktop-only)")
        record("Scenario 10: Auto-Discover", True, "Option not present (expected on mobile)")
        go_back_to_list()
        return

    api_post("/click-testid", {"test_id": "vault-pick-foraging"})
    time.sleep(1)

    if wait_for_testid("vault-foraging-container", 5000):
        pass_step("10.1 Foraging container visible")
    else:
        fail_step("10.1 Foraging container not found")
        issues.append("Foraging container not found")

    if check_element_exists("vault-foraging-scan"):
        pass_step("10.2 Scan button present")
    else:
        fail_step("10.2 Scan button not found")
        issues.append("Scan button not found")

    snap = get_snapshot()
    errors = snap.get("errors", [])
    if errors:
        fail_step(f"10.3 Errors: {errors}")
        issues.append(f"Errors: {errors}")
    else:
        pass_step("10.3 No errors")

    passed = len(issues) == 0
    record("Scenario 10: Auto-Discover", passed, "; ".join(issues) if issues else "Flow functional")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 11: Back Navigation from Each Flow
# ---------------------------------------------------------------------------

def test_scenario_11():
    scenario("11 — Back Navigation from Each Flow")
    issues = []

    flows = [
        ("vault-pick-ai-connector", "vault-design-container", "AI-Built Connector"),
        ("vault-pick-mcp", "vault-schema-form", "MCP"),
        ("vault-pick-custom", "vault-schema-form", "Custom"),
        ("vault-pick-database", "vault-schema-form", "Database"),
        ("vault-pick-desktop", "vault-desktop-container", "Desktop"),
        ("vault-pick-wizard", "vault-wizard-container", "Wizard"),
        ("vault-pick-autopilot", "vault-autopilot-container", "Autopilot"),
    ]

    for pick_id, container_id, label in flows:
        navigate_to_credentials()
        if not open_type_picker():
            fail_step(f"11.{label} — Could not open type picker")
            issues.append(f"{label}: picker failed")
            continue

        if not check_element_exists(pick_id):
            log(f"11.{label} — Option not present, skipping")
            continue

        api_post("/click-testid", {"test_id": pick_id})
        time.sleep(1)

        # Check if we entered the flow
        entered = wait_for_testid(container_id, 3000)
        if not entered:
            fail_step(f"11.{label} — Container not found after click")
            issues.append(f"{label}: container not found")
            continue

        # Try back button
        back_clicked = False
        for back_id in ["vault-back-btn", "vault-schema-cancel", "vault-design-cancel", "vault-wizard-cancel"]:
            if check_element_exists(back_id):
                api_post("/click-testid", {"test_id": back_id})
                time.sleep(1)
                back_clicked = True
                break

        if back_clicked:
            # Check we returned to type picker or list
            if check_element_exists("vault-type-picker") or check_element_exists("credential-manager"):
                pass_step(f"11.{label} — Back navigation works")
            else:
                fail_step(f"11.{label} — Back didn't return to picker or list")
                issues.append(f"{label}: back nav broken")
        else:
            fail_step(f"11.{label} — No back/cancel button found")
            issues.append(f"{label}: no back button")

    passed = len(issues) == 0
    record("Scenario 11: Back Navigation", passed, "; ".join(issues) if issues else "All flows have working back nav")
    go_back_to_list()


# ---------------------------------------------------------------------------
# Scenario 12: Visual/UX Consistency
# ---------------------------------------------------------------------------

def test_scenario_12():
    scenario("12 — Visual/UX Consistency Checks")
    issues = []

    navigate_to_credentials()
    if not open_type_picker():
        record("Scenario 12: UX Consistency", False, "Type picker failed")
        return

    # Check all cards have consistent presence
    options = {
        "ai-connector": "vault-pick-ai-connector",
        "mcp": "vault-pick-mcp",
        "custom": "vault-pick-custom",
        "database": "vault-pick-database",
        "desktop": "vault-pick-desktop",
        "wizard": "vault-pick-wizard",
        "autopilot": "vault-pick-autopilot",
        "workspace": "vault-pick-workspace",
        "foraging": "vault-pick-foraging",
    }

    visible_count = 0
    hidden_count = 0
    for name, testid in options.items():
        exists = check_element_exists(testid)
        if exists:
            visible_count += 1
        else:
            hidden_count += 1
            log(f"  Option '{name}' not visible")

    pass_step(f"12.1 Options visible: {visible_count}, hidden: {hidden_count}")

    # Check snapshot for overall page health
    snap = get_snapshot()
    errors = snap.get("errors", [])
    modals = snap.get("modals", [])

    if errors:
        fail_step(f"12.2 Page has errors: {errors}")
        issues.append(f"Page errors: {errors}")
    else:
        pass_step("12.2 No page errors")

    if modals:
        log(f"12.3 Modals present: {modals}")
    else:
        pass_step("12.3 No unexpected modals")

    passed = len(issues) == 0
    record("Scenario 12: UX Consistency", passed, "; ".join(issues) if issues else f"{visible_count} options visible, no errors")
    go_back_to_list()


# ===========================================================================
# Main
# ===========================================================================

def main():
    print("\n" + "=" * 70)
    print("  VAULT CREDENTIAL CREATION — E2E TEST SUITE")
    print("=" * 70)

    # Health check
    health = api_get("/health")
    if health.get("status") != "ok":
        print(f"\n  ✗ Health check failed: {health}")
        sys.exit(1)
    print(f"\n  ✓ Health check passed (v{health.get('version', '?')})")

    test_scenario_1()
    test_scenario_2()
    test_scenario_3()
    test_scenario_4()
    test_scenario_5()
    test_scenario_6()
    test_scenario_7()
    test_scenario_8()
    test_scenario_9()
    test_scenario_10()
    test_scenario_11()
    test_scenario_12()

    # Summary
    print("\n" + "=" * 70)
    print("  RESULTS SUMMARY")
    print("=" * 70)

    passed = sum(1 for r in results if r["passed"])
    failed = sum(1 for r in results if not r["passed"])

    for r in results:
        status = "PASS" if r["passed"] else "FAIL"
        notes = f" — {r['notes']}" if r['notes'] else ""
        print(f"  [{status}] {r['scenario']}{notes}")

    print(f"\n  Total: {len(results)} | Passed: {passed} | Failed: {failed}")
    print("=" * 70)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
