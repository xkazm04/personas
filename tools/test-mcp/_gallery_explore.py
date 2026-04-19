import httpx, json, time
c = httpx.Client(base_url="http://127.0.0.1:17320", timeout=30)

def post(p, body=None):
    return json.loads(c.post(p, json=body or {}).text)

def get(p):
    return json.loads(c.get(p).text)

def query(sel):
    r = json.loads(c.post("/query", json={"selector": sel}).text)
    return r if isinstance(r, list) else r.get("results") or []

# Close any open modals
for _ in range(5):
    c.post("/eval", json={"js": 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'})
    time.sleep(0.2)
post("/navigate", {"section": "home"}); time.sleep(0.3)

# Navigate to templates
post("/navigate", {"section": "design-reviews"}); time.sleep(0.5)
post("/click-testid", {"test_id": "tab-generated"}); time.sleep(1)

# Look for filter tabs by text
all_btns = query("button")
ready_like = [b for b in all_btns if any(k in (b.get("text") or "") for k in ["All\n", "Ready\n", "Partial\n"]) and b.get("visible")]
print("filter tabs found:")
for b in ready_like:
    print(f"  text={b.get('text')!r}  testId={b.get('testId')}  rect={b.get('rect')}")

# Try clicking All by text
c.post("/eval", json={"js": '''
var btns = document.querySelectorAll("button");
for (var i = 0; i < btns.length; i++) {
    var t = (btns[i].textContent || '').trim();
    if (t.indexOf("All") === 0 && t.match(/^All\s*\d+/)) {
        btns[i].click();
        console.log("clicked:", t);
        break;
    }
}
'''})
time.sleep(1)
rows = query('[data-testid^="template-row-"]')
print(f"rows after click All: {len(rows)}")
