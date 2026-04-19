import httpx, json, time
c = httpx.Client(base_url="http://127.0.0.1:17320", timeout=30)
def post(p, body=None):
    return json.loads(c.post(p, json=body or {}).text)
def query(sel):
    r = json.loads(c.post("/query", json={"selector": sel}).text)
    return r if isinstance(r, list) else r.get("results") or []

# Page reload via JS
c.post("/eval", json={"js": 'window.location.reload();'})
time.sleep(5)
state = json.loads(c.get("/state").text)
print(f"after reload: buildPhase={state.get('buildPhase')}")

post("/navigate", {"section": "design-reviews"}); time.sleep(2)
post("/click-testid", {"test_id": "tab-generated"}); time.sleep(3)
for i in range(15):
    rows = query('[data-testid^="template-row-"]')
    if rows: break
    time.sleep(1)
print(f"rows: {len(rows)}")

# Now check filter tabs
btns = query("button")
for b in btns:
    t = (b.get("text") or "").strip()
    if t and ("All" in t or "Partial" in t or "Ready" in t) and any(ch.isdigit() for ch in t):
        print(f"FILTER: text={t!r}  testId={b.get('testId')}")
