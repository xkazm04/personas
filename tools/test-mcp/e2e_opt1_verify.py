#!/usr/bin/env python3
"""Verify optimization 1: a default adopt (no answers/bindings) skips the LLM
adjustment and returns instantly (was ~42s)."""
import json, os, time, httpx
BASE = "http://127.0.0.1:17320"
TEMPLATE = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..",
                            "scripts", "templates", "finance", "budget-spending-monitor.json"))
client = httpx.Client(base_url=BASE, timeout=60.0)


def bridge(cmd, params, t=30):
    return client.post("/bridge-exec", json={"method": "invokeCommand",
                       "params": {"command": cmd, "params": params}, "timeout_secs": t}).json()


def res(r):
    v = r.get("result")
    if isinstance(v, str):
        try: return json.loads(v)
        except Exception: return v
    return v


payload = json.load(open(TEMPLATE, encoding="utf-8"))["payload"]
pid = res(bridge("create_persona", {"input": {"name": "T: opt1-verify",
                                              "system_prompt": "You are a helpful assistant."}}, 20))["id"]
sid = res(bridge("create_adoption_session", {"personaId": pid, "intent": "cloud cost control",
                 "agentIrJson": json.dumps(payload), "resolvedCellsJson": "{}"}, 60))
bridge("save_adoption_answers", {"sessionId": sid,
       "adoptionAnswersJson": json.dumps({"answers": {}, "questions": [], "credential_bindings": {}})}, 20)
t = time.time()
adj = res(bridge("adjust_adoption_draft", {"sessionId": sid}, 60))
dt = time.time() - t
print(f"DEFAULT adopt adjust: {dt:.2f}s")
print("result:", adj)
ok = isinstance(adj, dict) and adj.get("adjusted") is False and adj.get("divergence") == "default" and adj.get("model") is None
print("OPT-1 SKIP CONFIRMED:", ok, f"(elapsed_ms={adj.get('elapsedMs') if isinstance(adj,dict) else '?'})")
