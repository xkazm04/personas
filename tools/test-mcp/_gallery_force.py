import httpx, json, time
c = httpx.Client(base_url="http://127.0.0.1:17320", timeout=30)

def post(p, body=None):
    return json.loads(c.post(p, json=body or {}).text)
def query(sel):
    r = json.loads(c.post("/query", json={"selector": sel}).text)
    return r if isinstance(r, list) else r.get("results") or []

# Hard refresh: navigate away and back
post("/navigate", {"section": "home"}); time.sleep(1)
post("/navigate", {"section": "design-reviews"}); time.sleep(1.5)
post("/click-testid", {"test_id": "tab-generated"}); time.sleep(3)
# Wait up to 20s for rows
for i in range(20):
    rows = query('[data-testid^="template-row-"]')
    if rows: break
    time.sleep(1)
print(f"rows after reload: {len(rows)}")

# If still nothing, probe the tab content
tabs = query('[role="tabpanel"], [data-tab="generated"]')
print(f"tabpanels: {len(tabs)}")
for t in tabs[:2]:
    print(f"  text[:200]: {(t.get('text') or '')[:200]!r}")

# Check state
state = json.loads(c.get("/state").text)
print(f"buildPhase: {state.get('buildPhase')}  personas: {state.get('personaCount','?')}")
