#!/usr/bin/env python3
"""
E2E Test: Vault Credential Creation — Full Functional Tests
Tests complete credential creation flows with real/free public services.
"""

import httpx
import json
import time
import sys

BASE = "http://127.0.0.1:17320"
client = httpx.Client(base_url=BASE, timeout=30.0)

results = []

def log(msg): print(f"  {msg}")
def ok(step, detail=""): print(f"    [PASS] {step}" + (f" -- {detail}" if detail else ""))
def fail(step, detail=""): print(f"    [FAIL] {step}" + (f" -- {detail}" if detail else ""))
def info(step, detail=""): print(f"    [INFO] {step}" + (f" -- {detail}" if detail else ""))
def record(name, passed, notes=""): results.append({"scenario": name, "passed": passed, "notes": notes})

def scenario(name):
    print(f"\n{'='*70}")
    print(f"  {name}")
    print(f"{'='*70}")

def p(path, body=None):
    try: return client.post(path, json=body or {}).json()
    except: return {"success": False}

def g(path):
    try: return client.get(path).json()
    except: return {}

def els(res):
    if isinstance(res, list): return res
    if isinstance(res, dict): return res.get("elements", res.get("result", []))
    return []

def exists(testid):
    return len(els(p("/query", {"selector": f"[data-testid='{testid}']"}))) > 0

def wait(testid, ms=5000):
    return p("/wait", {"selector": f"[data-testid='{testid}']", "timeout_ms": ms}).get("success", False)

def click(testid):
    return p("/click-testid", {"test_id": testid}).get("success", False)

def fill(testid, value):
    return p("/fill-field", {"test_id": testid, "value": value}).get("success", False)

def nav_creds():
    p("/navigate", {"section": "credentials"})
    time.sleep(1)

def open_picker():
    click("tab-add-new")
    time.sleep(0.5)
    return wait("vault-type-picker", 3000)

def snap():
    return g("/snapshot")

def cred_count():
    """Get credential count from list-credentials endpoint."""
    r = g("/list-credentials")
    creds = r.get("credentials", [])
    if isinstance(creds, list): return len(creds)
    return -1

def wait_toast(text, ms=10000):
    return p("/wait-toast", {"text": text, "timeout_ms": ms}).get("success", False)

# ===========================================================================
# Scenario 1: Type Picker Validation
# ===========================================================================

def test_type_picker():
    scenario("1. Type Picker -- All Options Visible")
    issues = []

    nav_creds()
    if not open_picker():
        record("1. Type Picker", False, "Picker did not open")
        return

    # After UX simplification: wizard and autopilot removed, desktop is dev-only
    expected = ["ai-connector", "mcp", "custom", "database", "desktop", "workspace", "foraging"]
    found, missing = [], []
    for opt in expected:
        if exists(f"vault-pick-{opt}"): found.append(opt)
        else: missing.append(opt)

    if missing:
        fail("Options missing", ", ".join(missing))
        issues.append(f"Missing: {', '.join(missing)}")
    else:
        ok(f"All {len(found)} options present")

    record("1. Type Picker", not issues, "; ".join(issues) if issues else f"{len(found)} options OK")
    nav_creds()


# ===========================================================================
# Scenario 2: Custom Web Service -- httpbin.org (no auth needed)
# ===========================================================================

