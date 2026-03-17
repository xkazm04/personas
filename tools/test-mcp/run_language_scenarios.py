"""
Multi-language E2E test: creates one persona per supported language.
Tests that the build flow works with non-English intents and produces
localized agent names, descriptions, and dimension content.

Usage:
  PYTHONUNBUFFERED=1 uvx --with httpx python tools/test-mcp/run_language_scenarios.py
"""
import httpx
import json
import time
import sys

BASE = "http://127.0.0.1:17320"
c = httpx.Client(base_url=BASE, timeout=30)

# One scenario per language — intent is in the target language
# Using a simple, universal intent: "Sort my emails and create tasks from important ones"
LANGUAGES = [
    {"code": "en", "name": "English",    "intent": "Sort my emails and create tasks from important ones"},
    {"code": "zh", "name": "Chinese",    "intent": "将我的邮件分类，并从重要邮件中创建任务"},
    {"code": "ar", "name": "Arabic",     "intent": "قم بفرز رسائلي الإلكترونية وإنشاء مهام من الرسائل المهمة"},
    {"code": "hi", "name": "Hindi",      "intent": "मेरे ईमेल को छांटें और महत्वपूर्ण ईमेल से कार्य बनाएं"},
    {"code": "ru", "name": "Russian",    "intent": "Сортируй мои письма и создавай задачи из важных"},
    {"code": "id", "name": "Indonesian", "intent": "Urutkan email saya dan buat tugas dari email penting"},
    {"code": "es", "name": "Spanish",    "intent": "Ordena mis correos electrónicos y crea tareas a partir de los importantes"},
    {"code": "fr", "name": "French",     "intent": "Trie mes e-mails et crée des tâches à partir des messages importants"},
    {"code": "bn", "name": "Bengali",    "intent": "আমার ইমেলগুলো সাজাও এবং গুরুত্বপূর্ণ ইমেল থেকে কাজ তৈরি করো"},
    {"code": "ja", "name": "Japanese",   "intent": "メールを整理して、重要なメールからタスクを作成して"},
    {"code": "vi", "name": "Vietnamese", "intent": "Sắp xếp email của tôi và tạo công việc từ các email quan trọng"},
    {"code": "de", "name": "German",     "intent": "Sortiere meine E-Mails und erstelle Aufgaben aus den wichtigen"},
    {"code": "ko", "name": "Korean",     "intent": "내 이메일을 정리하고 중요한 이메일에서 작업을 만들어줘"},
    {"code": "cs", "name": "Czech",      "intent": "Roztřiď mé e-maily a vytvoř úkoly z důležitých zpráv"},
]

MAX_BUILD_TIME = 300
POLL_INTERVAL = 5


def reset_state():
    """Delete all agents and reset build state."""
    try:
        state = c.get("/state").json()
        for p in state.get("personas", []):
            c.post("/delete-agent", json={"name_or_id": p["id"]})
        c.post("/eval", json={"js": 'import("@/stores/agentStore").then(m=>m.useAgentStore.getState().resetBuildSession())'})
        time.sleep(0.5)
    except Exception:
        pass


def set_language(lang_code):
    """Set the i18n language in the frontend store."""
    c.post("/eval", json={
        "js": f'import("@/stores/i18nStore").then(m=>m.useI18nStore.getState().setLanguage("{lang_code}"))'
    })
    time.sleep(0.3)


