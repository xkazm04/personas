import httpx, json, time
c = httpx.Client(base_url="http://127.0.0.1:17320", timeout=30)

def snap():
    return json.loads(c.get("/snapshot").text)

s = snap()
print("route:", s.get("route"))
print("pageTitle:", s.get("pageTitle"))
print("editorTab:", s.get("editorTab"))
print("personaCount:", s.get("personaCount"))
print("modals:", len(s.get("modals", [])))
for i, m in enumerate(s.get("modals", [])[:3]):
    print(f"  modal {i} text[:100]:", (m.get("text") or "")[:100])
print("errors:", s.get("errors", []))
print("toasts:", s.get("toasts", []))
