"""Poke the adoption flow for one template and dump rich diagnostics."""
import httpx, json, time, sys

BASE = "http://127.0.0.1:17320"
c = httpx.Client(base_url=BASE, timeout=60)

def post(p, body=None):
    return json.loads(c.post(p, json=body or {}).text)

def get(p):
    return json.loads(c.get(p).text)

def query(sel):
    r = json.loads(c.post("/query", json={"selector": sel}).text)
    return r if isinstance(r, list) else r.get("results") or []

def nav(s):
    post("/navigate", {"section": s}); time.sleep(0.3)

# Warm up
for _ in range(3):
    try:
        c.post("/eval", json={"js": 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'})
        time.sleep(0.2)
    except Exception:
        pass
nav("home"); time.sleep(0.3)

# Gallery
nav("design-reviews"); time.sleep(0.5)
post("/click-testid", {"test_id": "tab-generated"}); time.sleep(1.0)
rows = query('[data-testid^="template-row-"]')
print(f"rows: {len(rows)}")

# Find incident-logger
rid = None
for row in rows:
    if "Incident Logger" in (row.get("text") or ""):
        rid = (row.get("testId") or "").replace("template-row-", "")
        print(f"found: {rid}")
        break
if not rid:
    print("not found")
    sys.exit(1)

# Open adoption
resp = post("/open-matrix-adoption", {"review_id": rid})
print(f"open: {resp}")

# Wait + inspect
time.sleep(3)
snap = get("/snapshot")
print(f"\nmodals: {len(snap.get('modals', []))}")
for i, m in enumerate(snap.get("modals", [])):
    print(f"\nMODAL {i} (role={m.get('role')}):")
    print((m.get("text") or "")[:800])

# DOM counts of relevant elements
print("\n--- DOM probes ---")
for sel in [
    '[data-testid="questionnaire-form-grid"]',
    '[data-testid^="questionnaire-scope-"]',
    '[role="dialog"]',
    '.questionnaire',
    'h2', 'h3', 'button',
]:
    n = len(query(sel))
    print(f"  {sel}: {n}")

# State
st = get("/state")
print(f"\nstate subset:")
for k in ("buildPhase", "buildPersonaId", "buildSessionId", "buildPendingQuestions", "route"):
    print(f"  {k}: {st.get(k)!r}")
