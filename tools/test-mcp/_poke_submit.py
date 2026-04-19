"""Poke submit-all behavior after adoption opens."""
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

# Warm
post("/navigate", {"section": "home"}); time.sleep(0.3)
post("/navigate", {"section": "design-reviews"}); time.sleep(0.6)
post("/click-testid", {"test_id": "tab-generated"}); time.sleep(1.0)

rows = query('[data-testid^="template-row-"]')
rid = None
for row in rows:
    if "Incident Logger" in (row.get("text") or ""):
        rid = (row.get("testId") or "").replace("template-row-", "")
        break
assert rid
print(f"rid={rid}")

post("/open-matrix-adoption", {"review_id": rid})
time.sleep(3)
snap = get("/snapshot")
print(f"after open: modals={len(snap.get('modals', []))}")
for m in snap.get('modals', []):
    print(f"  modal text[:200]={(m.get('text') or '')[:200]!r}")

# Query any element inside any dialog
dialogs = query('[role="dialog"]')
print(f"\nDialogs in DOM: {len(dialogs)}")
for i, d in enumerate(dialogs):
    print(f"  [{i}] {(d.get('text') or '')[:120]!r}")

# Now look for buttons INSIDE the dialogs
dlg_btns = query('[role="dialog"] button')
print(f"\nButtons inside dialogs: {len(dlg_btns)}")
for b in dlg_btns[:30]:
    print(f"  text={(b.get('text') or '')[:60]!r}")

# Dump all visible buttons containing "Submit"
btns = query("button")
print(f"\nTotal buttons: {len(btns)}")
for b in btns[:40]:
    vis = "V" if b.get("visible") else "H"
    print(f"  [{vis}] text={(b.get('text') or '')[:60]!r}  testId={b.get('testId')}")
submits = [b for b in btns if "Submit" in (b.get("text") or "") and b.get("visible")]
print(f"\nSubmit-containing visible buttons: {len(submits)}")
for b in submits:
    print(f"  text={b.get('text')[:80]!r}  testId={b.get('testId')}  rect={b.get('rect')}")

# Also: count the questionnaire-scope testids (my new v2 grouping)
scopes = query('[data-testid^="questionnaire-scope-"]')
print(f"\nScope sections: {len(scopes)}")
for s in scopes:
    print(f"  {s.get('testId')}")

# Try pressing the first submit button programmatically
if submits:
    print("\nClicking first Submit button...")
    # Use the eval bridge to click by text
    c.post("/eval", json={"js": '''
var btns = document.querySelectorAll("button");
for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent && btns[i].textContent.indexOf("Submit All") >= 0) {
        btns[i].click();
        console.log("clicked Submit All");
        break;
    }
}
'''})
    # Poll state for up to 15s
    for i in range(30):
        time.sleep(0.5)
        st = get("/state")
        phase = st.get("buildPhase")
        pid = st.get("buildPersonaId")
        if pid or (phase and phase != "initializing"):
            print(f"  after {i*0.5:.1f}s: phase={phase} pid={pid}")
            break
    else:
        print("  still initializing after 15s")
