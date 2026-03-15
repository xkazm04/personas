"""Smoke test for Personas Test Automation Framework"""
import httpx
import json
import time
import sys

BASE = "http://127.0.0.1:17320"
c = httpx.Client(base_url=BASE, timeout=20)
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


# ============================================================
# 1. HEALTH CHECK
# ============================================================
print("\n=== 1. Health Check ===")


def test_health():
    r = c.get("/health")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok"
    return f"server={d['server']}"


test("health endpoint responds", test_health)


# ============================================================
# 2. NAVIGATE - all valid sections
# ============================================================
print("\n=== 2. Navigate (all sections) ===")
sections = [
    "home", "overview", "personas", "events", "credentials",
    "design-reviews", "team", "cloud", "settings", "dev-tools",
]


def make_nav_test(s):
    def t():
        r = c.post("/navigate", json={"section": s})
        assert r.status_code == 200
        d = json.loads(r.text)
        assert d.get("success") is True, f"navigate returned {d}"
        return f"section={s}"
    return t


for section in sections:
    test(f"navigate to {section}", make_nav_test(section))


# Navigate to invalid section
def test_invalid_nav():
    r = c.post("/navigate", json={"section": "nonexistent"})
    d = json.loads(r.text)
    assert d.get("success") is False or "error" in d, f"expected error, got {d}"
    return "correctly rejected"


test("navigate invalid section rejected", test_invalid_nav)


# ============================================================
# 3. GET STATE
# ============================================================
print("\n=== 3. Get State ===")


def test_state():
    c.post("/navigate", json={"section": "home"})
    time.sleep(0.1)
    r = c.get("/state")
    assert r.status_code == 200
    d = json.loads(r.text)
    assert "sidebarSection" in d, "missing sidebarSection"
    assert "personaCount" in d, "missing personaCount"
    assert "personas" in d, "missing personas"
    assert isinstance(d["personas"], list), "personas not a list"
    return f"section={d['sidebarSection']}, personas={d['personaCount']}, keys={sorted(d.keys())}"


test("state returns full app state", test_state)


# ============================================================
# 4. NAVIGATE + STATE VERIFICATION
# ============================================================
print("\n=== 4. Navigate + Verify State ===")


def test_nav_verify():
    c.post("/navigate", json={"section": "credentials"})
    time.sleep(0.1)
    r = c.get("/state")
    d = json.loads(r.text)
    assert d["sidebarSection"] == "credentials", f"expected credentials, got {d['sidebarSection']}"
    return "navigate correctly updates state"


test("navigate updates state atomically", test_nav_verify)


# ============================================================
# 5. LIST INTERACTIVE ELEMENTS
# ============================================================
print("\n=== 5. List Interactive Elements ===")


def test_list_interactive():
    c.post("/navigate", json={"section": "personas"})
    time.sleep(0.3)
    r = c.get("/list-interactive")
    assert r.status_code == 200
    items = json.loads(r.text)
    assert isinstance(items, list), "expected list"
    assert len(items) > 0, "no interactive elements found"
    first = items[0]
    for key in ["tag", "selector"]:
        assert key in first, f"missing key: {key}"
    return f"{len(items)} elements, tags={set(i['tag'] for i in items[:10])}"


test("list interactive returns elements with metadata", test_list_interactive)


# ============================================================
# 6. QUERY by CSS selector
# ============================================================
print("\n=== 6. Query Elements ===")


def test_query_buttons():
    r = c.post("/query", json={"selector": "button"})
    assert r.status_code == 200
    items = json.loads(r.text)
    assert isinstance(items, list), "expected list"
    assert len(items) > 0, "no buttons found"
    for item in items:
        assert "tag" in item and item["tag"] == "button"
        assert "rect" in item
    return f"{len(items)} buttons found"


test("query buttons by selector", test_query_buttons)


def test_query_nonexistent():
    r = c.post("/query", json={"selector": "#this-definitely-does-not-exist-xyz"})
    items = json.loads(r.text)
    assert isinstance(items, list) and len(items) == 0, "expected empty list"
    return "returns empty array (no crash)"


test("query nonexistent returns empty", test_query_nonexistent)


# ============================================================
# 7. FIND TEXT
# ============================================================
print("\n=== 7. Find Text ===")


def test_find_text():
    c.post("/navigate", json={"section": "personas"})
    time.sleep(0.3)
    r = c.post("/find-text", json={"text": "Agent"})
    assert r.status_code == 200
    items = json.loads(r.text)
    assert isinstance(items, list), "expected list"
    assert len(items) > 0, "no elements with 'Agent' found"
    for item in items:
        assert "selector" in item
        assert "tag" in item
    return f"{len(items)} elements contain 'Agent'"


test("find text returns matching elements", test_find_text)


def test_find_text_none():
    r = c.post("/find-text", json={"text": "xyzzy_nonexistent_12345"})
    items = json.loads(r.text)
    assert isinstance(items, list) and len(items) == 0
    return "returns empty array"


test("find nonexistent text returns empty", test_find_text_none)


# ============================================================
# 8. CLICK
# ============================================================
print("\n=== 8. Click ===")


