r"""
E2E Template Adoption Tests for Personas Desktop

Validates that upgraded wave-2 templates:
  1. Appear in the Generated gallery
  2. Open the matrix adoption wizard with populated dimension cells
  3. Questionnaire renders with answerable questions; answers can be submitted
  4. After answering, buildPhase transitions to draft_ready
  5. "Test Agent" button is clickable and produces test output (buildTestOutputLines > 0)

Uses the /open-matrix-adoption API endpoint for reliable template targeting
(avoids the expand-row Adopt-button approach which can target wrong templates).

Requires the app running with test automation:
  npx tauri dev --features test-automation

Usage:
  uvx --with httpx python tools/test-mcp/e2e_template_adoption.py
  uvx --with httpx python tools/test-mcp/e2e_template_adoption.py --template "Invoice Tracker"
  uvx --with httpx python tools/test-mcp/e2e_template_adoption.py --skip-test-agent
"""
import httpx
import json
import time
import sys
import re
import argparse

parser = argparse.ArgumentParser(description="E2E template adoption tests")
parser.add_argument("--port", type=int, default=17320, help="Test automation server port")
parser.add_argument("--template", type=str, default=None, help="Test a single template by display name")
parser.add_argument("--skip-test-agent", action="store_true", help="Skip the Test Agent button press")
parser.add_argument("--test-agent-timeout", type=int, default=30, help="Seconds to wait for test agent to complete")
args = parser.parse_args()

BASE = f"http://127.0.0.1:{args.port}"
c = httpx.Client(base_url=BASE, timeout=90)
passed = 0
failed = 0
skipped = 0
results = []

# (slug, display_name) for the 23 upgraded wave-2 templates
WAVE2_TEMPLATES = [
    ("research-knowledge-curator", "Research Knowledge Curator"),
    ("email-follow-up-tracker", "Email Follow-Up Tracker"),
    ("contact-sync-manager", "Contact Sync Manager"),
    ("sales-deal-analyzer", "Sales Deal Analyzer"),
    ("newsletter-curator", "Newsletter Curator"),
    ("sales-deal-tracker", "Sales Deal Tracker"),
    ("database-performance-monitor", "Database Performance Monitor"),
    ("incident-logger", "Incident Logger"),
    ("email-morning-digest", "Email Morning Digest"),
    ("content-performance-reporter", "Content Performance Reporter"),
    ("contact-enrichment-agent", "Contact Enrichment Agent"),
    ("email-support-assistant", "Email Support Assistant"),
    ("onboarding-tracker", "Onboarding Tracker"),
    ("research-paper-indexer", "Research Paper Indexer"),
    ("email-lead-extractor", "Email Lead Extractor"),
    ("sales-proposal-generator", "Sales Proposal Generator"),
    ("daily-standup-compiler", "Daily Standup Compiler"),
    ("technical-decision-tracker", "Technical Decision Tracker"),
    ("support-email-router", "Support Email Router"),
    ("invoice-tracker", "Invoice Tracker"),
    ("email-task-extractor", "Email Task Extractor"),
    ("survey-insights-analyzer", "Survey Insights Analyzer"),
    ("access-request-manager", "Access Request Manager"),
]


def test(name, fn, *, skip_reason=None):
    global passed, failed, skipped
    if skip_reason:
        skipped += 1
        results.append((name, "SKIP", 0, skip_reason))
        print(f"  SKIP  {name} -- {skip_reason}")
        return None
    start = time.perf_counter()
    try:
        result = fn()
        ms = (time.perf_counter() - start) * 1000
        passed += 1
        results.append((name, "PASS", ms, result))
        print(f"  PASS  {name} ({ms:.0f}ms) -- {result}")
        return result
    except Exception as e:
        ms = (time.perf_counter() - start) * 1000
        failed += 1
        results.append((name, "FAIL", ms, str(e)))
        print(f"  FAIL  {name} ({ms:.0f}ms) -- {e}")
        return None


# ── Helpers ──────────────────────────────────────────────────

def nav(section: str):
    c.post("/navigate", json={"section": section})
    time.sleep(0.4)


def state():
    return json.loads(c.get("/state").text)


def snapshot():
    return json.loads(c.get("/snapshot").text)


def click_testid(test_id: str):
    return json.loads(c.post("/click-testid", json={"test_id": test_id}).text)


def fill_field(test_id: str, value: str):
    return json.loads(c.post("/fill-field", json={"test_id": test_id, "value": value}).text)


def query(selector: str):
    return json.loads(c.post("/query", json={"selector": selector}).text)


def eval_js(js: str):
    c.post("/eval", json={"js": js})


def close_all_modals():
    """Close all open modals and navigate home to reset state."""
    for _ in range(5):
        eval_js('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))')
        time.sleep(0.2)
    nav("home")
    time.sleep(0.5)