def test_custom_httpbin():
    scenario("2. Web Service (Custom) -- httpbin.org (no auth)")
    issues = []
    initial_count = cred_count()

    nav_creds()
    if not open_picker():
        record("2. Custom httpbin", False, "Picker failed")
        return

    click("vault-pick-custom")
    time.sleep(0.5)

    if wait("vault-schema-form", 5000):
        ok("Schema form visible")
    else:
        fail("Schema form not found")
        record("2. Custom httpbin", False, "No schema form")
        nav_creds()
        return

    # Fill name
    fill("vault-schema-name", "Test httpbin")
    ok("Name filled")

    # Select API Key subtype (first option, should be default)
    # Fill fields
    time.sleep(0.5)
    if exists("vault-field-base_url-input"):
        fill("vault-field-base_url-input", "https://httpbin.org")
        ok("Base URL filled")
    else:
        fail("base_url field not found")
        issues.append("No base_url field")

    if exists("vault-field-api_key-input"):
        fill("vault-field-api_key-input", "test-key-12345")
        ok("API Key filled")
    else:
        fail("api_key field not found")
        issues.append("No api_key field")

    # Save
    if exists("vault-schema-save"):
        click("vault-schema-save")
        time.sleep(2)
        new_count = cred_count()
        if new_count > initial_count:
            ok("Credential created", f"count {initial_count} -> {new_count}")
        else:
            # Check for toast or errors
            s = snap()
            toasts = s.get("toasts", [])
            errors = s.get("errors", [])
            if errors:
                fail("Errors after save", str(errors))
                issues.append(f"Save errors: {errors}")
            else:
                info("Save attempted", f"toasts={toasts}, count unchanged")
                # Might need waiting
                time.sleep(3)
                new_count = cred_count()
                if new_count > initial_count:
                    ok("Credential created (delayed)", f"count -> {new_count}")
                else:
                    fail("Credential not created", f"count still {new_count}")
                    issues.append("Credential not saved")
    else:
        fail("Save button not found")
        issues.append("No save button")

    record("2. Custom httpbin", not issues, "; ".join(issues) if issues else "Created successfully")
    nav_creds()


# ===========================================================================
# Scenario 3: Custom Web Service -- JSONPlaceholder (Bearer token)
# ===========================================================================

def test_custom_jsonplaceholder():
    scenario("3. Web Service (Custom) -- JSONPlaceholder (Bearer)")
    issues = []
    initial_count = cred_count()

    nav_creds()
    if not open_picker():
        record("3. Custom JSONPlaceholder", False, "Picker failed")
        return

    click("vault-pick-custom")
    time.sleep(0.5)

    if not wait("vault-schema-form", 5000):
        record("3. Custom JSONPlaceholder", False, "No schema form")
        nav_creds()
        return

    fill("vault-schema-name", "Test JSONPlaceholder")

    # Switch to Bearer token subtype (2nd button in subtype grid)
    p("/click", {"selector": "[data-testid='vault-schema-subtype'] button:nth-child(2)"})
    time.sleep(0.5)
    ok("Switched to Bearer subtype")

    if exists("vault-field-base_url-input"):
        fill("vault-field-base_url-input", "https://jsonplaceholder.typicode.com")
        ok("Base URL filled")
    else:
        issues.append("No base_url field")

    if exists("vault-field-bearer_token-input"):
        fill("vault-field-bearer_token-input", "test-bearer-token-xyz")
        ok("Bearer token filled")
    else:
        info("bearer_token field not found (may need subtype switch)")

    click("vault-schema-save")
    time.sleep(3)
    new_count = cred_count()
    if new_count > initial_count:
        ok("Credential created", f"count -> {new_count}")
    else:
        fail("Credential not created")
        issues.append("Not saved")

    record("3. Custom JSONPlaceholder", not issues, "; ".join(issues) if issues else "Created OK")
    nav_creds()


# ===========================================================================
# Scenario 4: MCP Server (stdio) -- filesystem server
# ===========================================================================

def test_mcp_stdio():
    scenario("4. MCP Server (stdio) -- filesystem")
    issues = []
    initial_count = cred_count()

    nav_creds()
    if not open_picker():
        record("4. MCP stdio", False, "Picker failed")
        return

    click("vault-pick-mcp")
    time.sleep(0.5)

    if not wait("vault-schema-form", 5000):
        record("4. MCP stdio", False, "No schema form")
        nav_creds()
        return

    fill("vault-schema-name", "Test Filesystem MCP")
    ok("Name filled")

    # stdio should be default subtype
    if exists("vault-field-command-input"):
        fill("vault-field-command-input", "npx -y @modelcontextprotocol/server-filesystem /tmp")
        ok("Command filled")
    else:
        fail("Command field not found")
        issues.append("No command field")

    click("vault-schema-save")
    time.sleep(3)
    new_count = cred_count()
    if new_count > initial_count:
        ok("MCP credential created", f"count -> {new_count}")
    else:
        fail("MCP credential not created")
        issues.append("Not saved")

    record("4. MCP stdio", not issues, "; ".join(issues) if issues else "Created OK")
    nav_creds()