def test_click_existing():
    c.post("/navigate", json={"section": "personas"})
    time.sleep(0.3)
    r = c.get("/list-interactive")
    items = json.loads(r.text)
    buttons = [i for i in items if i["tag"] == "button" and not i.get("disabled")]
    assert len(buttons) > 0, "no clickable buttons"
    selector = buttons[0]["selector"]
    r = c.post("/click", json={"selector": selector})
    d = json.loads(r.text)
    assert d.get("success") is True, f"click failed: {d}"
    return f"clicked {selector}"


test("click existing button succeeds", test_click_existing)


def test_click_nonexistent():
    r = c.post("/click", json={"selector": "#nonexistent-element-xyz"})
    d = json.loads(r.text)
    assert d.get("success") is False or "error" in d, f"expected failure, got {d}"
    return "correctly reports element not found"


test("click nonexistent reports error", test_click_nonexistent)


# ============================================================
# 9. TYPE TEXT
# ============================================================
print("\n=== 9. Type Text ===")


def test_type_nonexistent():
    r = c.post("/type", json={"selector": "#nonexistent-input", "text": "hello"})
    d = json.loads(r.text)
    assert d.get("success") is False or "error" in d
    return "correctly reports element not found"


test("type into nonexistent reports error", test_type_nonexistent)


def test_type_search():
    c.post("/navigate", json={"section": "personas"})
    time.sleep(0.3)
    r = c.get("/list-interactive")
    items = json.loads(r.text)
    inputs = [i for i in items if i["tag"] == "input"]
    if not inputs:
        return "SKIP: no input fields on current page"
    selector = inputs[0]["selector"]
    r = c.post("/type", json={"selector": selector, "text": "test query"})
    d = json.loads(r.text)
    assert d.get("success") is True, f"type failed: {d}"
    return f"typed into {selector}"


test("type into available input", test_type_search)


# ============================================================
# 10. WAIT FOR
# ============================================================
print("\n=== 10. Wait For ===")


def test_wait_existing():
    c.post("/navigate", json={"section": "personas"})
    r = c.post("/wait", json={"selector": "button", "timeout_ms": 3000})
    d = json.loads(r.text)
    assert d.get("success") is True, f"wait failed: {d}"
    return "button found immediately"


test("wait for existing element resolves fast", test_wait_existing)


def test_wait_timeout():
    r = c.post("/wait", json={"selector": "#will-never-exist", "timeout_ms": 500})
    d = json.loads(r.text)
    assert d.get("success") is False, f"expected timeout, got {d}"
    assert "error" in d and "Timeout" in d["error"]
    return f"timed out correctly: {d['error'][:50]}"


test("wait for nonexistent times out", test_wait_timeout)


# ============================================================
# 11. EVAL JS
# ============================================================
print("\n=== 11. Eval JS ===")


def test_eval():
    r = c.post("/eval", json={"js": "document.title = 'Smoke Test'"})
    assert r.status_code == 200
    d = json.loads(r.text)
    assert d.get("success") is True
    return "JS executed successfully"


test("eval arbitrary JS", test_eval)


# ============================================================
# 12. RAPID SEQUENTIAL OPERATIONS (latency test)
# ============================================================
print("\n=== 12. Rapid Sequential Ops (latency) ===")


def test_rapid():
    start = time.perf_counter()
    ops = 0
    for s in ["home", "personas", "settings", "overview", "home"]:
        c.post("/navigate", json={"section": s})
        c.get("/state")
        ops += 2
    total = (time.perf_counter() - start) * 1000
    avg = total / ops
    return f"{ops} ops in {total:.0f}ms (avg {avg:.0f}ms/op)"


test("10 rapid navigate+state ops", test_rapid)


# ============================================================
# 13. MULTI-STEP WORKFLOW (realistic scenario)
# ============================================================
print("\n=== 13. Multi-Step Workflow ===")


def test_workflow():
    steps = []
    # Step 1: Navigate to personas
    c.post("/navigate", json={"section": "personas"})
    time.sleep(0.2)
    state = json.loads(c.get("/state").text)
    steps.append(f"nav=personas count={state['personaCount']}")

    # Step 2: Find agent cards
    agents = json.loads(c.post("/find-text", json={"text": "Active"}).text)
    steps.append(f"found {len(agents)} Active labels")

    # Step 3: List interactive elements
    interactive = json.loads(c.get("/list-interactive").text)
    steps.append(f"{len(interactive)} interactive")

    # Step 4: Navigate to settings
    c.post("/navigate", json={"section": "settings"})
    time.sleep(0.2)
    state2 = json.loads(c.get("/state").text)
    steps.append(f"settings={state2['sidebarSection'] == 'settings'}")

    # Step 5: Back to home
    c.post("/navigate", json={"section": "home"})
    state3 = json.loads(c.get("/state").text)
    steps.append(f"home={state3['sidebarSection'] == 'home'}")

    return " | ".join(steps)


test("5-step workflow (navigate, query, interact)", test_workflow)


# ============================================================
# SUMMARY
# ============================================================
print(f"\n{'=' * 60}")
print(f"SMOKE TEST COMPLETE: {passed} passed, {failed} failed out of {passed + failed}")
print(f"{'=' * 60}")

times = [r[2] for r in results if r[1] == "PASS"]
if times:
    print(f"Avg latency: {sum(times) / len(times):.0f}ms")
    print(f"Min latency: {min(times):.0f}ms")
    print(f"Max latency: {max(times):.0f}ms")
    print(f"Total time:  {sum(r[2] for r in results):.0f}ms")

sys.exit(1 if failed > 0 else 0)
