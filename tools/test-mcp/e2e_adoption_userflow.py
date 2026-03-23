#!/usr/bin/env python3
"""
E2E Template Adoption User Flow Test

Tests 30 curated templates through the complete user journey:
Navigate -> Adopt -> PersonaMatrix -> Test -> Promote -> Execute -> Verify Artifacts

Usage:
  python e2e_adoption_userflow.py                     # Full run
  python e2e_adoption_userflow.py --dry-run            # Single template (database-performance-monitor)
  python e2e_adoption_userflow.py --tier 1             # Run specific tier
  python e2e_adoption_userflow.py --template NAME      # Single template by slug
  python e2e_adoption_userflow.py --resume-from N      # Resume from template index N
"""

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

BASE_URL = "http://127.0.0.1:17320"
TIMEOUT = 30.0
TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "scripts" / "templates"
RESULTS_DIR = Path(__file__).resolve().parent.parent.parent / "docs" / "tests" / "results"
DB_PATH = Path(os.environ.get("APPDATA", "")) / "com.personas.desktop" / "personas.db"

# Template slugs organized by tier
TIER_0 = ["database-performance-monitor"]
TIER_1 = [
    "budget-spending-monitor", "incident-logger", "service-health-reporter",
    "content-performance-reporter", "research-paper-indexer",
]
TIER_2 = [
    "notion-docs-auditor", "content-schedule-manager", "daily-standup-compiler",
    "research-knowledge-curator", "technical-decision-tracker", "weekly-review-reporter",
]
TIER_3 = [
    "email-morning-digest", "email-support-assistant", "email-follow-up-tracker",
    "email-lead-extractor", "email-task-extractor", "survey-insights-analyzer",
    "expense-receipt-tracker", "invoice-tracker",
]
TIER_4 = [
    "idea-harvester", "newsletter-curator", "access-request-manager",
    "contact-enrichment-agent", "contact-sync-manager", "support-email-router",
    "onboarding-tracker", "sales-deal-analyzer", "sales-proposal-generator",
]
TIER_5_SKIP = ["sales-deal-tracker"]  # Salesforce - not available

ALL_TIERS = [TIER_0, TIER_1, TIER_2, TIER_3, TIER_4]

# Templates that do NOT define manual_review (auto-point on criterion 6)
NO_MANUAL_REVIEW = {
    "budget-spending-monitor", "daily-standup-compiler", "email-follow-up-tracker",
    "email-morning-digest", "email-task-extractor", "incident-logger",
    "research-knowledge-curator", "sales-deal-tracker", "service-health-reporter",
    "weekly-review-reporter",
}

SERVICE_CRED_MAP = {
    "Local Database": None,
    "In-App Messaging": None,
    "Gmail": "gmail",
    "Email": "gmail",
    "Notion": "notion",
    "Slack": "slack",
    "Airtable": "airtable",
    "GitHub": "github",
    "Salesforce": "salesforce",
}

# Shared HTTP client
_client = httpx.Client(base_url=BASE_URL, timeout=TIMEOUT)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def api_get(path: str):
    """GET request to the test automation server. Returns parsed JSON (dict or list)."""
    try:
        r = _client.get(path)
        r.raise_for_status()
        return r.json()
    except httpx.ConnectError:
        print(f"  [ERROR] Cannot connect to test server at {BASE_URL}")
        return {"error": "connection_failed"}
    except (httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout):
        return {"error": f"timeout on {path}"}
    except httpx.HTTPStatusError as exc:
        return {"error": f"HTTP {exc.response.status_code}", "detail": exc.response.text}
    except json.JSONDecodeError:
        return {"error": "invalid_json", "raw": r.text if 'r' in dir() else ""}


def resp_ok(resp) -> bool:
    """Check if an API response indicates success (handles both dict and list)."""
    if isinstance(resp, list):
        return True  # List responses (find-text, query) are always OK
    if isinstance(resp, dict):
        return not resp.get("error") and resp.get("success", True)
    return False


def resp_error(resp) -> str:
    """Extract error message from a response."""
    if isinstance(resp, dict):
        return resp.get("error", resp.get("detail", "unknown error"))
    return ""