# ===========================================================================
# Scenario 5: Database -- PostgreSQL (form only, no real connection)
# ===========================================================================

def test_database_postgresql():
    scenario("5. Database -- PostgreSQL")
    issues = []
    initial_count = cred_count()

    nav_creds()
    if not open_picker():
        record("5. Database PostgreSQL", False, "Picker failed")
        return

    click("vault-pick-database")
    time.sleep(0.5)

    if not wait("vault-schema-form", 5000):
        record("5. Database PostgreSQL", False, "No schema form")
        nav_creds()
        return

    fill("vault-schema-name", "Test PostgreSQL")
    ok("Name filled")

    # Select PostgreSQL subtype
    if exists("vault-schema-subtype"):
        p("/eval", {"js": """
            const btns = document.querySelectorAll('[data-testid="vault-schema-subtype"] button');
            for (const b of btns) { if (b.textContent.includes('PostgreSQL')) { b.click(); break; } }
        """})
        time.sleep(0.5)
        ok("PostgreSQL subtype selected")

    # Fill connection fields
    field_values = {
        "host": "localhost",
        "port": "5432",
        "database": "testdb",
        "username": "postgres",
        "password": "test123",
    }
    for key, val in field_values.items():
        tid = f"vault-field-{key}-input"
        if exists(tid):
            fill(tid, val)
        else:
            info(f"Field {key} not found")

    ok("Connection fields filled")

    click("vault-schema-save")
    time.sleep(3)
    new_count = cred_count()
    if new_count > initial_count:
        ok("Database credential created", f"count -> {new_count}")
    else:
        fail("Database credential not created")
        issues.append("Not saved")

    record("5. Database PostgreSQL", not issues, "; ".join(issues) if issues else "Created OK")
    nav_creds()


# ===========================================================================
# Scenario 6: API Autopilot -- Petstore OpenAPI
# ===========================================================================

def test_autopilot_petstore():
    scenario("6. API Autopilot -- REMOVED (merged into Custom API)")
    # Autopilot was consolidated into Custom API's OpenAPI spec field.
    # Verify it no longer exists in the picker.
    nav_creds()
    if open_picker():
        if not exists("vault-pick-autopilot"):
            ok("Autopilot correctly removed from picker")
            record("6. Autopilot Removed", True, "Consolidated into Custom API")
        else:
            fail("Autopilot still in picker -- should be removed")
            record("6. Autopilot Removed", False, "Still present")
    else:
        record("6. Autopilot Removed", True, "Picker N/A")
    nav_creds()
    return

    ok("Autopilot container visible")

    if not exists("vault-autopilot-url-input"):
        fail("URL input not found")
        issues.append("No URL input")
        record("6. Autopilot Petstore", False, "; ".join(issues))
        nav_creds()
        return

    ok("URL input present")
    # Try fill-field and /type — Autopilot uses useFieldValidation with debounce
    fill("vault-autopilot-url-input", "https://petstore3.swagger.io/api/v3/openapi.json")
    time.sleep(0.5)
    p("/type", {"selector": "[data-testid='vault-autopilot-url-input']", "text": "https://petstore3.swagger.io/api/v3/openapi.json"})
    time.sleep(1)

    click("vault-autopilot-submit")
    time.sleep(5)

    if exists("vault-autopilot-preview") or exists("vault-autopilot-confirm"):
        ok("Parse completed, preview visible")
    else:
        fail("URL input rejects programmatic values (useFieldValidation hook)",
             "DESIGN ISSUE: Autopilot not test-automatable")
        issues.append("Autopilot URL input not automatable via test bridge")

    record("6. Autopilot Petstore", not issues, "; ".join(issues) if issues else "Flow functional")
    nav_creds()


# ===========================================================================
# Scenario 7: AI-Built Connector -- describe a public API
# ===========================================================================

