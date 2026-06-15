"""guidekit — a small, reusable harness for testing GUIDED FLOWS (tours, how-to
guides) against the live desktop app from the UI.

A *guide* is a list of *stages*; each stage declares (a) how to REACH its
surface (navigate the sidebar / select a plugin tab / click a nav item) and
(b) which `data-testid`s must be PRESENT + visible there — the action points a
guided tour rings and a real user clicks. Running a guide proves the whole flow
is achievable from the UI and flags any missing/broken surface. The same testids
the Teams & Orchestration tour targets are what this asserts, so the tour and
the test validate each other.

Reuses the existing test-automation client in `tools/test-mcp/lib` (the
port-17320 server exposed by `npm run tauri:dev:test`). No new server code.

Write a guide as data (see `teams_orchestration_pipeline.py`); run it with
`run_guide(client, guide)`. Reuse the same `Stage`/`Reach` vocabulary for any
future guide.
"""
from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# The guide reports use Unicode (→ · ✓) — force UTF-8 stdout/stderr so they
# don't crash on a Windows console defaulting to a legacy code page (cp1250).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # py3.7+
    except (AttributeError, ValueError):
        pass

# Make the existing harness client importable (tools/test-mcp/lib).
#   runner.py -> guidekit -> guides -> tests -> docs -> <repo root>
_REPO_ROOT = Path(__file__).resolve().parents[4]
_HARNESS = _REPO_ROOT / "tools" / "test-mcp"
if str(_HARNESS) not in sys.path:
    sys.path.insert(0, str(_HARNESS))
from lib import Client  # noqa: E402  (path set above)

RESULTS_DIR = _REPO_ROOT / "docs" / "tests" / "results"


# -- reach actions ------------------------------------------------------------

@dataclass
class Reach:
    """One navigation action on the way to a stage's surface."""
    kind: str  # 'navigate' | 'click' | 'plugin_tab' | 'settle'
    arg: str = ""


def navigate(section: str) -> Reach:
    """Set the L1 sidebar section (home/overview/personas/teams/plugins/…)."""
    return Reach("navigate", section)


def click(testid: str) -> Reach:
    """Click an element by data-testid (e.g. an L2/L3 sidebar nav item)."""
    return Reach("click", testid)


def plugin_tab(tab: str) -> Reach:
    """Select a plugin surface under the Plugins section (e.g. 'dev-tools')."""
    return Reach("plugin_tab", tab)


def settle(ms: int = 400) -> Reach:
    """Pause for the UI to mount after a navigation."""
    return Reach("settle", str(ms))


# -- guide model --------------------------------------------------------------

@dataclass
class Stage:
    name: str
    reach: list[Reach]
    # testids that MUST be present + visible once the stage surface is open.
    assert_present: list[str] = field(default_factory=list)
    notes: str = ""


@dataclass
class Guide:
    name: str
    description: str
    stages: list[Stage]


# -- runner -------------------------------------------------------------------

def _present(client: Client, testid: str) -> tuple[bool, str]:
    """Is `[data-testid=testid]` present + visible? (the gap check)."""
    try:
        rows = client.post("/query", {"selector": f'[data-testid="{testid}"]'})
    except Exception as e:  # transport error
        return False, f"query error: {e}"
    if not isinstance(rows, list):
        return False, f"unexpected /query response: {rows!r}"
    visible = [r for r in rows if r.get("visible")]
    if visible:
        return True, f"present + visible ({len(visible)})"
    if rows:
        return False, f"present but NOT visible ({len(rows)})"
    return False, "not found"


def _do_reach(client: Client, r: Reach) -> None:
    if r.kind == "navigate":
        client.post("/navigate", {"section": r.arg})
    elif r.kind == "click":
        client.post("/click-testid", {"test_id": r.arg})
    elif r.kind == "plugin_tab":
        client.post("/bridge-exec", {"method": "setPluginTab", "params": {"tab": r.arg}})
    elif r.kind == "settle":
        time.sleep(int(r.arg) / 1000.0)


def run_guide(client: Client, guide: Guide, settle_ms: int = 500) -> dict[str, Any]:
    """Walk every stage; reach its surface, assert its action points exist.
    Returns a structured summary (also printed) — never raises on a failed
    assertion (a missing surface is a *finding*, not a crash)."""
    print(f"\n=== guide: {guide.name} ===")
    print(guide.description + "\n")
    stages: list[dict[str, Any]] = []
    for stage in guide.stages:
        for r in stage.reach:
            try:
                _do_reach(client, r)
            except Exception as e:
                print(f"  (reach {r.kind} {r.arg!r} errored: {e})")
        time.sleep(settle_ms / 1000.0)
        checks = [dict(testid=t, **dict(zip(("ok", "detail"), _present(client, t))))
                  for t in stage.assert_present]
        ok = bool(checks) and all(c["ok"] for c in checks)
        stages.append({"stage": stage.name, "ok": ok, "checks": checks, "notes": stage.notes})
        print(f"[{'PASS' if ok else 'FAIL'}] {stage.name}")
        for c in checks:
            print(f"   {'ok' if c['ok'] else 'XX'}  {c['testid']}: {c['detail']}")
        if stage.notes:
            print(f"      note: {stage.notes}")
    passed = sum(1 for s in stages if s["ok"])
    summary = {"guide": guide.name, "passed": passed, "total": len(stages), "stages": stages}
    print(f"\n→ {passed}/{len(stages)} stages reachable\n")
    return summary


def save_result(summary: dict[str, Any], tag: str, results_dir: Path = RESULTS_DIR) -> Path:
    results_dir.mkdir(parents=True, exist_ok=True)
    out = results_dir / f"guide-{tag}.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return out


def run_and_save(guide: Guide, tag: str) -> dict[str, Any]:
    """Convenience entry point: preflight, run, save, report. Used by each
    guide module's `if __name__ == '__main__'` block."""
    client = Client()
    client.health()  # raises SystemExit with an actionable hint if the app is down
    try:
        summary = run_guide(client, guide)
    finally:
        client.close()
    out = save_result(summary, tag)
    print(f"saved → {out}")
    return summary
