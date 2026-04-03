"""
Record trick demo videos by driving the running Personas app via the test automation
HTTP API (port 17320) while capturing the app window with ffmpeg gdigrab.

Prerequisites:
  1. App running with test automation: npm run tauri dev -- --features test-automation
  2. ffmpeg in PATH
  3. httpx: pip install httpx (or run via uvx --with httpx)

Usage:
  python tools/record-tricks.py                    # Record all tricks
  python tools/record-tricks.py custom-theme       # Record one trick
  python tools/record-tricks.py --list             # List available tricks
"""
import httpx
import subprocess
import time
import sys
import os
import json

BASE = "http://127.0.0.1:17320"
WINDOW_TITLE = "Personas"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recordings")
STEP_DELAY = 2.0  # seconds between steps
FPS = 24

os.makedirs(OUT_DIR, exist_ok=True)

c = httpx.Client(base_url=BASE, timeout=15)


# ── API helpers ──────────────────────────────────────────────────────────

def api(method, path, body=None):
    try:
        if method == "GET":
            r = c.get(path)
        else:
            r = c.post(path, json=body or {})
        return r.json() if r.status_code == 200 else {}
    except Exception:
        return {}


def nav(section):
    return api("POST", "/navigate", {"section": section})


def click(test_id):
    return api("POST", "/click-testid", {"test_id": test_id})


def fill(test_id, value):
    return api("POST", "/fill-field", {"test_id": test_id, "value": value})


def wait(selector, timeout_ms=8000):
    return api("POST", "/wait", {"selector": selector, "timeout_ms": timeout_ms})


def js(code):
    return api("POST", "/eval", {"js": code})


def select_agent(name):
    return api("POST", "/select-agent", {"name_or_id": name})


def editor_tab(tab):
    return api("POST", "/open-editor-tab", {"tab": tab})


def settings_tab(tab):
    return api("POST", "/open-settings-tab", {"tab": tab})


def sleep(s=None):
    time.sleep(s if s is not None else STEP_DELAY)


# ── Recording helpers ────────────────────────────────────────────────────

def start_capture(name, duration):
    """Start ffmpeg capturing the Personas window."""
    out_path = os.path.join(OUT_DIR, f"_raw-{name}.mp4")
    cmd = [
        "ffmpeg", "-y",
        "-f", "gdigrab",
        "-framerate", str(FPS),
        "-t", str(duration),
        "-i", f"title={WINDOW_TITLE}",
        "-c:v", "libx264", "-crf", "23", "-preset", "fast",
        out_path
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.5)  # let ffmpeg attach
    return proc, out_path


def write_srt(name, subtitles):
    """Write SRT subtitle file. subtitles = [(start_sec, end_sec, text), ...]"""
    srt_path = os.path.join(OUT_DIR, f"_subs-{name}.srt")
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, (start, end, text) in enumerate(subtitles, 1):
            f.write(f"{i}\n")
            f.write(f"{_fmt_ts(start)} --> {_fmt_ts(end)}\n")
            f.write(f"{text}\n\n")
    return srt_path


