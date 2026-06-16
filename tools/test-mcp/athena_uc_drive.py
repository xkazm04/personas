#!/usr/bin/env python
"""Drive Athena use-case scenarios via the test bridge and dump per-scenario
captures to JSON for offline judging. Reset between scenarios for isolation.
Run against an ISOLATED instance only (it resets the conversation)."""
import json, sys, time, urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 17340
BASE = f"http://127.0.0.1:{PORT}"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/athena-uc-captures"

import os
os.makedirs(OUT, exist_ok=True)


def post(path, body, timeout=160):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode()
    try:
        return json.loads(raw)
    except Exception:
        return {"_raw": raw}


def exec_method(method, params=None, timeout_secs=30):
    return post("/bridge-exec", {"method": method, "params": params or {}, "timeout_secs": timeout_secs}, timeout=timeout_secs + 20)


def invoke(command, params=None):
    return exec_method("invokeCommand", {"command": command, "params": params or {}}, timeout_secs=30)


# id, prompt, pinned_connectors (None=leave), note
SCENARIOS = [
    ("scan_vs_build", "Scan the personas repo for bugs and tests.", None),
    ("template_vs_build", "I want an agent that triages incoming support emails and drafts replies. How do I get one?", None),
    ("build_oneshot", "Just build me an agent that summarizes my GitHub PRs every morning. You decide everything — don't ask me questions.", None),
    ("design_family", "Help me design a persona for reviewing legal contracts.", None),
    ("memory_doctrine", "What memory tiers do you have, and which ones require a source citation when you write to them?", None),
    ("connector_wired_sentry", "Check my most recent Sentry issues and tell me the worst one.", ["sentry"]),
    ("connector_stub_notion", "Pull my latest Notion pages and summarize what I've been writing.", ["notion"]),
    ("run_browser_test", "Run a UI test of the personas project's test environment — make sure the main flow works.", None),
    ("kpi_propose", "What KPIs should I be tracking for the personas project?", None),
    ("fleet_analyze", "How are my teams doing? Is anything off track?", None),
    ("assign_team", "Have a team handle adding a dark-mode toggle to personas-web.", None),
    ("update_dev_goal", "The interactive companion replies goal is basically done — mark it complete.", None),
    ("memory_write", "Remember this about me: I prefer concise, direct answers and I usually work in the evenings.", None),
    ("interactive_replies", "Search the web for the two biggest AI agent frameworks of 2026 and give me a short comparison. Walk me through it as you go.", None),
]


def drive(sid, prompt, pinned):
    invoke("companion_reset_conversation", {"wipeTranscript": True})
    time.sleep(1)
    if pinned:
        invoke("companion_set_active_connectors", {"connectorNames": pinned})
        time.sleep(1)
    exec_method("openCompanion", {}, timeout_secs=10)
    post("/fill-field", {"test_id": "companion-composer", "value": prompt}, timeout=20)
    post("/click-testid", {"test_id": "companion-send"}, timeout=20)
    fin = exec_method("companionWaitForTurnFinish", {"timeoutMs": 200000}, timeout_secs=215)
    time.sleep(2)
    cap = exec_method("companionCaptureLastTurn", {}, timeout_secs=30)
    return {"id": sid, "prompt": prompt, "pinned": pinned, "finish": fin, "capture": cap}


def main():
    only = sys.argv[3] if len(sys.argv) > 3 else None
    for sid, prompt, pinned in SCENARIOS:
        if only and only not in sid:
            continue
        print(f"[drive] {sid} …", flush=True)
        try:
            rec = drive(sid, prompt, pinned)
        except Exception as e:
            rec = {"id": sid, "prompt": prompt, "error": repr(e)}
            print(f"  ERR {sid}: {e!r}", flush=True)
        with open(f"{OUT}/{sid}.json", "w", encoding="utf-8") as f:
            json.dump(rec, f, indent=2)
        el = (rec.get("finish") or {}).get("elapsedMs")
        print(f"  done {sid} ({el}ms)", flush=True)
    print("[drive] all scenarios captured ->", OUT, flush=True)


if __name__ == "__main__":
    main()
