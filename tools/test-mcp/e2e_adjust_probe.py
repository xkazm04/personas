#!/usr/bin/env python3
"""E2E live probe for Approach 1 — always-on adoption adjustment.

Drives the REAL backend adjustment (no GUI) via the test-automation bridge:
  create_persona -> create_adoption_session (base IR referencing a generic
  "email" connector) -> save_adoption_answers -> adjust_adoption_draft -> read
  back build_sessions.agent_ir and inspect the specialized prose.

Two cases:
  * CONFIGURED (bind email->gmail): expect a Sonnet specialization that rewrites
    the generic "email connector" references to Gmail concretely.
  * DEFAULT (no answers/bindings): expect a light Haiku pass that PRESERVES the
    authored prose (no collapse; structure intact).

Run with the app up on :17320 (npm run tauri:dev:test).
"""
import json
import os
import sqlite3
import sys
import time

import httpx

if sys.stdout.encoding != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = os.environ.get("PERSONAS_TEST_BASE", "http://127.0.0.1:17320")
DB_PATH = os.path.join(os.environ.get("APPDATA", ""), "com.personas.desktop", "personas.db")
client = httpx.Client(base_url=BASE, timeout=200.0)

BASE_PROMPT = (
    "You are an email triage assistant. On each run, connect to the EMAIL connector and fetch the "
    "user's most recent unread messages. Use the email connector's API to read each message body, "
    "classify it into a fixed set of labels (Urgent, FYI, Newsletter, Other), and write a short "
    "summary of the important ones. Respect the user's attention: never send, archive, mark-as-read, "
    "or delete any mail. When finished, post a concise morning digest grouped by label. If the email "
    "connector returns an authentication error, stop immediately and ask the user to reconnect their "
    "email account before retrying."
)


def bridge(cmd, params, timeout_secs=160):
    body = {"method": "invokeCommand",
            "params": {"command": cmd, "params": params},
            "timeout_secs": timeout_secs}
    return client.post("/bridge-exec", json=body).json()


def result_of(r):
    res = r.get("result")
    if isinstance(res, str):
        try:
            return json.loads(res)
        except Exception:
            return res
    return res


def db_scalar(sql, params=()):
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(sql, params).fetchall()
        return rows[0][0] if rows else None
    finally:
        conn.close()


def craft_ir():
    return json.dumps({
        "name": "E2E Adjust Probe",
        "system_prompt": BASE_PROMPT,
        "full_prompt_markdown": BASE_PROMPT,
        "structured_prompt": {
            "identity": "An email triage assistant.",
            "instructions": "Use the email connector to fetch and classify unread mail, then summarize.",
            "toolGuidance": "Call the email connector API to list and read messages.",
        },
        "use_cases": [{"id": "uc_triage", "title": "Triage", "model_override": "haiku"}],
        "suggested_triggers": [{"trigger_type": "manual"}],
    })


def run_case(label, bindings):
    print(f"\n================ {label} ================")
    p = result_of(bridge("create_persona",
                         {"input": {"name": f"E2E Adjust {label[:20]}",
                                    "system_prompt": "You are a helpful assistant."}}, 30))
    if not isinstance(p, dict) or not p.get("id"):
        print(f"  create_persona FAILED: {p}")
        return None
    pid = p["id"]
    sess = bridge("create_adoption_session",
                  {"personaId": pid, "intent": "email triage assistant",
                   "agentIrJson": craft_ir(), "resolvedCellsJson": "{}"}, 60)
    sid = result_of(sess)
    if not isinstance(sid, str):
        print(f"  create_adoption_session FAILED: {sess}")
        return pid
    bridge("save_adoption_answers",
           {"sessionId": sid,
            "adoptionAnswersJson": json.dumps({"answers": {}, "questions": [],
                                               "credential_bindings": bindings})}, 30)
    t0 = time.time()
    adj = result_of(bridge("adjust_adoption_draft", {"sessionId": sid}, 180))
    dt = time.time() - t0

    ir_json = db_scalar("SELECT agent_ir FROM build_sessions WHERE id = ?", (sid,))
    new_sp, ucs = "", []
    if ir_json:
        try:
            parsed = json.loads(ir_json) or {}
            new_sp = parsed.get("system_prompt", "") or ""
            ucs = parsed.get("use_cases", []) or parsed.get("use_case_flows", []) or []
        except Exception:
            pass
    low = new_sp.lower()
    print(f"  persona={pid}")
    print(f"  adjust result: {adj}")
    print(f"  elapsed={dt:.1f}s  base_sp_len={len(BASE_PROMPT)}  new_sp_len={len(new_sp)}")
    print(f"  mentions 'gmail': {'gmail' in low}   still mentions 'email': {'email' in low}")
    print(f"  use_cases preserved: {len(ucs)}"
          + (f" (id={ucs[0].get('id')})" if ucs and isinstance(ucs[0], dict) else ""))
    print(f"  --- new system_prompt (first 500) ---\n  {new_sp[:500]}")
    return pid


run_case("CONFIGURED email->gmail", {"email": "gmail"})
run_case("DEFAULT no-bindings", {})
print("\n[done]")