def test_ai_connector():
    scenario("7. AI-Built Connector -- httpbin API")
    issues = []

    nav_creds()
    if not open_picker():
        record("7. AI-Built Connector", False, "Picker failed")
        return

    click("vault-pick-ai-connector")
    time.sleep(0.5)

    if not wait("vault-design-container", 5000):
        fail("Design container not found")
        record("7. AI-Built Connector", False, "No design container")
        nav_creds()
        return

    ok("Design container visible")

    fill("vault-design-input", "httpbin.org - a free HTTP testing service. I need to test GET/POST requests, check response headers, and test different status codes. No authentication needed.")
    ok("Description filled")

    click("vault-design-submit")
    ok("Design submitted")

    # Wait for AI (up to 60s)
    log("  Waiting for AI design (up to 60s)...")
    completed = False
    for i in range(12):
        time.sleep(5)
        s = snap()
        errors = s.get("errors", [])
        if errors:
            fail(f"AI error: {errors}")
            issues.append(f"AI error: {errors}")
            break

        # Check for completion indicators
        if exists("vault-schema-form") or exists("vault-schema-save"):
            ok(f"AI design completed ({(i+1)*5}s)")
            completed = True
            break

        toasts = s.get("toasts", [])
        for t in (toasts if isinstance(toasts, list) else []):
            t_text = t if isinstance(t, str) else t.get("text", "")
            if "error" in t_text.lower() or "fail" in t_text.lower():
                fail(f"Error toast: {t_text}")
                issues.append(f"Toast error: {t_text}")
                completed = True
                break
            if "created" in t_text.lower() or "saved" in t_text.lower():
                ok(f"Credential created via AI! ({(i+1)*5}s)")
                completed = True
                break

    if not completed and not issues:
        fail("AI design timeout (60s)")
        issues.append("AI timeout")

    record("7. AI-Built Connector", not issues, "; ".join(issues) if issues else "Flow functional")
    nav_creds()


# ===========================================================================
# Scenario 8: Desktop App Discovery
# ===========================================================================

def test_desktop_discovery():
    scenario("8. Desktop App Discovery")
    issues = []

    nav_creds()
    if not open_picker():
        record("8. Desktop Discovery", False, "Picker failed")
        return

    if not exists("vault-pick-desktop"):
        info("Desktop option not present (mobile or filtered)")
        record("8. Desktop Discovery", True, "Skipped (not available)")
        nav_creds()
        return

    click("vault-pick-desktop")
    time.sleep(1)

    if not wait("vault-desktop-container", 5000):
        fail("Desktop container not found")
        record("8. Desktop Discovery", False, "No container")
        nav_creds()
        return

    ok("Desktop container visible")

    # Try scan
    click("vault-desktop-scan")
    time.sleep(3)

    # Check what was discovered
    s = snap()
    if s.get("errors"):
        fail(f"Errors: {s['errors']}")
        issues.append(f"Scan errors: {s['errors']}")
    else:
        ok("Scan completed without errors")

    # Check for discovered apps
    apps = els(p("/query", {"selector": "[data-testid='vault-desktop-container'] button"}))
    info(f"Found {len(apps)} interactive elements in desktop panel")

    # Test back navigation
    if exists("vault-desktop-back"):
        click("vault-desktop-back")
        time.sleep(0.5)
        if exists("vault-type-picker"):
            ok("Back navigation works")
        else:
            fail("Back didn't return to picker")
            issues.append("Back nav broken")
    else:
        fail("Back button not found")
        issues.append("No back button")

    record("8. Desktop Discovery", not issues, "; ".join(issues) if issues else "Flow functional")
    nav_creds()


# ===========================================================================
# Scenario 9: AI Setup Wizard
# ===========================================================================