def _fmt_ts(sec):
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int((sec % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def burn_subtitles(name, raw_path, srt_path):
    """Burn SRT into video with ffmpeg."""
    final_path = os.path.join(OUT_DIR, f"demo-{name}.mp4")
    # ffmpeg subtitles filter needs forward slashes and escaped colons on Windows
    srt_escaped = srt_path.replace("\\", "/").replace(":", "\\:")
    cmd = [
        "ffmpeg", "-y", "-i", raw_path,
        "-vf", f"subtitles='{srt_escaped}':force_style='FontSize=20,FontName=Arial,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=2,Shadow=1,MarginV=30'",
        "-c:v", "libx264", "-crf", "23", "-preset", "fast",
        final_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # Subtitle burn failed — just copy raw as final
        print(f"  Subtitle burn failed (using raw): {result.stderr[:200]}")
        import shutil
        shutil.copy2(raw_path, final_path)
    # Cleanup raw
    try:
        os.remove(raw_path)
    except OSError:
        pass
    return final_path


# ── Trick definitions ────────────────────────────────────────────────────

def record_custom_theme():
    subs = []
    t = 0

    nav("settings"); sleep(1); t += 1
    subs.append((t, t+2, "Opening Settings — the Appearance tab"))
    settings_tab("appearance"); sleep(); t += STEP_DELAY

    subs.append((t, t+3, "Scroll to Theming section — Default vs Custom"))
    js("document.querySelector('[data-testid=\"settings-appearance-panel\"]')?.scrollTo(0, 9999)")
    sleep(3); t += 3

    subs.append((t, t+2, "Switching to Custom theme builder"))
    # Click the Custom tab button
    api("POST", "/click", {"selector": "button:has-text('Custom')"})
    sleep(); t += STEP_DELAY

    subs.append((t, t+3, "8 color slots — Primary, Accent, Background, and more"))
    sleep(3); t += 3

    subs.append((t, t+2, "The preview updates live as you pick colors"))
    sleep(2); t += 2

    return subs, t + 2


def record_arena_model_compare():
    subs = []
    t = 0

    nav("personas"); sleep(1); t += 1
    subs.append((t, t+2, "Opening an agent to access the Lab"))
    # Select first available agent
    js("window.__AGENT_STORE__?.getState()?.personas?.[0]?.id && window.__AGENT_STORE__.getState().selectPersona(window.__AGENT_STORE__.getState().personas[0].id)")
    sleep(); t += STEP_DELAY

    subs.append((t, t+2, "The Lab tab — head-to-head model testing"))
    editor_tab("lab"); sleep(); t += STEP_DELAY

    subs.append((t, t+3, "Arena mode compares models on your actual use cases"))
    click("lab-mode-arena"); sleep(3); t += 3

    subs.append((t, t+3, "Select models — Haiku, Sonnet, Opus — and run"))
    sleep(3); t += 3

    subs.append((t, t+2, "Results show composite scores per model"))
    sleep(2); t += 2

    return subs, t + 2


def record_event_chaining():
    subs = []
    t = 0

    subs.append((t, t+2, "Events module — the orchestration hub"))
    nav("events"); sleep(); t += STEP_DELAY

    subs.append((t, t+3, "The event log shows all system events in real-time"))
    sleep(3); t += 3

    subs.append((t, t+3, "Event Canvas — visual wiring of agent chains"))
    js("window.__SYSTEM_STORE__?.setState?.({eventBusTab: 'builder'})")
    sleep(3); t += 3

    subs.append((t, t+3, "Sources on left, consuming agents on right"))
    sleep(3); t += 3

    subs.append((t, t+2, "Chain triggers: Agent A completes → Agent B auto-starts"))
    sleep(2); t += 2

    return subs, t + 2


def record_credential_healthcheck():
    subs = []
    t = 0

    subs.append((t, t+2, "Opening the Credential Vault"))
    nav("credentials"); sleep(); t += STEP_DELAY

    subs.append((t, t+3, "Health dots — green (healthy), amber (attention), red (failing)"))
    sleep(3); t += 3

    subs.append((t, t+3, "Daily bulk health checks run automatically"))
    sleep(3); t += 3

    subs.append((t, t+2, "Click any credential to see audit log and remediation"))
    sleep(2); t += 2

    return subs, t + 2


def record_prompt_versioning():
    subs = []
    t = 0

    nav("personas"); sleep(1); t += 1
    subs.append((t, t+2, "Select an agent to open the editor"))
    js("window.__AGENT_STORE__?.getState()?.personas?.[0]?.id && window.__AGENT_STORE__.getState().selectPersona(window.__AGENT_STORE__.getState().personas[0].id)")
    sleep(); t += STEP_DELAY

    subs.append((t, t+2, "Lab tab → Versions panel"))
    editor_tab("lab"); sleep(1); t += 1
    click("lab-mode-versions"); sleep(); t += STEP_DELAY

    subs.append((t, t+3, "Every prompt edit is versioned — diff, rollback, or A/B test"))
    sleep(3); t += 3

    subs.append((t, t+3, "Tag versions as Production, Experimental, or Archived"))
    sleep(3); t += 3

    return subs, t + 2


def record_persona_matrix():
    subs = []
    t = 0

    subs.append((t, t+2, "The Persona Matrix — 8 dimensions define an agent"))
    nav("personas"); sleep(); t += STEP_DELAY
    js("window.__SYSTEM_STORE__?.setState?.({isCreatingPersona: true})")
    sleep(); t += STEP_DELAY

    subs.append((t, t+3, "Use Cases, Connectors, Triggers, Human Review"))
    sleep(3); t += 3

    subs.append((t, t+3, "Messages, Memory, Error Handling, Events"))
    sleep(3); t += 3

    subs.append((t, t+2, "Each cell is independently resolved by AI"))
    sleep(2); t += 2

    # Close creation
    js("window.__SYSTEM_STORE__?.setState?.({isCreatingPersona: false})")
    return subs, t + 2


def record_live_event_stream():
    subs = []
    t = 0

    subs.append((t, t+2, "Events → Live Stream — real-time event monitoring"))
    nav("events"); sleep(1); t += 1
    js("window.__SYSTEM_STORE__?.setState?.({eventBusTab: 'live-stream'})")
    sleep(); t += STEP_DELAY

    subs.append((t, t+3, "Events appear instantly: execution_completed, webhook_received"))
    sleep(3); t += 3

    subs.append((t, t+3, "Filter by type or persona to focus on specific chains"))
    sleep(3); t += 3

    subs.append((t, t+2, "Click any event to inspect its full JSON payload"))
    sleep(2); t += 2

    return subs, t + 2


def record_health_heartbeats():
    subs = []
    t = 0

    subs.append((t, t+2, "Overview → Health — agent fleet monitoring"))
    nav("overview"); sleep(1); t += 1
    js("window.__OVERVIEW_STORE__?.getState()?.setOverviewTab?.('health')")
    sleep(); t += STEP_DELAY

    subs.append((t, t+3, "Heartbeat scores: 0-100 with color grades"))
    sleep(3); t += 3

    subs.append((t, t+3, "Green (80+) = healthy, Amber (50-79), Red (<50) = critical"))
    sleep(3); t += 3

    subs.append((t, t+2, "Expand any card for success rate, latency, and cost"))
    sleep(2); t += 2

    return subs, t + 2


def record_message_threads():
    subs = []
    t = 0

    subs.append((t, t+2, "Overview → Messages — agent communication hub"))
    nav("overview"); sleep(1); t += 1
    js("window.__OVERVIEW_STORE__?.getState()?.setOverviewTab?.('messages')")
    sleep(); t += STEP_DELAY

    subs.append((t, t+3, "Messages show persona, priority, delivery status"))
    sleep(3); t += 3

    subs.append((t, t+3, "Switch to Threaded view to see conversation chains"))
    sleep(3); t += 3

    subs.append((t, t+2, "Parent messages group replies — follow multi-agent collaborations"))
    sleep(2); t += 2

    return subs, t + 2


def record_auto_credential():
    subs = []
    t = 0

    subs.append((t, t+2, "Vault → Add New — multiple connection methods"))
    nav("credentials"); sleep(1); t += 1
    click("create-credential-btn"); sleep(); t += STEP_DELAY

    subs.append((t, t+3, "AI Autopilot — paste a URL, AI extracts credentials"))
    sleep(3); t += 3

    subs.append((t, t+3, "No manual form filling — browser automation does the work"))
    sleep(3); t += 3

    subs.append((t, t+2, "Also: AI Wizard, Desktop Bridge, MCP, and manual options"))
    sleep(2); t += 2

    return subs, t + 2


TRICKS = {
    "custom-theme": ("Build a Custom Theme", record_custom_theme),
    "arena-model-compare": ("Arena: Model Comparison", record_arena_model_compare),
    "event-chaining": ("Chain Agents with Events", record_event_chaining),
    "credential-healthcheck": ("Bulk Credential Health Check", record_credential_healthcheck),
    "prompt-versioning": ("Prompt Version Rollback", record_prompt_versioning),
    "persona-matrix": ("The 8-Dimension Persona Matrix", record_persona_matrix),
    "live-event-stream": ("Real-Time Event Stream", record_live_event_stream),
    "health-heartbeats": ("Agent Health Heartbeats", record_health_heartbeats),
    "message-threads": ("Threaded Agent Messages", record_message_threads),
    "auto-credential-discovery": ("AI Credential Auto-Discovery", record_auto_credential),
}


# ── Main ─────────────────────────────────────────────────────────────────

def record_trick(trick_id):
    if trick_id not in TRICKS:
        print(f"Unknown trick: {trick_id}")
        print(f"Available: {', '.join(TRICKS.keys())}")
        return False

    title, fn = TRICKS[trick_id]
    print(f"\n{'='*60}")
    print(f"  Recording: {title}")
    print(f"{'='*60}")

    # Check app is running
    try:
        r = c.get("/health")
        assert r.json().get("status") == "ok"
    except Exception:
        print("  ERROR: App not running. Start with: npm run tauri dev -- --features test-automation")
        return False

    # Navigate to home first to reset state
    nav("home")
    sleep(1)

    # Calculate duration and subtitles by doing a dry run
    subs, duration = fn()

    # Reset state
    nav("home")
    sleep(1)

    print(f"  Duration: ~{duration:.0f}s, {len(subs)} subtitles")

    # Start ffmpeg capture
    print(f"  Starting screen capture (window: {WINDOW_TITLE})...")
    proc, raw_path = start_capture(trick_id, duration + 2)

    # Execute the trick walkthrough (this is the real run)
    sleep(1)
    fn()  # Re-run the actual steps while recording

    # Wait for ffmpeg to finish
    print("  Waiting for capture to complete...")
    proc.wait(timeout=duration + 10)

    if proc.returncode != 0:
        print(f"  WARNING: ffmpeg exited with code {proc.returncode}")
        # Check if raw file exists and has content
        if not os.path.exists(raw_path) or os.path.getsize(raw_path) == 0:
            print(f"  ERROR: No video captured. Is the '{WINDOW_TITLE}' window visible?")
            return False

    # Write subtitles
    srt_path = write_srt(trick_id, subs)
    print(f"  Subtitles written: {srt_path}")

    # Burn subtitles
    print("  Burning subtitles into video...")
    final_path = burn_subtitles(trick_id, raw_path, srt_path)
    print(f"  DONE: {final_path}")

    return True


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--list":
        print("Available tricks:")
        for tid, (title, _) in TRICKS.items():
            print(f"  {tid:30s} {title}")
        sys.exit(0)

    if len(sys.argv) > 1 and sys.argv[1] != "--all":
        # Record specific trick
        success = record_trick(sys.argv[1])
        sys.exit(0 if success else 1)

    # Record all tricks
    results = {}
    for trick_id in TRICKS:
        success = record_trick(trick_id)
        results[trick_id] = "PASS" if success else "FAIL"

    print(f"\n{'='*60}")
    print("  RESULTS")
    print(f"{'='*60}")
    for tid, status in results.items():
        print(f"  {status}  {tid}")
    failed = sum(1 for s in results.values() if s == "FAIL")
    print(f"\n  {len(results) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
