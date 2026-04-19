r"""
C2 Template Adoption Sweep — All Templates

Drives the real adoption wizard for every template in scripts/templates/.
Records per-template pass/fail across the checks defined in
docs/guide-adoption-test-framework.md.

Prerequisites:
    1. Dev app running with test-automation feature:
        npx tauri dev --features test-automation
    2. Confirm port 17320 responds:
        curl http://127.0.0.1:17320/health

Usage:
    uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py
    uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py --category finance
    uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py --template "Email Morning Digest"
    uvx --with httpx python tools/test-mcp/e2e_c2_sweep.py --limit 10 --skip-test-agent

Output:
    tools/test-mcp/reports/c2-sweep-<timestamp>.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx


# ── Paths & defaults ─────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / "scripts" / "templates"
BUILTIN_CONNECTORS_DIR = REPO_ROOT / "scripts" / "connectors" / "builtin"
REPORTS_DIR = Path(__file__).resolve().parent / "reports"

VIRTUAL_CONNECTORS = {"personas_messages", "personas_database", "personas_memory"}


# ── CLI ──────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description="C2 sweep — full-catalog adoption tests")
parser.add_argument("--port", type=int, default=17320, help="Test automation port")
parser.add_argument("--template", type=str, default=None, help="Run a single template by display name")
parser.add_argument("--category", type=str, default=None, help="Run only one category directory")
parser.add_argument("--limit", type=int, default=0, help="Stop after N templates (0 = no limit)")
parser.add_argument("--skip-test-agent", action="store_true", help="Don't click Test Agent")
parser.add_argument("--per-template-timeout", type=int, default=60, help="Max seconds per template")
parser.add_argument("--report", type=str, default=None, help="Output report path")
parser.add_argument("--no-delete", action="store_true", help="(deprecated — personas are always kept for inspection)")
args = parser.parse_args()


BASE = f"http://127.0.0.1:{args.port}"
client = httpx.Client(base_url=BASE, timeout=120)


# ── Small HTTP helpers ───────────────────────────────────────────────────────

def get(path: str) -> dict:
    return json.loads(client.get(path).text)


def post(path: str, body: dict | None = None, timeout: int | None = None) -> dict:
    r = client.post(path, json=body or {}, timeout=timeout or 60)
    try:
        return json.loads(r.text)
    except json.JSONDecodeError:
        return {"_raw": r.text, "_status": r.status_code}


def nav(section: str):
    post("/navigate", {"section": section})
    time.sleep(0.3)


def snapshot() -> dict:
    return get("/snapshot")


def state() -> dict:
    return get("/state")


def click_testid(test_id: str) -> dict:
    return post("/click-testid", {"test_id": test_id})


def fill_field(test_id: str, value: str) -> dict:
    return post("/fill-field", {"test_id": test_id, "value": value})


def query_dom(selector: str) -> list[dict]:
    r = post("/query", {"selector": selector})
    if isinstance(r, list):
        return r
    return r.get("results") or r.get("elements") or []


def eval_js(js: str):
    post("/eval", {"js": js})


def close_all_modals():
    for _ in range(5):
        eval_js('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}))')
        time.sleep(0.15)
    nav("home")
    time.sleep(0.3)


# ── Template loading ────────────────────────────────────────────────────────

def load_all_templates() -> list[dict]:
    """Load every template JSON and return a normalized list."""
    out = []
    for json_path in sorted(TEMPLATES_DIR.rglob("*.json")):
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  WARN  could not parse {json_path.relative_to(REPO_ROOT)}: {e}")
            continue
        if not data.get("is_published", True):
            continue
        template_id = data.get("id") or json_path.stem
        rel = json_path.relative_to(REPO_ROOT)
        category = rel.parts[2] if len(rel.parts) >= 3 else "uncategorized"
        display = data.get("name") or template_id
        out.append({
            "template_id": template_id,
            "display_name": display,
            "category": category,
            "path": str(rel).replace("\\", "/"),
            "payload": data.get("payload") or {},
            "schema_version": data.get("schema_version") or 1,
        })
    return out


def list_builtin_connectors() -> set[str]:
    if not BUILTIN_CONNECTORS_DIR.exists():
        return set()
    return {p.stem for p in BUILTIN_CONNECTORS_DIR.glob("*.json")}


BUILTINS = list_builtin_connectors()


def classify_connectors(payload: dict) -> dict:
    """Classify connector requirements into available/missing.
    Does NOT handle role-based swap yet (that's at runtime in the adopt wizard).
    Templates with connectors not in builtins and not virtual get skipped."""
    suggested = payload.get("suggested_connectors") or []
    available = []
    missing = []
    for c in suggested:
        if isinstance(c, str):
            name = c
        else:
            name = c.get("name") or c.get("connector_name")
        if not name:
            continue
        if name in VIRTUAL_CONNECTORS:
            available.append(name)
        elif name in BUILTINS:
            available.append(name)
        else:
            missing.append(name)
    return {"available": available, "missing": missing}


# ── Gallery helpers ─────────────────────────────────────────────────────────

_review_id_cache: dict[str, str] = {}


def click_all_filter():
    """Click the 'All <count>' filter tab. testIds aren't set on these,
    so we match by text prefix 'All' followed by a digit."""
    eval_js(r'''
var btns = document.querySelectorAll("button");
for (var i = 0; i < btns.length; i++) {
    var t = (btns[i].textContent || '').trim();
    if (t.indexOf("All") === 0 && /^All\s*\d+/.test(t)) {
        btns[i].click();
        break;
    }
}
''')


def reload_app():
    """Full page reload — the cleanest way to recover from a lingering
    build session between templates. Invalidates gallery cache."""
    _review_id_cache.clear()
    try:
        eval_js('window.location.reload();')
    except Exception:
        pass
    # Give the app time to re-initialize Zustand stores and fetch reviews.
    for _ in range(30):  # up to ~15s
        time.sleep(0.5)
        try:
            st = state()
            if st.get("buildPhase") == "initializing":
                break
        except Exception:
            continue


def go_to_gallery():
    nav("design-reviews")
    time.sleep(0.5)
    click_testid("tab-generated")
    time.sleep(1.0)
    # Ensure the "All" filter is selected so Partial templates are also visible
    click_all_filter()
    time.sleep(0.8)
    try:
        fill_field("template-search-input", "")
    except Exception:
        pass
    time.sleep(0.3)
    for _ in range(10):
        rows = query_dom('[data-testid^="template-row-"]')
        if len(rows) > 0:
            break
        time.sleep(0.8)
    return rows


def rebuild_review_id_map():
    rows = query_dom('[data-testid^="template-row-"]')
    name_to_id = {}
    for row in rows:
        text = row.get("text", "")
        name = text.split("\n")[0].strip()
        rid = (row.get("testId") or "").replace("template-row-", "")
        if name and rid:
            name_to_id[name] = rid
    return name_to_id


def find_review_id(display_name: str) -> str | None:
    if display_name in _review_id_cache:
        return _review_id_cache[display_name]
    m = rebuild_review_id_map()
    _review_id_cache.update(m)
    return m.get(display_name)


# ── Questionnaire fillers ───────────────────────────────────────────────────

def fill_empty_text_inputs():
    """Fill any empty dialog text/textarea inputs with a deterministic value."""
    eval_js(r'''
var dialogs = document.querySelectorAll("[role=dialog]");
for (var d = dialogs.length - 1; d >= 0; d--) {
    var inputs = dialogs[d].querySelectorAll("input, textarea");
    for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var tid = inp.getAttribute("data-testid");
        if (tid === "template-search-input" || tid === "agent-refine-input") continue;
        if (tid) continue;
        if (inp.type === "checkbox" || inp.type === "radio") continue;
        if (inp.value && inp.value.trim() !== "") continue;
        inp.focus();
        var proto = inp.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        var nativeSet = Object.getOwnPropertyDescriptor(proto, "value").set;
        nativeSet.call(inp, "c2-sweep");
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        inp.dispatchEvent(new Event("blur", { bubbles: true }));
    }
}
''')


def click_submit_all():
    """Advance through focus-mode questionnaire until Submit All surfaces.
    QuestionnaireFormFocus shows only one question at a time and the Submit
    button only appears on the last question with everything answered.
    We repeatedly re-fill empty inputs, click "Next" until it's gone, then
    click Submit All. Re-filling is per-step because each Next reveals a new
    question with its own inputs that need values."""
    eval_js(r'''
(function advance(){
    var MAX = 60;
    var i = 0;
    function fillAll() {
        var dialogs = document.querySelectorAll("[role=dialog]");
        for (var d = dialogs.length - 1; d >= 0; d--) {
            var inputs = dialogs[d].querySelectorAll("input, textarea");
            for (var k = 0; k < inputs.length; k++) {
                var inp = inputs[k];
                if (inp.type === "checkbox" || inp.type === "radio") continue;
                var tid = inp.getAttribute("data-testid");
                if (tid === "template-search-input" || tid === "agent-refine-input") continue;
                if (inp.value && inp.value.trim() !== "") continue;
                inp.focus();
                var proto = inp.tagName === "TEXTAREA"
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                var desc = Object.getOwnPropertyDescriptor(proto, "value");
                if (desc && desc.set) desc.set.call(inp, "c2-sweep");
                inp.dispatchEvent(new Event("input", { bubbles: true }));
                inp.dispatchEvent(new Event("change", { bubbles: true }));
                inp.dispatchEvent(new Event("blur", { bubbles: true }));
            }
            // Auto-select the first option of any visible select pill group
            // that has no active selection — this picks a sensible default
            // for capability/domain selects where defaults are strings that
            // don't match any option text.
            var pills = dialogs[d].querySelectorAll('button[data-pill="1"]');
            if (pills.length > 0) {
                var anySelected = false;
                for (var p = 0; p < pills.length; p++) {
                    if ((pills[p].className || "").indexOf("text-primary") >= 0) {
                        anySelected = true; break;
                    }
                }
                if (!anySelected) pills[0].click();
            }
        }
    }
    function step() {
        if (i++ >= MAX) return;
        fillAll();
        var btns = document.querySelectorAll("[role=dialog] button");
        var submit = null, next = null;
        for (var j = 0; j < btns.length; j++) {
            var txt = (btns[j].textContent || '').trim();
            if (!submit && txt.indexOf("Submit All") >= 0) submit = btns[j];
            if (!next && txt === "Next") next = btns[j];
        }
        if (submit) {
            submit.click();
            return;
        }
        if (next && !next.disabled) {
            next.click();
            setTimeout(step, 120);
            return;
        }
    }
    step();
})();
''')


# ── Per-template checks ─────────────────────────────────────────────────────

def check_scope_grouping_rendered() -> tuple[bool, str]:
    """Assert that if v2 scope fields are present, the grouped UI rendered."""
    sections = query_dom('[data-testid^="questionnaire-scope-"]')
    if len(sections) > 0:
        return True, f"{len(sections)} scope section(s)"
    return False, "no scope-grouped sections (legacy layout)"


def fetch_build_state() -> dict:
    return state()


# ── Per-template runner ────────────────────────────────────────────────────

class TemplateResult:
    def __init__(self, tpl: dict):
        self.template_id: str = tpl["template_id"]
        self.display_name: str = tpl["display_name"]
        self.category: str = tpl["category"]
        self.path: str = tpl["path"]
        self.schema_version: int = tpl["schema_version"]
        self.status: str = "pending"
        self.duration_ms: int = 0
        self.connectors: dict = {}
        self.checks: list[dict] = []
        self.issues: list[str] = []
        self.persona_id: str | None = None
        self.build_phase: str | None = None
        self.grade: str | None = None

    def add(self, cid: str, passed: bool, detail: str = ""):
        self.checks.append({"id": cid, "passed": passed, "detail": detail})
        if not passed:
            self.issues.append(f"{cid}: {detail}" if detail else cid)

    def to_dict(self) -> dict:
        return {
            "template_id": self.template_id,
            "display_name": self.display_name,
            "category": self.category,
            "path": self.path,
            "schema_version": self.schema_version,
            "status": self.status,
            "duration_ms": self.duration_ms,
            "connectors": self.connectors,
            "checks": self.checks,
            "issues": self.issues,
            "persona_id": self.persona_id,
            "build_phase": self.build_phase,
            "grade": self.grade,
        }


def grade_from_checks(r: TemplateResult) -> str:
    if not any(c["id"] == "adoption_opens" and c["passed"] for c in r.checks):
        return "F"
    if not any(c["id"] == "persona_created" and c["passed"] for c in r.checks):
        return "F"
    failing = [c for c in r.checks if not c["passed"]]
    if not failing:
        return "A"
    fail_ids = {c["id"] for c in failing}
    # B = only content-gap failures (expected on un-migrated templates)
    cosmetic = {
        "capability_summary_populated",   # v2 hand-fill pending
        "scope_grouping_v2",              # template not tagged with scope
        "use_case_ids_present",           # v1-shaped use cases (no id) — expected
    }
    if fail_ids.issubset(cosmetic):
        return "B"
    critical = {
        "gallery_visible", "adoption_opens", "submit_all",
        "persona_created", "persona_promoted",
        "design_context_has_use_cases",
    }
    if fail_ids & critical:
        return "D"
    return "C"


def run_template(tpl: dict) -> TemplateResult:
    r = TemplateResult(tpl)
    t0 = time.perf_counter()

    conn = classify_connectors(tpl["payload"])
    r.connectors = conn

    # Note missing connectors as a soft warning — the adoption wizard
    # handles missing/swappable connectors gracefully via the role system,
    # so we still attempt the flow and let the harness observe real failures.
    if conn["missing"]:
        r.issues.append(f"connector_not_builtin: {', '.join(conn['missing'])}")

    try:
        # Reset lingering build session from previous template. Full reload
        # is the only reliable way to clear buildPhase=test_complete state
        # that otherwise prevents the next adoption modal from opening.
        reload_app()
        close_all_modals()
        go_to_gallery()

        review_id = find_review_id(r.display_name)
        r.add("gallery_visible", bool(review_id),
              f"review_id={review_id}" if review_id else f"row missing (gallery has {len(_review_id_cache)} entries)")
        if not review_id:
            r.status = "failed_setup"
            r.grade = grade_from_checks(r)
            r.duration_ms = int((time.perf_counter() - t0) * 1000)
            return r

        # Open adoption
        resp = post("/open-matrix-adoption", {"review_id": review_id}, timeout=60)
        opens = bool(resp.get("success"))
        r.add("adoption_opens", opens, resp.get("error", "") if not opens else "")
        if not opens:
            r.status = "failed_open"
            r.grade = grade_from_checks(r)
            r.duration_ms = int((time.perf_counter() - t0) * 1000)
            return r

        # Wait for modal + questionnaire to render. The questionnaire appears
        # BEFORE persona creation — `MatrixAdoptionView.tsx:352` gates the
        # persona seed on `questionsComplete`. So we must:
        #  1. wait for the questionnaire in DOM
        #  2. fill + submit
        #  3. then poll for buildPersonaId + draft_ready
        time.sleep(1.5)
        modals = snapshot().get("modals", [])
        modal_ok = len(modals) > 0
        r.add("modal_opens", modal_ok, f"{len(modals)} modals" if modal_ok else "no modal")

        # Count questions from the rendered questionnaire. The progress bar
        # renders as "N / M answered" with whitespace around the slash.
        q_total = 0
        q_answered = 0
        for m in modals:
            match = re.search(r"(\d+)\s*/\s*(\d+)\s+answered", m.get("text", ""))
            if match:
                q_answered = int(match.group(1))
                q_total = int(match.group(2))
                break
        expects_questions = bool(tpl["payload"].get("adoption_questions"))
        r.add("questionnaire_renders",
              q_total > 0 or not expects_questions,
              f"{q_answered}/{q_total} questions rendered (template declares {len(tpl['payload'].get('adoption_questions') or [])})")

        # Scope grouping (v2 expectation)
        v2_scope_expected = any(
            (q or {}).get("scope") in ("persona", "capability", "connector")
            for q in (tpl["payload"].get("adoption_questions") or [])
        )
        if v2_scope_expected:
            grouped_ok, grouped_detail = check_scope_grouping_rendered()
            r.add("scope_grouping_v2", grouped_ok, grouped_detail)

        # Fill any empty inputs, then submit. Always attempt submit when the
        # template declared questions — even if q_total == 0, the text may
        # have been scraped imperfectly and the Submit button may still exist.
        if q_total > 0 or expects_questions:
            fill_empty_text_inputs()
            time.sleep(0.6)
            click_submit_all()

        # Poll for persona seeding after submission — or immediately if there
        # were no questions (the seed effect fires on mount in that case).
        bs = {}
        for _ in range(40):  # up to ~20s
            time.sleep(0.5)
            bs = fetch_build_state()
            if bs.get("buildPersonaId") and bs.get("buildPhase") in {
                "awaiting_input", "draft_ready", "test_complete", "promoted", "resolving", "testing", "analyzing"
            }:
                break
        r.persona_id = bs.get("buildPersonaId")
        r.build_phase = bs.get("buildPhase")
        r.add("persona_created", bool(r.persona_id),
              f"id={r.persona_id} phase={r.build_phase}" if r.persona_id
              else f"no buildPersonaId (phase={r.build_phase})")
        r.add("submit_all",
              r.build_phase in {"draft_ready", "test_complete", "promoted", "testing", "resolving", "analyzing"},
              f"buildPhase={r.build_phase}")

        # Short-circuit: if persona never got created, skip test/promote/validate.
        # Otherwise we'd waste ~150s polling for a terminal state that will never come.
        if not r.persona_id:
            r.status = "evaluated"
            r.grade = grade_from_checks(r)
            r.duration_ms = int((time.perf_counter() - t0) * 1000)
            return r

        # Wait for draft_ready (auto-test may run first). Since build typically
        # goes initializing -> awaiting_input -> (user submits) -> resolving ->
        # draft_ready -> testing -> test_complete, wait up to ~45s for a terminal
        # non-failure phase.
        terminal = {"draft_ready", "test_complete", "promoted", "failed", "cancelled"}
        for _ in range(90):
            time.sleep(0.5)
            bs = fetch_build_state()
            r.build_phase = bs.get("buildPhase")
            if r.build_phase in terminal:
                break

        # Test Agent — if auto-test didn't fire and phase is draft_ready,
        # explicitly click it. Check for output lines.
        if not args.skip_test_agent:
            if r.build_phase == "draft_ready":
                test_btns = query_dom('[data-testid="agent-test-btn"]')
                if test_btns:
                    click_testid("agent-test-btn")
                    time.sleep(1.0)
            # Poll for test output / completion
            detected = False
            for _ in range(60):  # up to ~60s
                time.sleep(1.0)
                bs3 = fetch_build_state()
                r.build_phase = bs3.get("buildPhase") or r.build_phase
                test_lines = len(bs3.get("buildTestOutputLines") or [])
                if test_lines > 0 and r.build_phase in {"test_complete", "draft_ready", "promoted"}:
                    detected = True
                    r.add("test_agent_runs", True, f"{test_lines} output lines, phase={r.build_phase}")
                    break
                if bs3.get("buildTestError"):
                    r.add("test_agent_runs", False, f"error={str(bs3['buildTestError'])[:120]}")
                    detected = True
                    break
                if r.build_phase in {"failed", "cancelled"}:
                    r.add("test_agent_runs", False, f"phase={r.build_phase}")
                    detected = True
                    break
            if not detected:
                r.add("test_agent_runs", False, f"no terminal state (phase={r.build_phase})")

        # Promote — move the persona from draft to production. Keeps it in the
        # personas list so the user can inspect it afterwards.
        if r.build_phase in {"draft_ready", "test_complete"}:
            promote_resp = post("/promote-build", {}, timeout=60)
            promoted_ok = bool(promote_resp.get("success"))
            r.add("persona_promoted", promoted_ok,
                  f"phase={r.build_phase}" if promoted_ok
                  else f"error={promote_resp.get('error','?')}")
            if promoted_ok:
                time.sleep(1.0)
                bs4 = fetch_build_state()
                r.build_phase = bs4.get("buildPhase") or r.build_phase
        elif r.persona_id:
            r.add("persona_promoted", False, f"cannot promote from phase={r.build_phase}")

        # Validate persona detail post-promote. The bridge returns the flat
        # PersonaDetail shape: { success, detail: { ...persona fields,
        # tools, triggers, subscriptions, automations } }.
        if r.persona_id:
            dresp = post("/persona-detail", {"persona_id": r.persona_id}, timeout=30)
            if dresp.get("success") and dresp.get("detail"):
                detail = dresp["detail"]
                dc_raw = detail.get("design_context")
                try:
                    dc = json.loads(dc_raw) if isinstance(dc_raw, str) else (dc_raw or {})
                except json.JSONDecodeError:
                    dc = {}
                use_cases = dc.get("useCases") or dc.get("use_cases") or []
                r.add("design_context_has_use_cases",
                      len(use_cases) > 0,
                      f"{len(use_cases)} useCases in design_context")
                r.add("use_case_ids_present",
                      all(bool(uc.get("id")) for uc in use_cases) if use_cases else False,
                      f"ids populated on all {len(use_cases)} useCases" if use_cases
                      else "no useCases")
                summaries_filled = sum(
                    1 for uc in use_cases
                    if uc.get("capability_summary") or uc.get("capabilitySummary")
                )
                r.add("capability_summary_populated",
                      bool(use_cases) and summaries_filled == len(use_cases),
                      f"summaries present on {summaries_filled}/{len(use_cases)}")
                triggers = detail.get("triggers") or []
                attributed = sum(1 for t in triggers if t.get("use_case_id") or t.get("useCaseId"))
                r.add("triggers_attributed",
                      len(triggers) == 0 or attributed > 0,
                      f"{attributed}/{len(triggers)} triggers carry use_case_id")
                subscriptions = detail.get("subscriptions") or []
                sub_attributed = sum(1 for s in subscriptions if s.get("use_case_id") or s.get("useCaseId"))
                r.add("subscriptions_attributed",
                      len(subscriptions) == 0 or sub_attributed > 0,
                      f"{sub_attributed}/{len(subscriptions)} subscriptions carry use_case_id")
                # Stash stats for the report so humans can inspect
                r.issues.append(
                    f"summary: useCases={len(use_cases)} "
                    f"triggers={len(triggers)}({attributed}uc) "
                    f"subscriptions={len(subscriptions)}"
                )
            else:
                r.add("persona_detail_fetch", False,
                      f"fetch failed: {dresp.get('error', '?')}")

        r.status = "evaluated"

    except Exception as e:
        r.status = "error"
        r.issues.append(f"exception: {e}")
    finally:
        # DO NOT delete personas — user inspects them post-sweep to verify
        # C2 migration quality. Just close any open modals for cleanliness.
        try:
            close_all_modals()
        except Exception:
            pass
        r.duration_ms = int((time.perf_counter() - t0) * 1000)

    r.grade = grade_from_checks(r)
    return r


# ── Main ────────────────────────────────────────────────────────────────────

def health_check():
    try:
        r = httpx.get(f"{BASE}/health", timeout=5)
        data = r.json()
        if data.get("status") != "ok":
            raise RuntimeError(f"unhealthy: {data}")
        print(f"  OK    server={data.get('server')} v={data.get('version')}")
    except Exception as e:
        print(f"  FAIL  health check: {e}")
        print(f"        Is the app running with --features test-automation on port {args.port}?")
        sys.exit(2)


def main():
    print("\n=== C2 Template Adoption Sweep ===\n")
    print(f"  port:        {args.port}")
    print(f"  templates:   {TEMPLATES_DIR.relative_to(REPO_ROOT)}")
    print(f"  builtins:    {len(BUILTINS)} connectors")
    print()

    print("=== 0. Health Check ===")
    health_check()
    print()

    print("=== 1. Load Templates ===")
    all_templates = load_all_templates()
    print(f"  loaded {len(all_templates)} templates")

    if args.category:
        all_templates = [t for t in all_templates if t["category"].lower() == args.category.lower()]
        print(f"  filtered by category '{args.category}': {len(all_templates)} templates")

    if args.template:
        q = args.template.lower()
        all_templates = [t for t in all_templates if q in t["display_name"].lower() or q in t["template_id"].lower()]
        print(f"  filtered by name '{args.template}': {len(all_templates)} templates")

    if args.limit > 0:
        all_templates = all_templates[: args.limit]
        print(f"  limited to {len(all_templates)} templates")

    if not all_templates:
        print("  nothing to run — exiting")
        sys.exit(0)

    print()
    print("=== 2. Warm up gallery ===")
    close_all_modals()
    rows = go_to_gallery()
    _review_id_cache.update(rebuild_review_id_map())
    print(f"  gallery rows: {len(rows)}; name->review_id pairs: {len(_review_id_cache)}")

    print()
    print("=== 3. Per-template runs ===")
    results: list[TemplateResult] = []
    for idx, tpl in enumerate(all_templates, start=1):
        print(f"  [{idx:3d}/{len(all_templates)}] {tpl['display_name']}  ({tpl['category']})")
        r = run_template(tpl)
        results.append(r)
        status_txt = r.status
        if r.grade:
            status_txt += f" grade={r.grade}"
        status_txt += f" {r.duration_ms}ms"
        if r.issues and r.status != "skipped":
            status_txt += f"  issues={len(r.issues)}"
        print(f"           -> {status_txt}")

    # ── Aggregate report ──────────────────────────────────────────────────
    print()
    print("=== 4. Summary ===")
    grade_count = {k: 0 for k in ("A", "B", "C", "D", "F", "skip")}
    for r in results:
        grade_count[r.grade or "F"] = grade_count.get(r.grade or "F", 0) + 1
    for g, n in grade_count.items():
        print(f"  {g}: {n}")

    failure_patterns: dict[str, int] = {}
    for r in results:
        for c in r.checks:
            if not c["passed"]:
                failure_patterns[c["id"]] = failure_patterns.get(c["id"], 0) + 1

    print()
    print("  Failure pattern counts:")
    for cid, n in sorted(failure_patterns.items(), key=lambda kv: -kv[1]):
        print(f"    {cid}: {n}")

    # Write report
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = Path(args.report) if args.report else REPORTS_DIR / f"c2-sweep-{ts}.json"
    report_path.write_text(json.dumps({
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "total_templates": len(results),
        "grade_distribution": grade_count,
        "failure_patterns": failure_patterns,
        "results": [r.to_dict() for r in results],
    }, indent=2), encoding="utf-8")
    print()
    print(f"  report written -> {report_path.relative_to(REPO_ROOT) if report_path.is_relative_to(REPO_ROOT) else report_path}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\ninterrupted")
        sys.exit(130)