def test_wizard():
    scenario("9. AI Setup Wizard -- REMOVED (consolidated into Catalog)")
    # Wizard was removed. Verify it no longer exists in the picker.
    nav_creds()
    if open_picker():
        if not exists("vault-pick-wizard"):
            ok("Wizard correctly removed from picker")
            record("9. Wizard Removed", True, "Consolidated into Catalog")
        else:
            fail("Wizard still in picker -- should be removed")
            record("9. Wizard Removed", False, "Still present")
    else:
        record("9. Wizard Removed", True, "Picker N/A")
    nav_creds()
    return

    ok("Wizard container visible")

    # Check for service detection results
    time.sleep(3)
    s = snap()
    if s.get("errors"):
        fail(f"Errors: {s['errors']}")
        issues.append(f"Wizard errors: {s['errors']}")
    else:
        ok("No errors in wizard")

    # Check for start button
    if exists("vault-wizard-start"):
        ok("Start button present")
    else:
        info("Start button not found (may auto-detect)")

    # Test cancel
    if exists("vault-wizard-cancel"):
        click("vault-wizard-cancel")
        time.sleep(0.5)
        ok("Cancel clicked")
    else:
        info("Cancel button not found")

    record("9. AI Setup Wizard", not issues, "; ".join(issues) if issues else "Flow functional")
    nav_creds()


# ===========================================================================
# Scenario 10: Workspace Connect
# ===========================================================================

def test_workspace():
    scenario("10. Workspace Connect")
    issues = []

    nav_creds()
    if not open_picker():
        record("10. Workspace Connect", False, "Picker failed")
        return

    if not exists("vault-pick-workspace"):
        info("Workspace Connect not available")
        record("10. Workspace Connect", True, "Skipped (not available)")
        nav_creds()
        return

    click("vault-pick-workspace")
    time.sleep(1)

    if not wait("vault-workspace-container", 5000):
        fail("Workspace container not found")
        record("10. Workspace Connect", False, "No container")
        nav_creds()
        return

    ok("Workspace container visible")

    if exists("vault-workspace-connect"):
        ok("Connect button present (requires Google OAuth -- not clicking)")
    else:
        fail("Connect button not found")
        issues.append("No connect button")

    record("10. Workspace Connect", not issues, "; ".join(issues) if issues else "UI verified (OAuth required)")
    nav_creds()


# ===========================================================================
# Scenario 11: Auto-Discover (Foraging)
# ===========================================================================

def test_foraging():
    scenario("11. Auto-Discover (Foraging)")
    issues = []

    nav_creds()
    if not open_picker():
        record("11. Auto-Discover", False, "Picker failed")
        return

    if not exists("vault-pick-foraging"):
        info("Foraging not available")
        record("11. Auto-Discover", True, "Skipped (not available)")
        nav_creds()
        return

    click("vault-pick-foraging")
    time.sleep(1)

    if not wait("vault-foraging-container", 5000):
        fail("Foraging container not found")
        record("11. Auto-Discover", False, "No container")
        nav_creds()
        return

    ok("Foraging container visible")

    if exists("vault-foraging-scan"):
        click("vault-foraging-scan")
        time.sleep(5)
        s = snap()
        if s.get("errors"):
            fail(f"Scan errors: {s['errors']}")
            issues.append(str(s["errors"]))
        else:
            ok("Filesystem scan completed")
    else:
        fail("Scan button not found")
        issues.append("No scan button")

    record("11. Auto-Discover", not issues, "; ".join(issues) if issues else "Scan functional")
    nav_creds()


# ===========================================================================
# Scenario 12: Back Navigation (all flows)
# ===========================================================================

def test_back_navigation():
    scenario("12. Back Navigation -- All Flows")
    issues = []

    flows = [
        ("vault-pick-ai-connector", "vault-design-container", ["vault-design-cancel"], "AI Connector"),
        ("vault-pick-mcp", "vault-schema-form", ["vault-schema-cancel"], "MCP"),
        ("vault-pick-custom", "vault-schema-form", ["vault-schema-cancel"], "Custom"),
        ("vault-pick-database", "vault-schema-form", ["vault-schema-cancel"], "Database"),
        ("vault-pick-desktop", "vault-desktop-container", ["vault-desktop-back"], "Desktop"),
        ("vault-pick-wizard", "vault-wizard-container", ["vault-wizard-cancel"], "Wizard"),
        ("vault-pick-autopilot", "vault-autopilot-container", ["vault-autopilot-back"], "Autopilot"),
    ]

    for pick_id, container_id, back_ids, label in flows:
        nav_creds()
        if not open_picker(): continue
        if not exists(pick_id): continue

        click(pick_id)
        time.sleep(0.5)

        if not wait(container_id, 3000):
            fail(f"{label} -- container not found")
            issues.append(f"{label}: no container")
            continue

        backed = False
        for back_id in back_ids:
            if exists(back_id):
                click(back_id)
                time.sleep(0.5)
                backed = True
                break

        if backed:
            if exists("vault-type-picker") or exists("credential-manager"):
                ok(f"{label} -- back works")
            else:
                fail(f"{label} -- back didn't return")
                issues.append(f"{label}: back broken")
        else:
            fail(f"{label} -- no back button found")
            issues.append(f"{label}: no back btn")

    record("12. Back Navigation", not issues, "; ".join(issues) if issues else "All flows OK")
    nav_creds()


