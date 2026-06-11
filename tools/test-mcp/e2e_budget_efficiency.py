#!/usr/bin/env python3
"""Efficiency probe for the enhanced budget-spending-monitor (all-haiku cloud-cost).

Adopt via the real session path (create_adoption_session -> adjust -> promote),
then simulate the two haiku use cases. Wall-clock here; true backend timings are
read afterward from the app log (adjust elapsed_ms) + persona_executions.
"""
import json, os, sys, time
import httpx

if sys.stdout.encoding != "utf-8":
    import io; sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:17320"
TEMPLATE = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..",
                            "scripts", "templates", "finance", "budget-spending-monitor.json"))
client = httpx.Client(base_url=BASE, timeout=240.0)


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


payload = json.load(open(TEMPLATE, encoding="utf-8"))["payload"]

print("=== ADOPT (default answers -> haiku adjustment) ===")
pid = res(bridge("create_persona", {"input": {"name": "T: Cloud Cost (eff-probe)",
                                              "system_prompt": "You are a helpful assistant."}}, 20))["id"]
print("persona:", pid)

t = time.time()
sid = res(bridge("create_adoption_session", {"personaId": pid, "intent": "cloud cost control",
                 "agentIrJson": json.dumps(payload), "resolvedCellsJson": "{}"}, 60))
print(f"create_adoption_session: {time.time()-t:.1f}s  session={sid}")

bridge("save_adoption_answers", {"sessionId": sid,
       "adoptionAnswersJson": json.dumps({"answers": {}, "questions": [], "credential_bindings": {}})}, 20)

t = time.time()
adj = res(bridge("adjust_adoption_draft", {"sessionId": sid}, 30))
print(f"adjust_adoption_draft (bridge-return): {time.time()-t:.1f}s | result: {adj}")

t = time.time()
prom = bridge("promote_build_draft", {"sessionId": sid, "personaId": pid, "excludedUseCaseIds": []}, 150)
print(f"promote_build_draft: {time.time()-t:.1f}s | ok={prom.get('success')}")

print("\n=== EXECUTE haiku use cases (simulate) ===")
for uc in ("uc_weekly_spending_check", "uc_daily_threshold_check"):
    t = time.time()
    r = res(bridge("simulate_use_case", {"personaId": pid, "useCaseId": uc}, 200))
    dt = time.time() - t
    summary = ""
    if isinstance(r, dict):
        summary = (f"state={r.get('state') or r.get('status')} "
                   f"msg={r.get('message_count', r.get('messages'))} ok={r.get('ok', r.get('success'))}")
    print(f"  {uc}: {dt:.1f}s  {summary}")
    print("     result:", (json.dumps(r)[:240] if isinstance(r, (dict, list)) else str(r)[:240]))

print("\nPERSONA:", pid)
