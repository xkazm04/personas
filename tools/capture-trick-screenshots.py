"""
Capture screenshots for Learning Center trick guides.

Drives the Personas app via test automation API (port 17320) and captures
the window via ffmpeg gdigrab for each trick's key visual state.

Prerequisites:
  1. App running: npm run tauri dev -- --features test-automation
  2. ffmpeg in PATH
  3. httpx installed

Usage:
  python tools/capture-trick-screenshots.py
"""
import httpx
import subprocess
import time
import os
import sys

BASE = "http://127.0.0.1:17320"
WINDOW_TITLE = "Personas"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "guides")

os.makedirs(OUT_DIR, exist_ok=True)

c = httpx.Client(base_url=BASE, timeout=15)


def api(method, path, body=None):
    try:
        r = c.post(path, json=body or {}) if method == "POST" else c.get(path)
        return r.json() if r.status_code == 200 else {}
    except Exception:
        return {}


def nav(section):
    api("POST", "/navigate", {"section": section})
    time.sleep(1.5)


def click(tid):
    api("POST", "/click-testid", {"test_id": tid})
    time.sleep(1)


def js(code):
    api("POST", "/eval", {"js": code})
    time.sleep(0.5)


def editor_tab(tab):
    api("POST", "/open-editor-tab", {"tab": tab})
    time.sleep(1)


def settings_tab(tab):
    api("POST", "/open-settings-tab", {"tab": tab})
    time.sleep(1)


def screenshot(name):
    """Capture current Personas window as PNG."""
    path = os.path.join(OUT_DIR, f"{name}.png")
    cmd = [
        "ffmpeg", "-y", "-f", "gdigrab", "-framerate", "1", "-t", "0.1",
        "-i", f"title={WINDOW_TITLE}",
        "-frames:v", "1", "-update", "1", path
    ]
    subprocess.run(cmd, capture_output=True)
    exists = os.path.exists(path) and os.path.getsize(path) > 0
    print(f"  {'OK' if exists else 'FAIL'}  {name}.png" + (f" ({os.path.getsize(path)//1024}KB)" if exists else ""))
    return exists


def check_health():
    try:
        r = c.get("/health")
        return r.json().get("status") == "ok"
    except Exception:
        return False


# ── Screenshot capture sequences ─────────────────────────────────────────

def capture_credential_healthcheck():
    nav("credentials")
    time.sleep(1)
    screenshot("trick-credential-healthcheck")


def capture_arena_model_compare():
    nav("personas")
    js("window.__AGENT_STORE__?.getState()?.personas?.[0]?.id && window.__AGENT_STORE__.getState().selectPersona(window.__AGENT_STORE__.getState().personas[0].id)")
    time.sleep(1)
    editor_tab("lab")
    click("lab-mode-arena")
    time.sleep(0.5)
    screenshot("trick-arena-model-compare")


def capture_event_chaining():
    nav("events")
    js("window.__SYSTEM_STORE__?.setState?.({eventBusTab: 'builder'})")
    time.sleep(1.5)
    screenshot("trick-event-chaining")


def capture_custom_theme():
    nav("settings")
    settings_tab("appearance")
    time.sleep(1)
    screenshot("trick-custom-theme")


def capture_prompt_versioning():
    nav("personas")
    js("window.__AGENT_STORE__?.getState()?.personas?.[0]?.id && window.__AGENT_STORE__.getState().selectPersona(window.__AGENT_STORE__.getState().personas[0].id)")
    time.sleep(1)
    editor_tab("lab")
    click("lab-mode-versions")
    time.sleep(0.5)
    screenshot("trick-prompt-versioning")


def capture_persona_matrix():
    nav("personas")
    js("window.__SYSTEM_STORE__?.setState?.({isCreatingPersona: true})")
    time.sleep(1.5)
    screenshot("trick-persona-matrix")
    js("window.__SYSTEM_STORE__?.setState?.({isCreatingPersona: false})")


def capture_live_event_stream():
    nav("events")
    js("window.__SYSTEM_STORE__?.setState?.({eventBusTab: 'live-stream'})")
    time.sleep(1.5)
    screenshot("trick-live-event-stream")


def capture_health_heartbeats():
    nav("overview")
    js("window.__OVERVIEW_STORE__?.getState()?.setOverviewTab?.('health')")
    time.sleep(1.5)
    screenshot("trick-health-heartbeats")


def capture_message_threads():
    nav("overview")
    js("window.__OVERVIEW_STORE__?.getState()?.setOverviewTab?.('messages')")
    time.sleep(1.5)
    screenshot("trick-message-threads")


def capture_auto_credential():
    nav("credentials")
    click("create-credential-btn")
    time.sleep(1)
    screenshot("trick-auto-credential-discovery")
    # Go back
    api("POST", "/click", {"selector": "[data-testid='vault-back-btn']"})


CAPTURES = [
    ("credential-healthcheck", capture_credential_healthcheck),
    ("arena-model-compare", capture_arena_model_compare),
    ("event-chaining", capture_event_chaining),
    ("custom-theme", capture_custom_theme),
    ("prompt-versioning", capture_prompt_versioning),
    ("persona-matrix", capture_persona_matrix),
    ("live-event-stream", capture_live_event_stream),
    ("health-heartbeats", capture_health_heartbeats),
    ("message-threads", capture_message_threads),
    ("auto-credential-discovery", capture_auto_credential),
]


if __name__ == "__main__":
    if not check_health():
        print("ERROR: App not running. Start with: npm run tauri dev -- --features test-automation")
        sys.exit(1)

    print(f"Capturing {len(CAPTURES)} trick screenshots...\n")

    passed = 0
    for name, fn in CAPTURES:
        try:
            fn()
            passed += 1
        except Exception as e:
            print(f"  FAIL  {name}: {e}")

        if not check_health():
            print("\n  App went down — stopping.")
            break

    # Reset to home
    try:
        nav("home")
    except Exception:
        pass

    print(f"\n  {passed}/{len(CAPTURES)} screenshots captured to public/guides/")