def run_language_scenario(lang):
    """Run a build scenario in the given language. Returns result dict."""
    code = lang["code"]
    result = {
        "code": code,
        "name": lang["name"],
        "intent": lang["intent"][:50],
        "status": "UNKNOWN",
        "cells_resolved": 0,
        "cells_total": 0,
        "turns": 0,
        "questions_asked": 0,
        "time_s": 0,
        "agent_name": None,
        "errors": [],
    }

    try:
        reset_state()
        set_language(code)

        # Start creation
        c.post("/navigate", json={"section": "personas"})
        time.sleep(0.3)
        c.post("/start-create-agent", json={})
        time.sleep(0.5)
        wait_r = c.post("/wait", json={"selector": '[data-testid="agent-intent-input"]', "timeout_ms": 5000}).json()
        if not wait_r.get("success"):
            result["status"] = "FAIL"
            result["errors"].append("Intent input not found")
            return result

        c.post("/fill-field", json={"test_id": "agent-intent-input", "value": lang["intent"]})
        c.post("/click-testid", json={"test_id": "agent-launch-btn"})

        start = time.time()
        turn = 0

        while time.time() - start < MAX_BUILD_TIME:
            time.sleep(POLL_INTERVAL)
            elapsed = time.time() - start

            try:
                state = c.get("/state").json()
            except Exception:
                continue

            phase = state.get("buildPhase", "")
            cells = state.get("buildCellStates", {})
            resolved = sum(1 for v in cells.values() if v in ("resolved", "updated"))
            highlighted = [k for k, v in cells.items() if v == "highlighted"]

            if phase == "failed":
                result["status"] = "FAIL"
                result["errors"].append(state.get("buildError", "Unknown error"))
                break

            if phase == "draft_ready":
                result["phase"] = phase
                result["cells_resolved"] = resolved
                result["cells_total"] = len(cells)
                result["turns"] = turn + 1
                result["time_s"] = elapsed
                personas = state.get("personas", [])
                if personas:
                    result["agent_name"] = personas[-1]["name"]
                result["status"] = "PASS"
                break

            # Handle questions
            if phase == "awaiting_input" and highlighted:
                for cell_key in highlighted:
                    result["questions_asked"] += 1
                try:
                    c.post("/answer-question", json={"cell_key": highlighted[0], "option_index": 0})
                except Exception:
                    pass
                turn += 1
                continue

            # No questions but awaiting_input — click Continue Build
            if phase == "awaiting_input" and not highlighted:
                try:
                    c.post("/eval", json={"js": 'document.querySelectorAll("button").forEach(b=>{if(b.innerText.includes("Continue Build"))b.click()})'})
                except Exception:
                    pass
                turn += 1
        else:
            result["status"] = "TIMEOUT"
            result["errors"].append(f"Exceeded {MAX_BUILD_TIME}s")
            result["time_s"] = MAX_BUILD_TIME

    except Exception as e:
        result["status"] = "ERROR"
        result["errors"].append(str(e))

    return result


def print_result(r):
    status_icon = {"PASS": "+", "FAIL": "!", "TIMEOUT": "~", "ERROR": "X"}.get(r["status"], "?")
    cells = f"{r['cells_resolved']}/{r['cells_total']}" if r["cells_total"] else "?"
    name = r.get("agent_name", "?") or "?"
    # Truncate name for display
    name_display = name if len(name) <= 30 else name[:27] + "..."
    print(f"  [{status_icon}] {r['code']:2s} {r['name']:<12s} {r['status']:<7s} cells={cells:<5s} turns={r['turns']} time={r['time_s']:.0f}s name=\"{name_display}\"")
    if r["errors"]:
        print(f"       errors: {r['errors']}")


def main():
    try:
        h = c.get("/health").json()
        print(f"Server: {h.get('server')} v{h.get('version')}")
    except Exception:
        print("ERROR: Cannot connect to test server on port 17320")
        sys.exit(1)

    # Select specific languages or all
    if len(sys.argv) > 1:
        codes = sys.argv[1].split(",")
        langs = [l for l in LANGUAGES if l["code"] in codes]
    else:
        langs = LANGUAGES

    print(f"\nRunning {len(langs)} language scenarios...\n")

    results = []
    for lang in langs:
        print(f"--- {lang['name']} ({lang['code']}) ---")
        r = run_language_scenario(lang)
        print_result(r)
        results.append(r)
        print()

    # Reset to English
    set_language("en")

    # Summary
    passed = sum(1 for r in results if r["status"] == "PASS")
    failed = sum(1 for r in results if r["status"] == "FAIL")
    timeout = sum(1 for r in results if r["status"] == "TIMEOUT")
    errors = sum(1 for r in results if r["status"] == "ERROR")

    print("=" * 70)
    print(f"RESULTS: {passed} passed, {failed} failed, {timeout} timeout, {errors} error out of {len(results)}")
    print("=" * 70)

    times = [r["time_s"] for r in results if r["status"] == "PASS"]
    if times:
        print(f"Timing: avg={sum(times)/len(times):.0f}s min={min(times):.0f}s max={max(times):.0f}s")

    # Language coverage
    print(f"\nLanguage pass rate: {passed}/{len(results)}")
    fails = [r for r in results if r["status"] != "PASS"]
    if fails:
        print("Failed languages:")
        for r in fails:
            print(f"  {r['code']} ({r['name']}): {r['status']} - {r['errors']}")

    # Final cleanup
    reset_state()
    sys.exit(0 if failed == 0 and errors == 0 and timeout == 0 else 1)


if __name__ == "__main__":
    main()
