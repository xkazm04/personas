#!/usr/bin/env python3
"""Configured-case adjustment proof: fire adjust, then POLL the DB for the
write-back (decoupled from the test bridge's ~25s response timeout)."""
import json
import os
import sqlite3
import time

import httpx

BASE = "http://127.0.0.1:17320"
DB_PATH = os.path.join(os.environ.get("APPDATA", ""), "com.personas.desktop", "personas.db")
client = httpx.Client(base_url=BASE, timeout=40.0)

BASE_PROMPT = (
    "You are an email triage assistant. On each run, connect to the EMAIL connector and fetch the "
    "user's most recent unread messages. Use the email connector's API to read each message body, "
    "classify it into a fixed set of labels (Urgent, FYI, Newsletter, Other), and write a short "
    "summary of the important ones. Respect the user's attention: never send, archive, mark-as-read, "
    "or delete any mail. When finished, post a concise morning digest grouped by label. If the email "
    "connector returns an authentication error, stop immediately and ask the user to reconnect their "
    "email account before retrying."
)


def bridge(cmd, params, t=30):
    try:
        return client.post("/bridge-exec", json={"method": "invokeCommand",
                            "params": {"command": cmd, "params": params},
                            "timeout_secs": t}).json()
    except Exception as e:
        return {"_timeout": str(e)}


def res(r):
    v = r.get("result")
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return v
    return v


def craft():
    return json.dumps({
        "name": "E2E Configured Probe",
        "system_prompt": BASE_PROMPT,
        "full_prompt_markdown": BASE_PROMPT,
        "structured_prompt": {
            "identity": "An email triage assistant.",
            "instructions": "Use the email connector to fetch and classify unread mail, then summarize.",
            "toolGuidance": "Call the email connector API to list and read messages.",
        },
        "use_cases": [{"id": "uc_triage", "title": "Triage", "model_override": "haiku"}],
    })


def db_sp(sid):
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute("SELECT agent_ir FROM build_sessions WHERE id=?", (sid,)).fetchone()
        if not row or not row[0]:
            return None
        return (json.loads(row[0]) or {}).get("system_prompt", "")
    finally:
        conn.close()


p = res(bridge("create_persona", {"input": {"name": "E2E Configured",
                                            "system_prompt": "You are a helpful assistant."}}, 20))
pid = p["id"]
sid = res(bridge("create_adoption_session",
                 {"personaId": pid, "intent": "email triage assistant",
                  "agentIrJson": craft(), "resolvedCellsJson": "{}"}, 40))
bridge("save_adoption_answers",
       {"sessionId": sid,
        "adoptionAnswersJson": json.dumps({"answers": {"tone": "concise"}, "questions": [],
                                           "credential_bindings": {"email": "gmail"}})}, 20)
print(f"persona={pid}\nsession={sid}\nfiring adjust (bridge may time out ~25s; we poll the DB)...")
bridge("adjust_adoption_draft", {"sessionId": sid}, 30)  # bridge will likely cut at ~25s

base = BASE_PROMPT
t0 = time.time()
final = base
for _ in range(60):  # poll up to ~120s
    sp = db_sp(sid)
    if sp and sp != base:
        final = sp
        break
    time.sleep(2)
dt = time.time() - t0
low = (final or "").lower()
print(f"\n=== RESULT (after {dt:.0f}s poll) ===")
print(f"  changed from base: {final != base}")
print(f"  base_len={len(base)}  new_len={len(final)}")
print(f"  mentions 'gmail': {'gmail' in low}")
print(f"  still mentions 'email': {'email' in low}")
print(f"  --- new system_prompt (first 600) ---\n  {(final or '')[:600]}")