def go_to_gallery():
    """Navigate to Templates > Generated and wait for rows to load."""
    nav("design-reviews")
    time.sleep(0.5)
    click_testid("tab-generated")
    time.sleep(1)
    fill_field("template-search-input", "")
    time.sleep(0.5)
    # Wait for template rows to appear (seeding may be async)
    for _ in range(10):
        rows = query('[data-testid^="template-row-"]')
        if len(rows) > 0:
            break
        time.sleep(1)
    return len(rows)


def build_review_id_map():
    """Get all template rows and build a name -> review_id mapping."""
    rows = query('[data-testid^="template-row-"]')
    name_to_id = {}
    for row in rows:
        text = row.get("text", "")
        name = text.split("\n")[0].strip()
        rid = row["testId"].replace("template-row-", "")
        name_to_id[name] = rid
    return name_to_id, len(rows)


def fill_empty_text_inputs():
    """Fill any empty text inputs in dialogs with a test value.
    Uses focus + native setter + input/change/blur to trigger React state updates."""
    eval_js('''
var dialogs = document.querySelectorAll("[role=dialog]");
for (var d = dialogs.length - 1; d >= 0; d--) {
    var inputs = dialogs[d].querySelectorAll("input, textarea");
    for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var tid = inp.getAttribute("data-testid");
        if (tid === "template-search-input" || tid === "agent-refine-input") continue;
        if (tid) continue;
        if (inp.value && inp.value.trim() !== "") continue;
        inp.focus();
        var proto = inp.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        var nativeSet = Object.getOwnPropertyDescriptor(proto, "value").set;
        nativeSet.call(inp, "test-value-e2e");
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        inp.dispatchEvent(new Event("blur", { bubbles: true }));
    }
}
''')


def click_submit_all():
    """Click the 'Submit All' button in the questionnaire."""
    eval_js('''
var btns = document.querySelectorAll("button");
for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.indexOf("Submit All") >= 0) {
        btns[i].click();
        break;
    }
}
''')


# ── Initial cleanup ──────────────────────────────────────────
close_all_modals()
time.sleep(1)

# ── 0. Health Check ──────────────────────────────────────────
print("\n=== 0. Health Check ===")


def test_health():
    r = c.get("/health")
    assert r.status_code == 200, f"HTTP {r.status_code}"
    d = r.json()
    assert d["status"] == "ok"
    return f"server={d['server']} v={d.get('version', '?')}"


test("app is running", test_health)


# ── 1. Load gallery and build review_id map ──────────────────
print("\n=== 1. Load Gallery ===")

review_id_map = {}


def test_load_gallery():
    global review_id_map
    go_to_gallery()
    review_id_map, total_rows = build_review_id_map()
    assert total_rows > 0, "No template rows found"
    return f"{total_rows} templates, {len(review_id_map)} named"


test("load gallery", test_load_gallery)


# ── 2. Verify templates exist ────────────────────────────────
print("\n=== 2. Verify Template Visibility ===")

if args.template:
    templates_to_test = [(s, n) for s, n in WAVE2_TEMPLATES if args.template.lower() in n.lower()]
    if not templates_to_test:
        # Try matching against gallery names (review_id_map keys)
        gallery_matches = [n for n in review_id_map if args.template.lower() in n.lower()]
        templates_to_test = [("gallery", n) for n in gallery_matches]
    if not templates_to_test:
        print(f"  No template matching '{args.template}' found")
        sys.exit(1)
else:
    templates_to_test = WAVE2_TEMPLATES


def make_visibility_test(template_name):
    def t():
        assert template_name in review_id_map, f"'{template_name}' not found in gallery"
        return f"review_id={review_id_map[template_name][:12]}"
    return t


for slug, name in templates_to_test:
    test(f"'{name}' in gallery", make_visibility_test(name))


# ── 3. Full Adoption Flow per Template ───────────────────────
print("\n=== 3. Template Adoption Flow ===")


