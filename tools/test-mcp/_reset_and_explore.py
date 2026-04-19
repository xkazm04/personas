import httpx, json, time
c = httpx.Client(base_url="http://127.0.0.1:17320", timeout=30)

def post(p, body=None):
    return json.loads(c.post(p, json=body or {}).text)

def get(p):
    return json.loads(c.get(p).text)

def query(sel):
    r = json.loads(c.post("/query", json={"selector": sel}).text)
    return r if isinstance(r, list) else r.get("results") or []

# Very aggressive reset
for _ in range(10):
    c.post("/eval", json={"js": 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'})
    time.sleep(0.15)
post("/navigate", {"section": "home"}); time.sleep(0.8)
post("/navigate", {"section": "overview"}); time.sleep(0.8)
post("/navigate", {"section": "home"}); time.sleep(0.5)
post("/navigate", {"section": "design-reviews"}); time.sleep(1)
post("/click-testid", {"test_id": "tab-generated"}); time.sleep(2)

# Check current row count
rows = query('[data-testid^="template-row-"]')
print(f"rows initial: {len(rows)}")

# Scan for filter tab buttons — look for visible ones inside the gallery
all_btns = [b for b in query("button") if b.get("visible")]
print(f"total visible buttons: {len(all_btns)}")
for b in all_btns:
    t = (b.get("text") or "").strip()
    if t and any(x in t for x in ["All", "Ready", "Partial", "108", "55"]):
        print(f"  candidate: text={t!r}  testId={b.get('testId')}")
