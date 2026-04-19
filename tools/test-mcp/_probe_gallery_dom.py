import httpx, json, time
c = httpx.Client(base_url="http://127.0.0.1:17320", timeout=30)

def query(sel):
    r = json.loads(c.post("/query", json={"selector": sel}).text)
    return r if isinstance(r, list) else r.get("results") or []

for sel in [
    '[data-testid^="template-row-"]',
    '[data-testid^="template-"]',
    '[data-testid*="template"]',
    '[data-testid^="review-"]',
    '[role="row"]',
    'h1',
    'h2',
    '[data-testid^="tab-"]',
]:
    rows = query(sel)
    print(f"{sel}: {len(rows)}")
    for r in rows[:3]:
        print(f"   text={(r.get('text') or '')[:60]!r} testId={r.get('testId')}")