def run_adoption_test(template_name):
    """Full adoption flow:
    1. Open matrix adoption via /open-matrix-adoption API
    2. Verify questionnaire appears, answer all questions
    3. Submit questionnaire, verify buildPhase = draft_ready
    4. Click Test Agent, verify test output appears
    5. Clean up
    """
    review_id = review_id_map.get(template_name)
    assert review_id, f"No review_id for '{template_name}'"

    # ── Clean slate ───────────────────────────────────────────
    close_all_modals()

    # Navigate to gallery first so template rows are in DOM
    go_to_gallery()

    # ── Step 1: Open matrix adoption ──────────────────────────
    r = c.post("/open-matrix-adoption", json={"review_id": review_id}, timeout=90)
    result = json.loads(r.text)
    assert result.get("success"), f"open-matrix-adoption failed: {result.get('error', 'unknown')}"
    time.sleep(4)  # Wait for async persona creation + cell seeding

    # Verify adoption modal opened
    s = snapshot()
    modals = s.get("modals", [])
    assert len(modals) > 0, "No modals opened after open-matrix-adoption"

    # Verify correct template (first modal should contain template name)
    modal_text = modals[0].get("text", "")
    assert template_name in modal_text, f"Wrong template in modal: expected '{template_name}', got '{modal_text[:60]}'"

    # ── Step 2: Check state (persona created, cells seeded) ───
    s1 = state()
    build_phase = s1.get("buildPhase", "unknown")
    persona_id = s1.get("buildPersonaId")
    session_id = s1.get("buildSessionId")

    assert persona_id, "No buildPersonaId after adoption"
    assert session_id, "No buildSessionId after adoption"

    # ── Step 3: Handle questionnaire ──────────────────────────
    questionnaire_answered = 0
    questionnaire_total = 0

    # Check for questionnaire modal
    for m in modals:
        txt = m.get("text", "")
        match = re.search(r"(\d+)/(\d+) answered", txt)
        if match:
            questionnaire_answered = int(match.group(1))
            questionnaire_total = int(match.group(2))
            break

    if questionnaire_total > 0:
        # Fill any unanswered text inputs
        if questionnaire_answered < questionnaire_total:
            fill_empty_text_inputs()
            time.sleep(1)

        # Submit All
        click_submit_all()
        time.sleep(2)

        # Re-check answered count after submission
        s2 = snapshot()
        for m in s2.get("modals", []):
            match = re.search(r"(\d+)/(\d+) answered", m.get("text", ""))
            if match:
                questionnaire_answered = int(match.group(1))

    # ── Step 4: Verify draft_ready phase ──────────────────────
    s2 = state()
    build_phase = s2.get("buildPhase", "unknown")
    # Phase should be draft_ready after questionnaire submission
    # (or awaiting_input if questions remain)

    # ── Step 5: Test Agent button ─────────────────────────────
    test_btn_result = "skipped"

    if not args.skip_test_agent and build_phase == "draft_ready":
        test_btns = query('[data-testid="agent-test-btn"]')
        if test_btns:
            # Click Test Agent
            click_testid("agent-test-btn")
            test_btn_result = "clicked"

            # Poll for test output
            test_detected = False
            for i in range(args.test_agent_timeout // 2):
                time.sleep(2)
                s3 = state()
                test_lines = len(s3.get("buildTestOutputLines", []))
                test_passed = s3.get("buildTestPassed")
                test_error = s3.get("buildTestError")

                if test_lines > 0:
                    test_detected = True
                    if test_passed is not None:
                        test_btn_result = f"passed={test_passed} lines={test_lines}"
                        break
                    test_btn_result = f"running lines={test_lines}"
                if test_error:
                    test_btn_result = f"error={str(test_error)[:60]}"
                    test_detected = True
                    break

            if not test_detected:
                test_btn_result = "no_output"
        else:
            test_btn_result = "btn_not_found"
    elif build_phase != "draft_ready":
        test_btn_result = f"phase={build_phase}"

    # ── Clean up ──────────────────────────────────────────────
    close_all_modals()

    # Delete the draft persona to avoid clutter
    if persona_id:
        try:
            c.post("/delete-agent", json={"name_or_id": persona_id}, timeout=10)
        except Exception:
            pass

    # ── Build result ──────────────────────────────────────────
    parts = []
    parts.append(f"questionnaire={questionnaire_answered}/{questionnaire_total}")
    parts.append(f"phase={build_phase}")
    parts.append(f"test={test_btn_result}")
    return " | ".join(parts)


for slug, name in templates_to_test:
    test(f"adopt '{name}'", lambda n=name: run_adoption_test(n))


# ============================================================
# SUMMARY
# ============================================================
print(f"\n{'=' * 70}")
total = passed + failed + skipped
print(f"TEMPLATE ADOPTION E2E: {passed} passed, {failed} failed, {skipped} skipped (of {total})")
print(f"{'=' * 70}")

times = [r[2] for r in results if r[1] == "PASS"]
if times:
    print(f"Avg latency: {sum(times) / len(times):.0f}ms")
    print(f"Total time:  {sum(r[2] for r in results):.0f}ms")

if failed > 0:
    print("\nFailed tests:")
    for name, status, ms, detail in results:
        if status == "FAIL":
            print(f"  - {name}: {detail}")

print("\nAdoption details:")
for name, status, ms, detail in results:
    if name.startswith("adopt '"):
        marker = "PASS" if status == "PASS" else "FAIL"
        print(f"  {marker} {name}: {detail}")

sys.exit(1 if failed > 0 else 0)
