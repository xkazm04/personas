#!/usr/bin/env python3
"""Real run of the enhanced budget-spending-monitor against the GCP connector.

Adopt with cloud->gcp_cloud bound (configured -> Sonnet specialization), wait for
the adjust to finish (no promote race), promote, verify readiness, then
execute_persona (REAL, not simulate) the weekly report and poll to terminal.
"""
import json, os, sqlite3, sys, time
import httpx
if sys.stdout.encoding != "utf-8":
    import io; sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:17320"
DB = os.path.join(os.environ.get("APPDATA", ""), "com.personas.desktop", "personas.db")
TEMPLATE = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..",
                            "scripts", "templates", "finance", "budget-spending-monitor.json"))
client = httpx.Client(base_url=BASE, timeout=120.0)


def bridge(cmd, params, t=30):
    try:
        return client.post("/bridge-exec", json={"method": "invokeCommand",
                            "params": {"command": cmd, "params": params}, "timeout_secs": t}).json()
    except Exception as e:
        return {"_timeout": str(e)}


def res(r):
    v = r.get("result")
    if isinstance(v, str):
        try: return json.loads(v)
        except Exception: return v
    return v


def db(sql, p=()):
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row
    try: return [dict(r) for r in c.execute(sql, p).fetchall()]
    finally: c.close()


payload = json.load(open(TEMPLATE, encoding="utf-8"))["payload"]
print("=== ADOPT with cloud->gcp_cloud binding (configured -> Sonnet) ===")
pid = res(bridge("create_persona", {"input": {"name": "T: Cloud Cost (real-run)",
                                              "system_prompt": "You are a helpful assistant."}}, 20))["id"]
sid = res(bridge("create_adoption_session", {"personaId": pid, "intent": "cloud cost control on GCP",
                 "agentIrJson": json.dumps(payload), "resolvedCellsJson": "{}"}, 60))
print("persona:", pid, "session:", sid)
answers = {
    "answers": {"aq_cloud_provider": "GCP", "aq_spending_threshold": "500",
                "aq_currency": "USD ($)", "aq_sensitivity": "Balanced (threshold + >50% service spikes + new services)"},
    "questions": [],
    "credential_bindings": {"cloud": "gcp_cloud", "cloud_billing": "gcp_cloud"},
}
bridge("save_adoption_answers", {"sessionId": sid, "adoptionAnswersJson": json.dumps(answers)}, 20)

t = time.time()
bridge("adjust_adoption_draft", {"sessionId": sid}, 30)  # bridge caps ~25s; we poll the DB for write-back
# wait for adjust to write a system_prompt into the session agent_ir (or timeout 120s)
adj_done = False
for _ in range(60):
    row = db("SELECT agent_ir FROM build_sessions WHERE id=?", (sid,))
    if row and row[0]["agent_ir"]:
        try:
            sp = (json.loads(row[0]["agent_ir"]) or {}).get("system_prompt", "")
            if sp and len(sp) > 50:
                adj_done = True; break
        except Exception:
            pass
    time.sleep(2)
print(f"adjust write-back: {'OK' if adj_done else 'NOT DETECTED'} after {time.time()-t:.1f}s")

prom = bridge("promote_build_draft", {"sessionId": sid, "personaId": pid, "excludedUseCaseIds": []}, 150)
print("promote ok=", prom.get("success"))

# readiness + locate the weekly UC id
p = db("SELECT setup_status, design_context FROM personas WHERE id=?", (pid,))[0]
print("setup_status:", p["setup_status"])
ucs = (json.loads(p["design_context"]) or {}).get("useCases", []) if p["design_context"] else []
weekly = next((u["id"] for u in ucs if "Weekly" in (u.get("title") or "")), None)
print("weekly uc id:", weekly, "| all:", [(u["id"], u.get("title")) for u in ucs])

print("\n=== REAL execute weekly report (execute_persona) ===")
r = bridge("execute_persona", {"personaId": pid, "useCaseId": weekly}, 30)
ex = res(r)
print("execute_persona:", "ok" if r.get("success") else f"FAIL {r.get('error')}")
exec_id = ex.get("id") if isinstance(ex, dict) else None
print("execution id:", exec_id, "| initial status:", ex.get("status") if isinstance(ex, dict) else ex)

if exec_id:
    TERM = {"completed", "failed", "cancelled", "error"}
    for _ in range(90):
        row = db("SELECT status,duration_ms,cost_usd,error_message FROM persona_executions WHERE id=?", (exec_id,))
        if row and row[0]["status"] in TERM:
            e = row[0]
            print(f"FINAL: status={e['status']} duration_ms={e['duration_ms']} cost=${e['cost_usd']} err={e['error_message']}")
            break
        time.sleep(3)
    msgs = db("SELECT title, substr(content,1,300) c FROM persona_messages WHERE persona_id=? ORDER BY created_at DESC LIMIT 2", (pid,))
    for m in msgs:
        print("MESSAGE:", m["title"]); print("  ", (m["c"] or "").replace(chr(10), " ")[:280])
    out = db("SELECT substr(output_data,1,400) o FROM persona_executions WHERE id=?", (exec_id,))
    if out and out[0]["o"]: print("OUTPUT(400):", out[0]["o"].replace(chr(10), " "))
print("\nPERSONA:", pid)