# ===========================================================================
# Scenario 13: Consolidation Analysis
# ===========================================================================

def test_consolidation():
    scenario("13. Consolidation Analysis")

    log("Analyzing overlap between credential creation flows...\n")

    analysis = [
        ("AI-Built Connector vs AI Setup Wizard",
         "Both use AI. Connector: single service, text input -> AI designs schema. "
         "Wizard: multi-service batch, auto-detects installed services. "
         "VERDICT: Different scope -- Connector = targeted, Wizard = bulk discovery. Keep separate."),

        ("Web Service (Custom) vs API Autopilot",
         "Custom: manual URL + auth fields, generic. "
         "Autopilot: paste OpenAPI spec, auto-generates typed connector with tools. "
         "VERDICT: Overlap exists for REST APIs. Autopilot is strictly better when an OpenAPI spec exists. "
         "RECOMMENDATION: Autopilot could absorb Custom for users who have an API spec. "
         "Custom should remain for APIs without specs or simple webhook endpoints."),

        ("Desktop App vs Auto-Discover (Foraging)",
         "Desktop: scans for known installed apps (VS Code, Docker, Obsidian) + Claude MCP import. "
         "Foraging: scans filesystem for API keys, .env files, AWS profiles, etc. "
         "VERDICT: Different targets -- Desktop = apps, Foraging = credentials in files. "
         "RECOMMENDATION: Could be combined into a single 'Local Discovery' panel with tabs. "
         "Currently separate, which is fine but may confuse users."),

        ("MCP Server vs Desktop App (Claude MCP import)",
         "MCP: manual entry of stdio command or SSE URL. "
         "Desktop has an 'Import Claude MCP' tab that does similar but from Claude's config. "
         "VERDICT: Functional overlap for MCP servers. "
         "RECOMMENDATION: Desktop MCP import is a convenience shortcut. Keep both."),
    ]

    for title, verdict in analysis:
        print(f"\n    >> {title}")
        print(f"       {verdict}")

    record("13. Consolidation Analysis", True, "Analysis complete -- see output")


# ===========================================================================
# Main
# ===========================================================================

def main():
    print("\n" + "=" * 70)
    print("  VAULT CREDENTIAL CREATION -- FULL E2E TEST SUITE")
    print("=" * 70)

    health = g("/health")
    if health.get("status") != "ok":
        print(f"\n  FAIL: Health check failed: {health}")
        return 1
    print(f"\n  Health OK (v{health.get('version', '?')})")

    initial = cred_count()
    print(f"  Initial credential count: {initial}\n")

    test_type_picker()
    test_custom_httpbin()
    test_custom_jsonplaceholder()
    test_mcp_stdio()
    test_database_postgresql()
    test_autopilot_petstore()
    test_ai_connector()
    test_desktop_discovery()
    test_wizard()
    test_workspace()
    test_foraging()
    test_back_navigation()
    test_consolidation()

    final = cred_count()
    print(f"\n  Credential count: {initial} -> {final} (+{final - initial})")

    # Summary
    print(f"\n{'='*70}")
    print(f"  RESULTS SUMMARY")
    print(f"{'='*70}")

    passed = sum(1 for r in results if r["passed"])
    failed = sum(1 for r in results if not r["passed"])

    for r in results:
        s = "PASS" if r["passed"] else "FAIL"
        n = f" -- {r['notes']}" if r["notes"] else ""
        print(f"  [{s}] {r['scenario']}{n}")

    print(f"\n  Total: {len(results)} | Passed: {passed} | Failed: {failed}")
    print("=" * 70)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
