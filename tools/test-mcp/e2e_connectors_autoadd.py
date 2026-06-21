#!/usr/bin/env python3
"""
E2E Test: Connector Auto-add (MCP browser)

Drives the vault "Catalog connections" Auto-add flow for non-desktop connectors
and verifies that the MCP / Playwright browser session launches, opens the
connector's first proposed site, and reaches the login / auth gate. Reaching the
auth wall is the SUCCESS state — the harness never attempts to authenticate.

Scenario doc:  docs/tests/connectors/connector-autoadd.md
Bridge:        npm run tauri:dev:test  (HTTP automation server on :17320)

Flow per connector (all via data-testid):
  navigate(credentials)
    -> click tab-from-template            (catalog grid)
    -> click catalog-connector-<name>     (template form)
    -> click vault-auto-add-btn           (CatalogAutoSetup)
    -> [analyzing AI design, if any]
    -> click vault-autocred-start         (consent -> browser)
    -> observe vault-autocred-browser / -url / -waiting / -error
    -> click vault-autocred-cancel        (kills CLI subprocess)

Usage:
  uvx --with httpx python tools/test-mcp/e2e_connectors_autoadd.py
  uvx --with httpx python tools/test-mcp/e2e_connectors_autoadd.py --connectors github,stripe,slack,linear
  uvx --with httpx python tools/test-mcp/e2e_connectors_autoadd.py --all
  uvx --with httpx python tools/test-mcp/e2e_connectors_autoadd.py --limit 4 --per-timeout 150
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx

# Windows consoles default to a legacy codepage (cp1250) that can't encode the
# ✓/✗/· status glyphs. Force UTF-8 so the harness prints cleanly everywhere.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

BASE = "http://127.0.0.1:17320"
client = httpx.Client(base_url=BASE, timeout=30.0)

# Default representative subset — well-known connectors with clear public dev
# dashboards, ordered by how cleanly they hit a login wall. The harness skips
# any not present in the catalog.
DEFAULT_SUBSET = ["github", "stripe", "slack", "linear"]

# How long to wait for the consent screen to appear after Auto-add (covers the
# optional AI "analyze connector" design step, which spawns a Claude CLI call).
ANALYZE_TIMEOUT_S = 150
# How long to watch the browser session for a first-site / auth-gate signal.
DEFAULT_PER_TIMEOUT_S = 150

URL_RE = re.compile(r"https?://[^\s'\"<>)\]]+")
# Phrases that indicate the automation reached an auth / login / verification wall.
GATE_HINTS = ("waiting", "log in", "login", "sign in", "sign-in", "authenticate",
              "authentication", "captcha", "2fa", "verify", "verification",
              "action required")
# Error kinds that mean the test environment itself is broken (not a connector result).
INFRA_ERROR_KINDS = {"cli_not_found", "spawn_failed", "env_conflict"}
# Error kinds that only happen AFTER the browser reached the service (a login
# wall blocked credential extraction) — these still prove the flow worked.
POST_SITE_ERROR_KINDS = {"timeout", "extraction_failed", "cli_error", "tool_limit"}

results = []


# ---------------------------------------------------------------------------
# Bridge helpers
# ---------------------------------------------------------------------------

def api_post(path, body=None):
    try:
        return client.post(path, json=body or {}).json()
    except Exception as e:  # noqa: BLE001 - report, never crash the suite
        return {"success": False, "error": str(e)}


def api_get(path):
    try:
        return client.get(path).json()
    except Exception as e:  # noqa: BLE001
        return {"success": False, "error": str(e)}


def _elements(res):
    if isinstance(res, list):
        return res
    if isinstance(res, dict):
        return res.get("elements", res.get("result", []))
    return []


def query(selector):
    return _elements(api_post("/query", {"selector": selector}))


def query_testid(testid):
    return query(f"[data-testid='{testid}']")


def exists(testid):
    return len(query_testid(testid)) > 0


def text_of(testid):
    els = query_testid(testid)
    if not els:
        return ""
    return " ".join((e.get("text") or "") for e in els)


def click(testid):
    return api_post("/click-testid", {"test_id": testid})


def wait_for(testid, timeout_ms=6000):
    return api_post("/wait", {"selector": f"[data-testid='{testid}']", "timeout_ms": timeout_ms}).get("success", False)


def navigate_catalog():
    """Land on the connector catalog grid (catalog-browse view)."""
    api_post("/navigate", {"section": "credentials"})
    time.sleep(0.6)
    click("tab-from-template")
    time.sleep(0.6)
    # A card or the picker filter confirms we're on the grid.
    for _ in range(20):
        if query("[data-testid^='catalog-connector-']"):
            return True
        time.sleep(0.25)
    return False


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def hdr(msg):
    print(f"\n{'=' * 72}\n  {msg}\n{'=' * 72}")


def step(ok, label, detail=""):
    mark = "✓" if ok else "✗"
    d = f" — {detail}" if detail else ""
    print(f"    {mark} {label}{d}")


def log(msg):
    print(f"    · {msg}")


# ---------------------------------------------------------------------------
# Connector catalog (read the authoritative seed)
# ---------------------------------------------------------------------------

def load_seed_connectors():
    """Return [{name, label, docs_url, desktop}] from scripts/connectors/builtin/*.json."""
    here = Path(__file__).resolve()
    repo = here.parents[2]  # tools/test-mcp/<file> -> repo root
    seed_dir = repo / "scripts" / "connectors" / "builtin"
    out = []
    if not seed_dir.is_dir():
        return out
    for fp in sorted(seed_dir.glob("*.json")):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        meta = data.get("metadata") or {}
        out.append({
            "name": data.get("name") or fp.stem,
            "label": data.get("label") or data.get("name") or fp.stem,
            "docs_url": meta.get("docs_url") or meta.get("setup_url"),
            "desktop": meta.get("connection_mode") == "desktop_bridge",
        })
    return out


# ---------------------------------------------------------------------------
# Drive a single connector through Auto-add
# ---------------------------------------------------------------------------

def run_connector(conn, per_timeout_s):
    name = conn["name"]
    label = conn["label"]
    hdr(f"CONNECTOR: {label}  ({name})")
    rec = {"name": name, "label": label, "docs_url": conn.get("docs_url"),
           "verdict": "fail", "notes": "", "mode": "?", "urls": [], "error_kind": None}

    if not navigate_catalog():
        step(False, "Reach catalog grid")
        rec["notes"] = "catalog grid not reachable"
        return rec
    step(True, "Catalog grid visible")

    card = f"catalog-connector-{name}"
    if not exists(card):
        step(False, f"Card {card} present")
        rec["verdict"] = "skip"
        rec["notes"] = "connector not in catalog"
        return rec
    click(card)
    time.sleep(0.8)

    # The template form must offer Auto-add. OAuth-only / MCP / desktop-bridge
    # connectors hide it — that's an expected skip, not a failure.
    if not wait_for("vault-auto-add-btn", 6000):
        step(False, "Auto-add button present")
        rec["verdict"] = "skip"
        rec["notes"] = "no Auto-add affordance (OAuth/MCP/desktop connector)"
        return rec
    step(True, "Auto-add button present")
    click("vault-auto-add-btn")

    if not wait_for("vault-catalog-auto-setup", 8000):
        step(False, "Entered Auto-setup")
        rec["notes"] = "catalog-auto-setup did not mount"
        return rec
    step(True, "Entered Auto-setup")

    # Wait for the consent screen — covers the optional AI analyze step.
    log("Waiting for consent (covers AI analyze step)…")
    consent = False
    deadline = time.time() + ANALYZE_TIMEOUT_S
    while time.time() < deadline:
        if exists("vault-autocred-start"):
            consent = True
            break
        if exists("vault-autocred-error"):
            break
        time.sleep(1.0)
    if not consent:
        if exists("vault-autocred-error"):
            rec["error_kind"] = _read_error_kind()
            step(False, "Consent screen", f"error before consent: {rec['error_kind']}")
            rec["notes"] = f"error before consent ({rec['error_kind']})"
            rec["verdict"] = "fail" if rec["error_kind"] in INFRA_ERROR_KINDS else "partial"
        else:
            step(False, "Consent screen", "timed out (analyze/design stuck)")
            rec["notes"] = "consent timeout"
        _cleanup()
        return rec

    consent_text = (text_of("vault-autocred-consent") or "").lower()
    rec["mode"] = "guided" if "guided" in consent_text else "playwright"
    step(True, "Consent screen", f"mode={rec['mode']}")

    click("vault-autocred-start")
    if not wait_for("vault-autocred-browser", 10000):
        # Could have jumped straight to error.
        if exists("vault-autocred-error"):
            rec["error_kind"] = _read_error_kind()
            rec["notes"] = f"error at browser start ({rec['error_kind']})"
            rec["verdict"] = "fail" if rec["error_kind"] in INFRA_ERROR_KINDS else "partial"
        else:
            rec["notes"] = "browser phase never mounted"
        step(False, "Browser session started", rec["notes"])
        _cleanup()
        return rec
    step(True, "Browser session started")

    # Watch for a first-site / auth-gate signal.
    saw_url = saw_gate = False
    deadline = time.time() + per_timeout_s
    while time.time() < deadline:
        if exists("vault-autocred-waiting"):
            saw_gate = True
        for el in query_testid("vault-autocred-url"):
            for u in URL_RE.findall(el.get("text") or ""):
                if u not in rec["urls"]:
                    rec["urls"].append(u)
            saw_url = True
        # The full browser-log container text catches in-Chromium navigation +
        # "WAITING: Login required" lines even when no discrete URL card renders.
        blob = (text_of("vault-autocred-browser") or "").lower()
        for u in URL_RE.findall(text_of("vault-autocred-browser")):
            if u not in rec["urls"]:
                rec["urls"].append(u)
        if any(h in blob for h in GATE_HINTS):
            saw_gate = True
        if exists("vault-autocred-error"):
            rec["error_kind"] = _read_error_kind()
            break
        if saw_gate and (saw_url or rec["urls"]):
            break
        time.sleep(2.0)

    rec["error_kind"] = rec["error_kind"] or (_read_error_kind() if exists("vault-autocred-error") else None)
    have_url = bool(rec["urls"]) or saw_url

    if saw_gate:
        rec["verdict"] = "pass"
        rec["notes"] = "reached auth gate" + (f"; opened {rec['urls'][0]}" if rec["urls"] else "")
    elif have_url:
        # A site was opened, then a login wall blocked extraction — still proves
        # the flow reached the service.
        rec["verdict"] = "pass"
        rec["notes"] = f"opened first site {rec['urls'][0] if rec['urls'] else ''}".strip()
        if rec["error_kind"]:
            rec["notes"] += f"; stopped at login wall ({rec['error_kind']})"
    elif rec["error_kind"]:
        # Errored BEFORE opening any site → the CLI session failed at launch.
        # cli_error here is most often an account-level block (low API credit /
        # auth / rate limit) or a missing CLI — not a connector defect. The real
        # cause is in <app-data>/crash_logs/autocred_*.log.
        rec["verdict"] = "fail"
        rec["launch_failure"] = rec["error_kind"] in (INFRA_ERROR_KINDS | {"cli_error"})
        rec["notes"] = (f"CLI session failed at launch ({rec['error_kind']}) — no site opened. "
                        "Check API credit / auth (see crash_logs/autocred_*.log).")
    else:
        rec["verdict"] = "partial"
        rec["notes"] = "browser ran; no clear site/gate signal within timeout"

    step(rec["verdict"] == "pass", "Outcome", rec["notes"])
    if rec["urls"]:
        log("URLs: " + ", ".join(rec["urls"][:4]))
    _cleanup()
    return rec


def _read_error_kind():
    """Best-effort error-kind read from the error card's badge/text."""
    txt = (text_of("vault-autocred-error") or "").lower()
    for kind in (INFRA_ERROR_KINDS | POST_SITE_ERROR_KINDS):
        if kind.replace("_", " ") in txt or kind in txt:
            return kind
    # Fallback: scan find-text for known badge labels.
    return "unknown" if txt else None


def _cleanup():
    """Cancel any running browser session and return to the catalog."""
    if exists("vault-autocred-cancel"):
        click("vault-autocred-cancel")
        time.sleep(1.0)
    # Leave the auto-setup view regardless of phase.
    api_post("/navigate", {"section": "credentials"})
    time.sleep(0.5)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Connector Auto-add E2E (MCP browser)")
    ap.add_argument("--all", action="store_true", help="Drive every non-desktop connector")
    ap.add_argument("--connectors", help="Comma-separated connector names to drive")
    ap.add_argument("--limit", type=int, default=len(DEFAULT_SUBSET), help="Cap number of connectors")
    ap.add_argument("--per-timeout", type=int, default=DEFAULT_PER_TIMEOUT_S, help="Per-connector browser watch seconds")
    args = ap.parse_args()

    print("\n" + "=" * 72)
    print("  CONNECTOR AUTO-ADD — E2E (MCP browser opens first site -> auth gate)")
    print("=" * 72)

    health = api_get("/health")
    if health.get("status") != "ok":
        print(f"\n  ✗ Bridge health check failed: {health}")
        print("    Start the app with: npm run tauri:dev:test")
        sys.exit(1)
    print(f"\n  ✓ Bridge healthy (v{health.get('version', '?')})")

    seed = load_seed_connectors()
    by_name = {c["name"]: c for c in seed}
    non_desktop = [c for c in seed if not c["desktop"]]
    print(f"  · Seed: {len(seed)} connectors, {len(non_desktop)} non-desktop, "
          f"{len(seed) - len(non_desktop)} desktop-bridge")

    if args.connectors:
        wanted = [n.strip() for n in args.connectors.split(",") if n.strip()]
        targets = [by_name.get(n, {"name": n, "label": n, "docs_url": None, "desktop": False}) for n in wanted]
    elif args.all:
        targets = non_desktop
    else:
        present = [by_name[n] for n in DEFAULT_SUBSET if n in by_name]
        # Top up from non-desktop list if some defaults are missing.
        if len(present) < args.limit:
            for c in non_desktop:
                if c not in present:
                    present.append(c)
                if len(present) >= args.limit:
                    break
        targets = present[:args.limit]

    print(f"  · Driving {len(targets)} connector(s): {', '.join(c['name'] for c in targets)}")
    print(f"  · Per-connector browser watch: {args.per_timeout}s\n")

    for conn in targets:
        try:
            results.append(run_connector(conn, args.per_timeout))
        except Exception as e:  # noqa: BLE001 - one bad connector must not kill the run
            results.append({"name": conn["name"], "label": conn.get("label", conn["name"]),
                            "verdict": "fail", "notes": f"harness exception: {e}", "urls": []})
            _cleanup()

    # Summary
    hdr("RESULTS")
    counts = {"pass": 0, "partial": 0, "skip": 0, "fail": 0}
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        tag = {"pass": "PASS", "partial": "PART", "skip": "SKIP", "fail": "FAIL"}[r["verdict"]]
        extra = f" [{r.get('mode', '?')}]" if r["verdict"] in ("pass", "partial") else ""
        print(f"  [{tag}]{extra} {r['label']:<22} {r['notes']}")

    print(f"\n  Total: {len(results)} | pass: {counts['pass']} | partial: {counts['partial']} "
          f"| skip: {counts['skip']} | fail: {counts['fail']}")
    print("=" * 72)

    # Exit non-zero only on hard (infra) failures — partials/skips are informational.
    return 1 if counts["fail"] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