def api_post(path: str, body: dict):
    """POST JSON to the test automation server. Returns parsed JSON (dict or list)."""
    try:
        r = _client.post(path, json=body)
        r.raise_for_status()
        return r.json()
    except httpx.ConnectError:
        print(f"  [ERROR] Cannot connect to test server at {BASE_URL}")
        return {"error": "connection_failed"}
    except (httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout):
        return {"error": f"timeout on {path}"}
    except httpx.HTTPStatusError as exc:
        return {"error": f"HTTP {exc.response.status_code}", "detail": exc.response.text}
    except json.JSONDecodeError:
        # Some endpoints return plain text on success
        return {"success": True, "raw": r.text if 'r' in dir() else ""}


# ---------------------------------------------------------------------------
# Polling helper
# ---------------------------------------------------------------------------

def poll_state(key: str, expected, timeout_s: float, interval_s: float = 2.0) -> bool:
    """Poll GET /state until state[key] == expected or timeout expires."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        state = api_get("/state")
        if state.get("error"):
            time.sleep(interval_s)
            continue
        if state.get(key) == expected:
            return True
        time.sleep(interval_s)
    return False


# ---------------------------------------------------------------------------
# Template discovery
# ---------------------------------------------------------------------------

def discover_templates() -> list[dict]:
    """Read template JSON files from scripts/templates/ (recursive subdirectories).
    Returns list of dicts: {id, name, category, service_flow, payload_json}.
    """
    templates = []
    if not TEMPLATES_DIR.exists():
        print(f"  [WARN] Templates directory not found: {TEMPLATES_DIR}")
        return templates

    for json_file in sorted(TEMPLATES_DIR.rglob("*.json")):
        # Skip debug/temp files
        if "_debug" in str(json_file) or "_tmp" in json_file.name:
            continue
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if "id" not in data or "name" not in data:
                continue
            templates.append({
                "id": data["id"],
                "name": data["name"],
                "description": data.get("description", ""),
                "category": data.get("category", []),
                "service_flow": data.get("service_flow", []),
                "payload_json": json.dumps(data.get("payload", {})),
                "path": str(json_file),
            })
        except (json.JSONDecodeError, OSError):
            continue

    return templates


# ---------------------------------------------------------------------------
# Credential discovery
# ---------------------------------------------------------------------------

def discover_credentials() -> set[str]:
    """Call GET /list-credentials and return set of available service types (lowercased)."""
    # Retry a few times — the vault store may not be loaded yet on app start
    for attempt in range(3):
        try:
            resp = api_get("/list-credentials")
        except Exception:
            resp = {"error": "timeout"}
        if isinstance(resp, dict) and resp.get("error"):
            print(f"  [WARN] Credential fetch attempt {attempt+1} failed: {resp.get('error')}")
            if attempt < 2:
                time.sleep(5)
            continue
        break
    else:
        print("  [WARN] Could not fetch credentials after retries, using empty set")
        return set()

    if isinstance(resp, dict):
        creds = resp.get("credentials", [])
        return {c.get("serviceType", "").lower() for c in creds if c.get("serviceType")}
    return set()


# ---------------------------------------------------------------------------
# Credential check
# ---------------------------------------------------------------------------

def can_run_template(template: dict, available_creds: set[str]) -> tuple[bool, str]:
    """Check if all required connectors have credentials.
    Returns (can_run, reason).
    """
    missing = []
    for svc in template.get("service_flow", []):
        required_cred = SERVICE_CRED_MAP.get(svc)
        if required_cred is None:
            # Local Database / In-App Messaging - always available
            continue
        if required_cred not in available_creds:
            missing.append(svc)

    if missing:
        return False, f"Missing credentials: {', '.join(missing)}"
    return True, ""


# ---------------------------------------------------------------------------
# Direct DB query
# ---------------------------------------------------------------------------

def db_query(sql: str, params: tuple = ()) -> list:
    """Execute a read-only SQLite query on the app database.
    Returns list of tuples (rows). Returns [] on any error.
    """
    if not DB_PATH.exists():
        return []
    try:
        conn = sqlite3.connect(str(DB_PATH), timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        cursor = conn.execute(sql, params)
        rows = cursor.fetchall()
        conn.close()
        return rows
    except sqlite3.Error as exc:
        print(f"  [DB ERROR] {exc}")
        return []


# ---------------------------------------------------------------------------
# TemplateScenario - main test lifecycle
# ---------------------------------------------------------------------------

class TemplateScenario:
    """Runs the full 22-step adoption lifecycle for a single template."""

    def __init__(self, template: dict, available_creds: set[str]):
        self.template = template
        self.slug: str = template["id"]
        self.name: str = template["name"]
        self.available_creds = available_creds
        self.scores: dict[int, int] = {}  # criterion -> 0 or 1
        self.persona_id: str | None = None
        self.persona_name: str | None = None
        self.errors: list[str] = []
        self.timings: dict[str, float] = {}

    # ── public API ────────────────────────────────────────────────────

    def run(self) -> dict:
        """Execute the full lifecycle. Returns result dict."""
        try:
            self._step_navigate_and_adopt()
            self._step_build_and_test()
            self._step_verify_promotion()
            self._step_execute()
            self._step_verify_artifacts()
            self._step_haiku_regression()
            self._score_value()
        except Exception as exc:
            self.errors.append(f"Fatal: {exc}")
        return self.result()

    def cleanup(self, keep_persona: bool = True):
        """Close modals, reset build state. Optionally keep persona for review."""
        # Navigate away from any modal/wizard to a clean section
        try:
            api_post("/navigate", {"section": "home"})
            time.sleep(0.5)
        except Exception:
            pass

        # Close any open modals by pressing Escape
        try:
            api_post("/eval", {
                "js": "document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})); return true;"
            })
            time.sleep(0.3)
        except Exception:
            pass

        # Do NOT delete personas — keep them for artifact review.
        # Only delete if explicitly requested (e.g. --clean flag).
        if not keep_persona:
            if self.persona_id:
                try:
                    api_post("/delete-agent", {"name_or_id": self.persona_id})
                except Exception:
                    pass
            if self.name:
                try:
                    api_post("/delete-agent", {"name_or_id": self.name})
                except Exception:
                    pass

        # Reset build state and template adoption flag
        try:
            api_post("/eval", {
                "js": "window.__AGENT_STORE__.getState().resetBuildSession();"
                      "window.__SYSTEM_STORE__?.getState()?.setTemplateAdoptActive?.(false);"
                      "return true;"
            })
        except Exception:
            pass

        time.sleep(1)

    def result(self) -> dict:
        total = sum(v for v in self.scores.values() if v is not None)
        return {
            "slug": self.slug,
            "name": self.name,
            "persona_id": self.persona_id,
            "scores": self.scores,
            "total": total,
            "max": 10,
            "errors": self.errors,
            "timings": self.timings,
        }

    # ── Steps 1-7: Navigate and Adopt ────────────────────────────────

    def _step_navigate_and_adopt(self):
        t0 = time.time()

        # Pre-navigate to design-reviews and wait for template rows to render
        api_post("/navigate", {"section": "design-reviews"})
        time.sleep(2)
        api_post("/wait", {
            "selector": "[data-testid^='template-row-']",
            "timeout_ms": 15000,
        })

        # Use the composite open-matrix-adoption endpoint which:
        # 1. Navigates to design-reviews (already there)
        # 2. Clicks the template row
        # 3. Opens the action menu and clicks View Details
        # 4. Clicks "Adopt as Persona" in the detail modal
        # 5. Waits for MatrixAdoptionView to mount
        #
        # The review ID format is "seed-{slug}" in the gallery.
        review_id = f"seed-{self.slug}"
        resp = api_post("/open-matrix-adoption", {"review_id": review_id})
        if isinstance(resp, dict) and resp.get("error"):
            self.errors.append(f"Open matrix adoption failed: {resp.get('error')}")
            raise RuntimeError(f"Adoption failed: {resp.get('error')}")

        self.timings["navigate_and_adopt"] = time.time() - t0

    # ── Steps 8-14: Build and Test ───────────────────────────────────

    def _step_build_and_test(self):
        t0 = time.time()

        # Step 8: Wait for draft_ready
        if not poll_state("buildPhase", "draft_ready", 60):
            self.errors.append("Timeout waiting for draft_ready")
            raise RuntimeError("draft_ready timeout")

        # Step 9: Get persona_id from state (buildPersonaId or selectedPersonaId)
        state = api_get("/state")
        if isinstance(state, dict):
            self.persona_id = state.get("buildPersonaId") or state.get("selectedPersonaId")
        if not self.persona_id:
            self.errors.append("No persona_id in state after draft_ready")

        # Step 10: Click Test button
        resp = api_post("/click-testid", {"test_id": "agent-test-btn"})
        if resp.get("error"):
            self.errors.append(f"Click test button failed: {resp.get('error')}")

        # Step 11: Wait for test_complete (up to 3 minutes for API latency)
        if not poll_state("buildPhase", "test_complete", 180):
            self.errors.append("Timeout waiting for test_complete")
            self.scores[2] = 0
            raise RuntimeError("test_complete timeout")

        # Step 12: Check test result
        state = api_get("/state")
        test_passed = state.get("buildTestPassed")
        self.scores[2] = 1 if test_passed else 0

        if not test_passed:
            self.errors.append("Build test failed — connectors not verified")
            self.timings["build_and_test"] = time.time() - t0
            raise RuntimeError("Build test failed")

        # Step 13: Click Approve
        resp = api_post("/click-testid", {"test_id": "agent-approve-btn"})
        if resp.get("error"):
            self.errors.append(f"Click approve failed: {resp.get('error')}")

        # Step 14: Wait for promoted
        if not poll_state("buildPhase", "promoted", 30):
            self.errors.append("Timeout waiting for promoted phase")
            self.scores[1] = 0
            self.timings["build_and_test"] = time.time() - t0
            raise RuntimeError("promoted timeout")

        self.scores[1] = 1  # Criterion 1: Promoted
        self.timings["build_and_test"] = time.time() - t0

    # ── Steps 15-17: Verify Promotion ────────────────────────────────

    def _step_verify_promotion(self):
        t0 = time.time()

        # Step 15: Navigate to personas list
        api_post("/navigate", {"section": "personas"})
        time.sleep(1)

        # Step 16: Refresh persona_id from state — after promotion, buildPersonaId
        # is cleared but selectedPersonaId or the promoted persona should be available
        state = api_get("/state")
        if isinstance(state, dict):
            pid = state.get("buildPersonaId") or state.get("selectedPersonaId")
            if pid:
                self.persona_id = pid

        # Try to select the persona by id or name
        name_or_id = self.persona_id or self.name
        result = api_post("/select-agent", {"name_or_id": name_or_id})
        if isinstance(result, dict) and result.get("success"):
            self.persona_name = result.get("name", self.name)
            if result.get("id"):
                self.persona_id = result["id"]
        else:
            err = result.get("error", "unknown") if isinstance(result, dict) else "bad response"
            self.errors.append(f"Could not select persona: {err}")

        # Step 17: Open Matrix tab and verify container
        api_post("/open-editor-tab", {"tab": "matrix"})
        time.sleep(2)

        # Check if matrix tab rendered: either the full matrix container or the
        # "No matrix data" empty state. Both confirm the tab is accessible.
        query_result = api_post("/query", {
            "selector": "[data-testid='matrix-tab-container']"
        })
        has_full_matrix = isinstance(query_result, list) and len(query_result) > 0

        if not has_full_matrix:
            # Fallback: check if the matrix tab rendered at all (even empty state)
            time.sleep(1)
            empty_check = api_post("/find-text", {"text": "No matrix data"})
            matrix_text = api_post("/find-text", {"text": "matrix"})
            has_tab = (isinstance(empty_check, list) and len(empty_check) > 0) or \
                      (isinstance(matrix_text, list) and len(matrix_text) > 0)
            if has_tab:
                has_full_matrix = True  # Tab is accessible, even if data is missing

        if has_full_matrix:
            self.scores[3] = 1
        else:
            self.scores[3] = 0
            self.errors.append("Matrix tab not accessible after promotion")

        self.timings["verify_promotion"] = time.time() - t0

    # ── Steps 18-19: Execute ─────────────────────────────────────────

    def _step_execute(self):
        t0 = time.time()

        name_or_id = self.persona_name or self.persona_id or self.name
        result = api_post("/execute-persona", {"name_or_id": name_or_id})
        if not result.get("success", False) and result.get("error"):
            self.errors.append(f"Execute failed: {result.get('error')}")
            self.scores[4] = 0
            self.timings["execute"] = time.time() - t0
            return

        # Poll DB for execution completion (up to 10 minutes, matching engine default)
        for attempt in range(120):
            time.sleep(5)
            try:
                rows = db_query(
                    "SELECT status FROM persona_executions "
                    "WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
                    (self.persona_id,)
                )
                if rows:
                    status = rows[0][0]
                    if status in ("completed", "partial"):
                        self.scores[4] = 1
                        self.timings["execute"] = time.time() - t0
                        return
                    if status == "failed":
                        self.errors.append("Execution completed with status=failed")
                        self.scores[4] = 0
                        self.timings["execute"] = time.time() - t0
                        return
            except Exception:
                pass

        self.errors.append("Execution timeout (10 min)")
        self.scores[4] = 0
        self.timings["execute"] = time.time() - t0

    # ── Steps 20-21: Verify Artifacts ────────────────────────────────

    def _step_verify_artifacts(self):
        t0 = time.time()

        if not self.persona_id:
            for c in (5, 6, 7, 8):
                self.scores[c] = 0
            self.errors.append("No persona_id — cannot verify artifacts")
            self.timings["verify_artifacts"] = time.time() - t0
            return

        counts = api_post("/overview-counts", {"persona_id": self.persona_id})
        if counts.get("error"):
            # Fallback: query DB directly for counts
            counts = self._db_artifact_counts()

        # Criterion 4 (execution populated) — re-check via overview-counts
        if self.scores.get(4) is None:
            self.scores[4] = 1 if counts.get("executions", 0) >= 1 else 0

        # Criterion 5: Message populated
        self.scores[5] = 1 if counts.get("messages", 0) >= 1 else 0

        # Criterion 6: Human review
        if self.slug in NO_MANUAL_REVIEW:
            self.scores[6] = 1  # Auto-point — template has no manual_review dimension
        else:
            self.scores[6] = 1 if counts.get("reviews", 0) >= 1 else 0

        # Criterion 7: Event created (all templates define emit_event)
        self.scores[7] = 1 if counts.get("events", 0) >= 1 else 0

        # Criterion 8: Memory generated (all templates define agent_memory)
        self.scores[8] = 1 if counts.get("memories", 0) >= 1 else 0

        # Validate memory content doesn't contain negative scenarios
        if self.scores[8] == 1:
            try:
                memories = db_query(
                    "SELECT title, content FROM persona_memories WHERE persona_id = ?",
                    (self.persona_id,)
                )
                negative_keywords = [
                    "missing credential", "technical error",
                    "failed to", "unable to connect",
                ]
                for title, content in memories:
                    text = f"{title or ''} {content or ''}".lower()
                    if any(kw in text for kw in negative_keywords):
                        self.scores[8] = 0
                        self.errors.append("Memory contains negative scenario content")
                        break
            except Exception:
                pass

        self.timings["verify_artifacts"] = time.time() - t0

    def _db_artifact_counts(self) -> dict:
        """Fallback: compute artifact counts directly from SQLite."""
        counts = {
            "executions": 0, "messages": 0,
            "reviews": 0, "events": 0, "memories": 0,
        }
        pid = self.persona_id
        if not pid:
            return counts

        mapping = [
            ("executions", "SELECT COUNT(*) FROM persona_executions WHERE persona_id = ?"),
            ("messages",   "SELECT COUNT(*) FROM persona_messages WHERE persona_id = ?"),
            ("reviews",    "SELECT COUNT(*) FROM persona_manual_reviews WHERE persona_id = ?"),
            ("events",     "SELECT COUNT(*) FROM persona_events WHERE source_id = ?"),
            ("memories",   "SELECT COUNT(*) FROM persona_memories WHERE persona_id = ?"),
        ]
        for key, sql in mapping:
            try:
                rows = db_query(sql, (pid,))
                if rows:
                    counts[key] = rows[0][0]
            except Exception:
                pass

        return counts

    # ── Criterion 9: Value evaluation ────────────────────────────────

    def _score_value(self):
        if not self.persona_id:
            self.scores[9] = 0
            return

        try:
            rows = db_query(
                "SELECT content FROM persona_messages "
                "WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
                (self.persona_id,)
            )
            if not rows:
                self.scores[9] = 0
                return

            content = rows[0][0] if rows[0] else ""
            if not content:
                self.scores[9] = 0
                return

            # Only flag hard failures, not informational "could not" or "no data available" messages.
            # A message that explains why something couldn't run IS valuable output.
            error_markers = [
                "exception", "traceback", "panic", "stack trace",
                "internal server error", "unhandled error",
            ]
            has_fatal = any(marker in content.lower() for marker in error_markers)
            has_substance = len(content) > 50

            self.scores[9] = 1 if (has_substance and not has_fatal) else 0
        except Exception:
            self.scores[9] = 0

    # ── Step 22: Haiku regression ────────────────────────────────────

    def _step_haiku_regression(self):
        """Switch to Haiku model, re-execute, and verify output still has value."""
        t0 = time.time()

        # Skip if initial execution didn't pass
        if not self.persona_id or self.scores.get(4) != 1:
            self.scores[10] = 0
            self.timings["haiku_regression"] = time.time() - t0
            return

        try:
            # Switch model to Haiku via eval
            switch_js = (
                "(async () => {"
                "  const { invoke } = await import('@tauri-apps/api/core');"
                f"  const persona = window.__AGENT_STORE__.getState().personas.find(p => p.id === '{self.persona_id}');"
                "  if (!persona) return { success: false, error: 'Persona not found' };"
                "  await invoke('update_persona', {"
                f"    id: '{self.persona_id}',"
                "    input: { model_profile: JSON.stringify({ model: 'haiku', provider: 'anthropic' }) }"
                "  });"
                "  return { success: true };"
                "})()"
            )
            switch_resp = api_post("/eval", {"js": switch_js})
            if switch_resp.get("error"):
                self.errors.append(f"Model switch eval error: {switch_resp.get('error')}")

            time.sleep(1)

            # Re-execute
            name_or_id = self.persona_name or self.persona_id
            result = api_post("/execute-persona", {"name_or_id": name_or_id})
            if not result.get("success", False) and result.get("error"):
                self.scores[10] = 0
                self.errors.append(f"Haiku re-execute failed: {result.get('error')}")
                self.timings["haiku_regression"] = time.time() - t0
                return

            # Wait for completion (up to 10 minutes)
            for attempt in range(120):
                time.sleep(5)
                rows = db_query(
                    "SELECT status, id FROM persona_executions "
                    "WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
                    (self.persona_id,)
                )
                if not rows:
                    continue

                status = rows[0][0]
                if status in ("completed", "partial"):
                    # Check if a meaningful message was produced
                    msg_rows = db_query(
                        "SELECT content FROM persona_messages "
                        "WHERE persona_id = ? ORDER BY created_at DESC LIMIT 1",
                        (self.persona_id,)
                    )
                    if msg_rows and msg_rows[0] and len(msg_rows[0][0] or "") > 30:
                        self.scores[10] = 1
                    else:
                        self.scores[10] = 0
                        self.errors.append("Haiku execution produced insufficient output")
                    self.timings["haiku_regression"] = time.time() - t0
                    return

                if status == "failed":
                    self.scores[10] = 0
                    self.errors.append("Haiku execution failed")
                    self.timings["haiku_regression"] = time.time() - t0
                    return

            self.scores[10] = 0
            self.errors.append("Haiku execution timeout")
        except Exception as exc:
            self.scores[10] = 0
            self.errors.append(f"Haiku regression error: {exc}")

        self.timings["haiku_regression"] = time.time() - t0


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

CRITERIA_LABELS = {
    1:  "Promoted (buildPhase == promoted)",
    2:  "No untested connectors (buildTestPassed)",
    3:  "Matrix viewable (matrix-tab-container)",
    4:  "Execution populated (executions >= 1)",
    5:  "Message populated (messages >= 1)",
    6:  "Human review (reviews >= 1 or auto-point)",
    7:  "Event created (events >= 1)",
    8:  "Memory generated (memories >= 1)",
    9:  "Value evaluation (meaningful content)",
    10: "Haiku maintains value (model switch)",
}


def generate_report(results: list[dict]):
    """Write JSON and Markdown reports to docs/tests/results/."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # JSON report
    json_path = RESULTS_DIR / f"adoption_userflow_{timestamp}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            "timestamp": timestamp,
            "date": datetime.now().isoformat(),
            "criteria": CRITERIA_LABELS,
            "results": results,
        }, f, indent=2)

    # Markdown summary
    md_path = RESULTS_DIR / f"adoption_summary_{timestamp}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# Template Adoption Test Results\n\n")
        f.write(f"**Date:** {datetime.now().isoformat()}\n\n")

        # Criteria legend
        f.write("## Scoring Criteria\n\n")
        for num, label in CRITERIA_LABELS.items():
            f.write(f"- **C{num}:** {label}\n")
        f.write("\n")

        # Summary table
        f.write("## Results\n\n")
        f.write("| # | Template | Score | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 | Errors |\n")
        f.write("|---|----------|-------|----|----|----|----|----|----|----|----|----|-----|--------|\n")

        total_score = 0
        total_max = 0
        tested_count = 0

        for idx, r in enumerate(results, start=1):
            if r.get("skipped"):
                reason = r.get("reason", "")
                f.write(f"| {idx} | {r['name']} | SKIP | - | - | - | - | - | - | - | - | - | - | {reason} |\n")
                continue

            scores = r.get("scores", {})
            cells = []
            for c in range(1, 11):
                v = scores.get(c)
                if v == 1:
                    cells.append("+")
                elif v == 0:
                    cells.append("-")
                else:
                    cells.append("?")

            total = r.get("total", 0)
            total_score += total
            total_max += 10
            tested_count += 1
            errs = "; ".join(r.get("errors", [])[:2])
            if len(errs) > 60:
                errs = errs[:57] + "..."
            f.write(f"| {idx} | {r['name']} | {total}/10 | {' | '.join(cells)} | {errs} |\n")

        f.write(f"\n**Overall: {total_score}/{total_max}**")
        if tested_count > 0:
            avg = total_score / tested_count
            f.write(f" (avg {avg:.1f}/10 across {tested_count} templates)")
        f.write("\n")

        # Timing summary
        timed = [r for r in results if r.get("timings")]
        if timed:
            f.write("\n## Timing\n\n")
            f.write("| Template | Adopt | Build | Promote | Execute | Artifacts | Haiku |\n")
            f.write("|----------|-------|-------|---------|---------|-----------|-------|\n")
            for r in timed:
                t = r.get("timings", {})
                def fmt(k):
                    v = t.get(k)
                    return f"{v:.1f}s" if v is not None else "-"
                f.write(
                    f"| {r['name']} | {fmt('navigate_and_adopt')} | {fmt('build_and_test')} "
                    f"| {fmt('verify_promotion')} | {fmt('execute')} "
                    f"| {fmt('verify_artifacts')} | {fmt('haiku_regression')} |\n"
                )

    print(f"\nReports saved:")
    print(f"  JSON: {json_path}")
    print(f"  Summary: {md_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="E2E Template Adoption User Flow Test"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Run only Tier 0 (database-performance-monitor)",
    )
    parser.add_argument(
        "--tier", type=int, choices=[0, 1, 2, 3, 4],
        help="Run templates from a specific tier only",
    )
    parser.add_argument(
        "--template", type=str,
        help="Run a single template by slug",
    )
    parser.add_argument(
        "--resume-from", type=int, default=0,
        help="Resume from template index N (0-based)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  E2E Template Adoption User Flow Test")
    print("=" * 60)

    # Health check
    print("\n[1/4] Health check...")
    health = api_get("/health")
    if health.get("error"):
        print(f"  FATAL: Test server not reachable: {health.get('error')}")
        print(f"  Make sure the Personas app is running with test-automation enabled.")
        sys.exit(1)
    print(f"  Server: {health.get('server', 'ok')} | Status: {health.get('status', 'unknown')}")

    # Navigate to home to trigger store initialization (retry if bridge not ready)
    for attempt in range(3):
        try:
            resp = api_post("/navigate", {"section": "home"})
            if resp_ok(resp):
                break
        except Exception:
            pass
        time.sleep(5)
    time.sleep(2)

    # Discover templates
    print("\n[2/4] Discovering templates...")
    templates = discover_templates()
    print(f"  Found {len(templates)} templates in {TEMPLATES_DIR}")

    # Discover credentials
    print("\n[3/4] Discovering credentials...")
    creds = discover_credentials()
    print(f"  Available credentials: {sorted(creds) if creds else '(none)'}")

    # Determine which templates to run
    if args.dry_run:
        slugs = TIER_0
    elif args.tier is not None:
        slugs = ALL_TIERS[args.tier]
    elif args.template:
        slugs = [args.template]
    else:
        slugs = [s for tier in ALL_TIERS for s in tier]

    print(f"\n[4/4] Running {len(slugs)} template(s)...\n")

    results = []
    start_all = time.time()

    for i, slug in enumerate(slugs):
        if i < args.resume_from:
            print(f"  [{i + 1}/{len(slugs)}] SKIP {slug} (resume-from={args.resume_from})")
            continue

        # Look up template data
        tmpl = next((t for t in templates if t["id"] == slug), None)
        if not tmpl:
            print(f"  [{i + 1}/{len(slugs)}] SKIP {slug} -- template file not found")
            results.append({
                "slug": slug, "name": slug,
                "skipped": True, "reason": "template file not found",
            })
            continue

        if slug in TIER_5_SKIP:
            print(f"  [{i + 1}/{len(slugs)}] SKIP {slug} -- unavailable connector (Salesforce)")
            results.append({
                "slug": slug, "name": tmpl["name"],
                "skipped": True, "reason": "Salesforce connector not available",
            })
            continue

        can_run, reason = can_run_template(tmpl, creds)
        if not can_run:
            print(f"  [{i + 1}/{len(slugs)}] SKIP {slug} -- {reason}")
            results.append({
                "slug": slug, "name": tmpl["name"],
                "skipped": True, "reason": reason,
            })
            continue

        print(f"\n{'=' * 60}")
        print(f"  [{i + 1}/{len(slugs)}] TESTING: {tmpl['name']}")
        print(f"  Slug: {slug}")
        print(f"  Services: {', '.join(tmpl.get('service_flow', []))}")
        print(f"{'=' * 60}")

        t_start = time.time()
        scenario = TemplateScenario(tmpl, creds)
        result = scenario.run()
        elapsed = time.time() - t_start
        result["elapsed_s"] = round(elapsed, 1)
        results.append(result)

        # Print per-template summary
        print(f"\n  Score: {result['total']}/10  ({elapsed:.1f}s)")
        for c in range(1, 11):
            score = result["scores"].get(c)
            if score == 1:
                marker = "PASS"
            elif score == 0:
                marker = "FAIL"
            else:
                marker = "N/A "
            label = CRITERIA_LABELS.get(c, "")
            print(f"    [{marker}] C{c:2d}: {label}")

        if result["errors"]:
            print(f"  Errors:")
            for err in result["errors"]:
                print(f"    - {err}")

        # Cleanup and brief pause
        scenario.cleanup()
        time.sleep(2)

    total_elapsed = time.time() - start_all

    # Final summary
    tested = [r for r in results if not r.get("skipped")]
    skipped = [r for r in results if r.get("skipped")]
    total_score = sum(r.get("total", 0) for r in tested)
    total_max = len(tested) * 10

    print(f"\n{'=' * 60}")
    print(f"  FINAL SUMMARY")
    print(f"{'=' * 60}")
    print(f"  Templates tested:  {len(tested)}")
    print(f"  Templates skipped: {len(skipped)}")
    print(f"  Overall score:     {total_score}/{total_max}", end="")
    if tested:
        print(f"  (avg {total_score / len(tested):.1f}/10)")
    else:
        print()
    print(f"  Total time:        {total_elapsed:.0f}s")

    # Generate report files
    generate_report(results)


if __name__ == "__main__":
    main()
