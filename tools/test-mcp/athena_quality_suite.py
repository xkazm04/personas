r"""Athena Quality Suite — two-pass runner.

Pass 1 (--run, default): drive every fixture in
`docs/tests/athena/fixtures/*.json` through a real Athena chat session,
capture per-turn state via the test-automation bridge, run the hard
assertions, and write a bundle directory the Claude Code CLI then reads
to judge each turn.

Pass 2 (--aggregate): merge the verdict JSONs Claude wrote alongside the
bundles into a single report (JSON + optional markdown).

Why two passes
--------------
The Anthropic SDK is deliberately NOT a runtime dependency of this
suite. The mechanical drive-and-capture loop is reproducible and cheap;
the judgement step is where we want Claude's actual evaluation — with
full access to the recall preview, the doctrine corpus, the codebase,
and any prior session memory — rather than a black-box API call that's
much weaker on context. Splitting these passes also means the
deterministic part runs unattended and the judgement part is auditable
file-by-file.

Output layout (per run)
-----------------------
    docs/tests/athena/results/<stamp>/
      report.json              ← aggregated report (final form after pass 2)
      report.md                ← optional markdown summary (after pass 2)
      bundles/
        <scenario_id>/
          scenario.json        ← fixture snapshot + hard-assertion roll-up
          t<n>-<turn_id>.md    ← one bundle per turn — feed each to Claude
      verdicts/
        <scenario_id>/
          t<n>-<turn_id>.json  ← written by Claude in pass 2

Prerequisites
-------------
- Dev app running with test-automation:
    npm run tauri:dev:test
- Companion plugin enabled in Settings -> Plugins.

Usage
-----
    # Pass 1 — drive turns, capture, write bundles
    uvx --with httpx python tools/test-mcp/athena_quality_suite.py
    uvx --with httpx python tools/test-mcp/athena_quality_suite.py --filter scan-vs-build

    # ← between passes: Claude reads each bundles/<id>/t<n>-*.md
    #   and writes a verdict JSON to verdicts/<id>/t<n>-*.json. The
    #   playbook is at docs/tests/athena/judge-playbook.md.

    # Pass 2 — aggregate Claude's verdicts into the final report
    python tools/test-mcp/athena_quality_suite.py --aggregate docs/tests/athena/results/<stamp> --markdown

Exit codes
----------
    Pass 1:
        0  bundles written, all hard assertions passed
        1  bundles written, at least one hard assertion failed
        3  preflight / setup error

    Pass 2:
        0  PASS — all assertions + judge verdicts ok
        1  WARN — no hard fails, ≥1 judge weak
        2  FAIL — ≥1 hard fail or ≥1 judge fail
        3  aggregation error (missing verdicts, malformed JSON, etc.)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from lib.client import Client  # noqa: E402
from lib.bridge import Bridge  # noqa: E402


REPO_ROOT = SCRIPT_DIR.parent.parent
FIXTURES_DIR = REPO_ROOT / "docs" / "tests" / "athena" / "fixtures"
RESULTS_DIR = REPO_ROOT / "docs" / "tests" / "athena" / "results"
JUDGE_PLAYBOOK = REPO_ROOT / "docs" / "tests" / "athena" / "judge-playbook.md"


# ─── Data classes ───────────────────────────────────────────────────────


@dataclass
class AssertionResult:
    name: str
    passed: bool
    detail: str = ""


@dataclass
class TurnCapture:
    turn_id: str
    user_message: str
    captured: dict[str, Any] = field(default_factory=dict)
    assertions: list[AssertionResult] = field(default_factory=list)
    judge_axes: list[str] = field(default_factory=list)
    judge_surface_map: dict[str, str] = field(default_factory=dict)
    judge_anti_patterns: list[str] = field(default_factory=list)
    duration_ms: int = 0
    drive_error: str | None = None
    approval_outcomes: list[dict[str, Any]] = field(default_factory=list)

    def hard_passed(self) -> bool:
        return self.drive_error is None and all(a.passed for a in self.assertions)


@dataclass
class ScenarioRun:
    id: str
    purpose: str
    tags: list[str] = field(default_factory=list)
    turns: list[TurnCapture] = field(default_factory=list)
    setup_error: str | None = None

    def hard_status(self) -> str:
        if self.setup_error:
            return "fail"
        if any(not t.hard_passed() for t in self.turns):
            return "fail"
        return "pass"


# ─── Fixture loading ────────────────────────────────────────────────────


def discover_fixtures(filter_id: str | None) -> list[Path]:
    if not FIXTURES_DIR.exists():
        return []
    paths = sorted(FIXTURES_DIR.glob("*.json"))
    if filter_id:
        paths = [p for p in paths if filter_id in p.stem]
    return paths


def load_fixture(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


# ─── Bridge helpers ─────────────────────────────────────────────────────


def _invoke(bridge: Bridge, command: str, params: dict[str, Any] | None = None, timeout_secs: int = 30) -> dict[str, Any]:
    return bridge.exec(
        "invokeCommand",
        {"command": command, "params": params or {}},
        timeout_secs=timeout_secs,
    )


def reset_conversation(bridge: Bridge) -> None:
    _invoke(bridge, "companion_reset_conversation", {"wipeTranscript": True})


def open_panel(bridge: Bridge) -> None:
    bridge.exec("openCompanion", {}, timeout_secs=10)


def apply_setup(bridge: Bridge, setup: dict[str, Any]) -> None:
    if setup.get("reset_conversation"):
        reset_conversation(bridge)
    if setup.get("open_companion_panel"):
        open_panel(bridge)

    # NON-DESTRUCTIVE pin handling: only call set_active_connectors when
    # the fixture declares a NON-EMPTY list. The Tauri command is a full
    # replace_all — passing [] wipes the user's pinned set persistently
    # across sessions, which silently broke the 2026-05-27 stress runs
    # and required the user to re-pin connectors. Fixtures that need a
    # specific connector subset should declare it explicitly; fixtures
    # that don't care (`pinned_connectors: []` or absent) leave the
    # user's actual pin state untouched.
    pinned = setup.get("pinned_connectors")
    if pinned:
        _invoke(
            bridge,
            "companion_set_active_connectors",
            {"connectorNames": pinned},
            timeout_secs=15,
        )

    for proj in setup.get("seed_dev_projects") or []:
        _invoke(
            bridge,
            "companion_register_project",
            {
                "name": proj["name"],
                "path": proj["path"],
                "description": proj.get("description"),
            },
            timeout_secs=15,
        )

    # wipe_semantic_facts_scope_user is best-effort and not currently wired
    # in the backend — we judge memory-doctrine grounding against whatever
    # recall preview reports was actually consulted this turn, not a
    # synthetic empty state. If the backend grows a wipe-by-scope command,
    # call it here.


def send_message(bridge: Bridge, text: str) -> dict[str, Any]:
    fill = bridge.exec(
        "fillField",
        {"testId": "companion-composer", "value": text},
        timeout_secs=15,
    )
    if not fill.get("success"):
        return {"success": False, "error": fill.get("error") or "fillField failed"}
    submit = bridge.exec("clickTestId", {"testId": "companion-send"}, timeout_secs=15)
    return submit if submit.get("success") else {"success": False, "error": submit.get("error")}


def wait_for_turn(
    bridge: Bridge, timeout_ms: int, since_episode_id: str | None = None
) -> dict[str, Any]:
    """Wait for the CURRENT turn to settle. Tolerant of httpx-side
    ReadTimeout — on a 90-180s Athena turn the connection occasionally
    hiccups; we surface a structured timeout instead of a Python exception
    so the runner keeps moving and the partial state still gets captured.

    `since_episode_id` is the last assistant episode id we saw BEFORE
    sending this turn's message. The bridge uses it to reject a premature
    settle on the prior turn's state (the H2 stale-capture bug): without
    it, the wait can return in a few hundred ms because `streaming` hasn't
    flipped true yet, handing back the previous turn's episode."""
    try:
        return bridge.exec(
            "companionWaitForTurnFinish",
            {"timeoutMs": timeout_ms, "sinceEpisodeId": since_episode_id},
            timeout_secs=int(timeout_ms / 1000) + 60,
        )
    except Exception as e:  # httpx.ReadTimeout, ConnectError, etc.
        return {"success": False, "error": f"wait_for_turn raised: {e!r}"}


def capture_turn(bridge: Bridge) -> dict[str, Any]:
    try:
        return bridge.exec("companionCaptureLastTurn", {}, timeout_secs=30)
    except Exception as e:
        return {"success": False, "error": f"capture_turn raised: {e!r}"}


def last_assistant_episode_id(bridge: Bridge) -> str | None:
    """Cheap probe of the current last-assistant episode id, used to fence
    a fresh turn against the prior one. Returns None when no assistant
    message exists yet (first turn of a session)."""
    try:
        snap = bridge.exec("companionCaptureLastTurn", {}, timeout_secs=15)
        if snap.get("success"):
            return snap.get("episodeId")
    except Exception:
        pass
    return None


# Settle budget for async connector-job attachment (H1). Connector jobs
# are enqueued during the turn but their rows attach to the episode via
# `companion://job` events that land ~100ms-2s AFTER the turn text
# finishes. A capture taken the instant the turn settles therefore often
# shows `backgroundJobs: []` even though the OP fired and the job ran
# (confirmed by cross-referencing the DB job table in the 2026-05-27
# sweep). We re-capture across this window and keep the richest snapshot.
_JOB_SETTLE_ATTEMPTS = 5
_JOB_SETTLE_GAP_S = 0.5


def capture_turn_settled(bridge: Bridge) -> dict[str, Any]:
    """Capture the turn, then re-poll briefly so async-attached connector
    jobs show up in `backgroundJobs`. Returns the snapshot with the most
    background jobs seen across the settle window (or the last successful
    capture if none ever queue a job — refusals legitimately queue none)."""
    best = capture_turn(bridge)
    best_jobs = len((best.get("backgroundJobs") or [])) if best.get("success") else -1
    # If the first capture already saw jobs, or the turn failed to capture,
    # there's nothing to wait for.
    if best_jobs >= 1 or not best.get("success"):
        return best
    for _ in range(_JOB_SETTLE_ATTEMPTS):
        time.sleep(_JOB_SETTLE_GAP_S)
        snap = capture_turn(bridge)
        if not snap.get("success"):
            continue
        n = len(snap.get("backgroundJobs") or [])
        if n > best_jobs:
            best, best_jobs = snap, n
        if best_jobs >= 1:
            break
    return best


def auto_approve_new_approvals(
    bridge: Bridge, new_approvals: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """For each NEW approval Athena emitted this turn, call
    `companion_approve_action` and record the outcome. This pushes the
    test one level deeper than "did Athena emit the right card?" — it
    drives the actual side-effect (build session start, scan job enqueue,
    semantic-fact write, navigation, ...) and lets us watch what
    downstream state Athena reads next turn.

    Best-effort: a failed approve doesn't abort the turn — we record the
    error and move on. The approval-result row gets attached to the
    bundle so the judge can verify Athena's next-turn reaction.
    """
    outcomes: list[dict[str, Any]] = []
    for a in new_approvals:
        approval_id = a.get("id")
        if not approval_id:
            continue
        try:
            res = bridge.exec(
                "invokeCommand",
                {
                    "command": "companion_approve_action",
                    "params": {"approvalId": approval_id},
                },
                timeout_secs=45,
            )
        except Exception as e:
            outcomes.append({
                "approval_id": approval_id,
                "action": a.get("action"),
                "success": False,
                "error": f"approve raised: {e!r}",
            })
            continue
        if res.get("success"):
            outcomes.append({
                "approval_id": approval_id,
                "action": a.get("action"),
                "success": True,
                "result": res.get("result"),
            })
        else:
            outcomes.append({
                "approval_id": approval_id,
                "action": a.get("action"),
                "success": False,
                "error": res.get("error") or "approve returned success=false",
            })
    return outcomes


def snapshot_pending_approval_ids(bridge: Bridge) -> set[str]:
    """Return IDs of every approval already pending BEFORE we send a turn.

    The companion store's `approvals` field is the live pending-approval
    list — not a per-turn ledger — so a build_oneshot approval from turn N
    is still in there on turn N+1 unless the user explicitly approves /
    rejects it. The harness diffs against this pre-turn snapshot to count
    only what the current turn actually emitted.
    """
    try:
        snap = bridge.exec("companionCaptureLastTurn", {}, timeout_secs=15)
    except Exception:
        return set()
    if not snap or not snap.get("success"):
        return set()
    return {a.get("id") for a in (snap.get("approvals") or []) if a.get("id")}


def filter_new_approvals(captured: dict[str, Any], pre_ids: set[str]) -> list[dict[str, Any]]:
    """Return only approvals filed during this turn (not in the pre-turn set)."""
    return [a for a in (captured.get("approvals") or []) if a.get("id") not in pre_ids]


# ─── Hard-assertion helpers ─────────────────────────────────────────────


def _approvals_actions(captured: dict[str, Any]) -> list[str]:
    return [a.get("action", "") for a in (captured.get("approvals") or [])]


def _approvals_matching(captured: dict[str, Any], action_kind: str, params_match: dict[str, Any] | None) -> list[dict[str, Any]]:
    out = []
    for a in captured.get("approvals") or []:
        if a.get("action") != action_kind:
            continue
        if params_match:
            try:
                params = json.loads(a.get("paramsJson") or "{}")
            except json.JSONDecodeError:
                params = {}
            if not _dict_subset(params_match, params):
                continue
        out.append(a)
    return out


def _dict_subset(expected: dict[str, Any], actual: dict[str, Any]) -> bool:
    for k, v in expected.items():
        if k not in actual:
            return False
        if isinstance(v, dict) and isinstance(actual[k], dict):
            if not _dict_subset(v, actual[k]):
                return False
        elif v != actual[k]:
            return False
    return True


def _card_kinds(captured: dict[str, Any]) -> list[str]:
    return [c.get("kind", "") for c in (captured.get("chatCards") or [])]


def _resolve_path(cfg: dict[str, Any], dotted: str) -> Any:
    """Navigate a dotted path through nested dicts. Returns None if any
    segment is missing. Used so a fixture can write
    `success_metric.kind` and it resolves to cfg["success_metric"]["kind"]
    instead of requiring everything to be top-level.
    """
    cur: Any = cfg
    for seg in dotted.split("."):
        if not isinstance(cur, dict) or seg not in cur:
            return None
        cur = cur[seg]
    return cur


def _matches_config(card: dict[str, Any], match: dict[str, Any]) -> bool:
    cfg = card.get("config") or {}
    for key, expected in match.items():
        if key.endswith("_min"):
            base = key[:-4]
            arr = _resolve_path(cfg, base) if "." in base else cfg.get(base)
            if not isinstance(arr, list) or len(arr) < int(expected):
                return False
        elif key.endswith("_max"):
            base = key[:-4]
            arr = _resolve_path(cfg, base) if "." in base else cfg.get(base)
            if not isinstance(arr, list) or len(arr) > int(expected):
                return False
        elif key.endswith("_in"):
            base = key[:-3]
            val = _resolve_path(cfg, base) if "." in base else cfg.get(base)
            if val not in expected:
                return False
        elif key.endswith("_must_be_exactly"):
            base = key[:-len("_must_be_exactly")]
            actual = cfg.get(base) or []
            if isinstance(actual, list) and isinstance(expected, list):
                # The list might be primitives (["haiku","sonnet"]) OR
                # objects with a known projection field
                # ([{tier:"haiku",...}, ...]). For the dict case, pull the
                # field whose name matches the singular form of `base`
                # (`tiers` → look for key `tier`); fall back to `name` /
                # `kind` if that doesn't exist.
                if actual and isinstance(actual[0], dict):
                    singular = base[:-1] if base.endswith("s") else base
                    candidates = [singular, "name", "kind", "id", "label"]
                    proj_key = next((k for k in candidates if k in actual[0]), None)
                    if proj_key is None:
                        return False
                    actual_proj = [a.get(proj_key) for a in actual]
                else:
                    actual_proj = actual
                if sorted(actual_proj) != sorted(expected):
                    return False
            else:
                return False
        elif key == "roles_must_include_any_of":
            roles = []
            for uc in (cfg.get("use_cases") or []):
                role = uc.get("role")
                if isinstance(role, str):
                    roles.append(role)
            if not any(set(group).issubset(roles) for group in expected):
                return False
        else:
            if cfg.get(key) != expected:
                return False
    return True


def evaluate_assertions(turn_spec: dict[str, Any], captured: dict[str, Any]) -> list[AssertionResult]:
    results: list[AssertionResult] = []

    for spec in turn_spec.get("expect_approvals") or []:
        matches = _approvals_matching(captured, spec["action_kind"], spec.get("params_match"))
        results.append(AssertionResult(
            name=f"expect_approval[{spec['action_kind']}]",
            passed=len(matches) >= 1,
            detail=f"actions seen: {_approvals_actions(captured)}",
        ))

    any_specs = turn_spec.get("expect_approvals_any") or []
    if any_specs:
        passed = any(
            _approvals_matching(captured, s["action_kind"], s.get("params_match"))
            for s in any_specs
        )
        results.append(AssertionResult(
            name="expect_approvals_any",
            passed=passed,
            detail=f"wanted any of: {[s['action_kind'] for s in any_specs]}; got: {_approvals_actions(captured)}",
        ))

    for spec in turn_spec.get("forbid_approvals") or []:
        matches = _approvals_matching(captured, spec["action_kind"], spec.get("params_match"))
        results.append(AssertionResult(
            name=f"forbid_approval[{spec['action_kind']}]",
            passed=len(matches) == 0,
            detail=f"unexpected: {matches}" if matches else "",
        ))

    for spec in turn_spec.get("expect_chat_cards") or []:
        kinds = _card_kinds(captured)
        match = spec.get("config_match")
        found = False
        for c in captured.get("chatCards") or []:
            if c.get("kind") != spec["kind"]:
                continue
            if match and not _matches_config(c, match):
                continue
            found = True
            break
        results.append(AssertionResult(
            name=f"expect_card[{spec['kind']}]",
            passed=found,
            detail=f"card kinds seen: {kinds}",
        ))

    any_card_specs = turn_spec.get("expect_chat_cards_any") or []
    if any_card_specs:
        kinds = _card_kinds(captured)
        passed = False
        for s in any_card_specs:
            for c in captured.get("chatCards") or []:
                if c.get("kind") != s["kind"]:
                    continue
                if s.get("config_match") and not _matches_config(c, s["config_match"]):
                    continue
                passed = True
                break
            if passed:
                break
        results.append(AssertionResult(
            name="expect_card_any",
            passed=passed,
            detail=f"wanted any of: {[s['kind'] for s in any_card_specs]}; got: {kinds}",
        ))

    for spec in turn_spec.get("expect_chat_cards_also") or []:
        match = spec.get("config_match")
        found = any(
            c.get("kind") == spec["kind"] and (not match or _matches_config(c, match))
            for c in (captured.get("chatCards") or [])
        )
        results.append(AssertionResult(
            name=f"expect_card_also[{spec['kind']}]",
            passed=found,
            detail=f"kinds seen: {_card_kinds(captured)}",
        ))

    for spec in turn_spec.get("forbid_navigations") or []:
        navs = ((captured.get("turnSummary") or {}).get("navigations") or 0)
        if spec.get("route"):
            results.append(AssertionResult(
                name=f"forbid_navigation[{spec['route']}]",
                passed=navs == 0,
                detail=f"turn_summary.navigations={navs} (route-level forbid is soft — we can only count total navigations)",
            ))

    # Recall preview includes any of N doctrine titles.
    # NOTE: doctrine retrieval is gated behind the `ml` Cargo feature
    # (prompt.rs uses `#[cfg(feature = "ml")]`). `tauri:dev:test` (lite)
    # hardcodes `doctrine: Vec::new()` so this assertion is structurally
    # impossible to satisfy. Detect via ATHENA_SUITE_HAS_ML and skip on
    # lite builds (passed=True, detail records the skip reason).
    expected_any = turn_spec.get("expect_recall_includes_doctrine_any") or []
    if expected_any:
        titles = (captured.get("recall") or {}).get("doctrineTitles") or []
        if os.environ.get("ATHENA_SUITE_HAS_ML", "").lower() not in ("1", "true", "yes"):
            results.append(AssertionResult(
                name="recall_includes_doctrine_any",
                passed=True,
                detail=(
                    "SKIPPED — lite build, doctrine retrieval gated behind `ml` "
                    "feature. Set ATHENA_SUITE_HAS_ML=1 + run against `tauri:dev:test:full`."
                ),
            ))
        else:
            flat_titles = " | ".join(titles).lower()
            passed = any(needle.lower() in flat_titles for needle in expected_any)
            results.append(AssertionResult(
                name="recall_includes_doctrine_any",
                passed=passed,
                detail=f"wanted any of: {expected_any}; got titles: {titles}",
            ))

    qr_min = turn_spec.get("expect_reply_has_quick_replies_min")
    if qr_min is not None:
        qrs = captured.get("quickReplies") or []
        results.append(AssertionResult(
            name=f"quick_replies_min[{qr_min}]",
            passed=len(qrs) >= int(qr_min),
            detail=f"got {len(qrs)} chips: {qrs}",
        ))

    return results


def evaluate_approval_assertions(turn_spec: dict[str, Any], outcomes: list[dict[str, Any]]) -> list[AssertionResult]:
    """Approval-outcome assertions (run AFTER auto-approve has executed).

    The hard-assertion layer above only checks "did Athena EMIT the right
    op?". This second layer checks "did the approval EXECUTE successfully?"
    — catching silent prod failures like a stale project_id, a wrong UUID,
    or a connector that returned 401.

    Fixture knobs:
      forbid_approval_failures: bool — when true (default for turns with
        approvals), any approved_failed in outcomes is a failure.
      expect_approval_status: list[{action_kind, status}] — pin specific
        approve outcomes (e.g. "we EXPECT this one to fail because it's
        the stale-id case we're testing").
    """
    results: list[AssertionResult] = []
    if not outcomes:
        return results

    # Default: any approved_failed is a hard fail unless the fixture
    # explicitly opts out.
    if turn_spec.get("forbid_approval_failures", True):
        failed = [
            o for o in outcomes
            if o.get("success") and isinstance(o.get("result"), dict)
            and o["result"].get("status") == "approved_failed"
        ]
        # Also count outright IPC failures
        ipc_failed = [o for o in outcomes if not o.get("success")]
        all_bad = failed + ipc_failed
        passed = len(all_bad) == 0
        detail = ""
        if all_bad:
            summary = "; ".join(
                f"{o.get('action')}: "
                + (
                    (o.get('result') or {}).get('message', '')[:120]
                    if o.get('success')
                    else (o.get('error') or '')[:120]
                )
                for o in all_bad
            )
            detail = f"failures: {summary}"
        results.append(AssertionResult(
            name="approvals_executed_clean",
            passed=passed,
            detail=detail,
        ))

    # Specific status pins
    for spec in turn_spec.get("expect_approval_status") or []:
        action_kind = spec.get("action_kind")
        want_status = spec.get("status", "approved")
        match = next(
            (o for o in outcomes if o.get("action") == action_kind),
            None,
        )
        if match is None:
            results.append(AssertionResult(
                name=f"approval_status[{action_kind}={want_status}]",
                passed=False,
                detail=f"no auto-approve outcome for action `{action_kind}`",
            ))
            continue
        actual_status = "ipc_failed" if not match.get("success") else (
            (match.get("result") or {}).get("status", "?")
        )
        results.append(AssertionResult(
            name=f"approval_status[{action_kind}={want_status}]",
            passed=actual_status == want_status,
            detail=f"actual: {actual_status}",
        ))
    return results


# ─── Pass 1 — drive + capture + write bundles ───────────────────────────


def run_scenario(bridge: Bridge, fixture: dict[str, Any]) -> ScenarioRun:
    run = ScenarioRun(
        id=fixture["id"],
        purpose=fixture.get("purpose", ""),
        tags=list(fixture.get("tags") or []),
    )
    try:
        print(f"  [setup] {fixture['id']}", flush=True)
        apply_setup(bridge, fixture.get("setup") or {})
    except Exception as e:
        run.setup_error = f"setup failed: {e!r}"
        print(f"  [setup-ERR] {fixture['id']}: {e!r}", flush=True)
        return run

    turns = fixture.get("turns") or []
    for idx, turn_spec in enumerate(turns):
        print(f"  [turn {idx + 1}/{len(turns)}] {turn_spec.get('id')}: {turn_spec['user_message'][:80]!r}", flush=True)
        tc = TurnCapture(
            turn_id=turn_spec.get("id", f"t{idx}"),
            user_message=turn_spec["user_message"],
        )
        j_spec = turn_spec.get("judge") or {}
        tc.judge_axes = j_spec.get("axes") or [
            "useful", "grounded", "right_data_source", "no_hallucinated_capabilities",
        ]
        tc.judge_surface_map = j_spec.get("surface_map") or {}
        tc.judge_anti_patterns = j_spec.get("anti_patterns") or []

        t0 = time.time()
        # Snapshot pending approvals BEFORE we send. The companion store's
        # `approvals` list is a live pending queue, not a per-turn record —
        # a build_oneshot approval from turn N stays in the list on turn N+1
        # unless the user resolves it. Without this diff, every forbid_approval
        # assertion downstream of any approval-emitting turn false-fails.
        pre_approval_ids = snapshot_pending_approval_ids(bridge)
        # Fence this turn against the prior one (H2). The episode id we see
        # now is the PREVIOUS assistant turn (or None on the first turn);
        # wait_for_turn must not return until the last-assistant id moves
        # past it (or it has observed streaming), so we never capture the
        # prior turn's stale content.
        prior_episode_id = last_assistant_episode_id(bridge)

        send = send_message(bridge, turn_spec["user_message"])
        if not send.get("success"):
            tc.drive_error = send.get("error") or "send failed"
            run.turns.append(tc)
            continue

        wait_ms = int(turn_spec.get("wait_for_finish_timeout_ms") or 60000)
        finish = wait_for_turn(bridge, wait_ms, since_episode_id=prior_episode_id)
        if not finish.get("success"):
            tc.assertions.append(AssertionResult(
                "wait_for_finish", False,
                f"timeout after {wait_ms}ms (panel may still be streaming)",
            ))

        # H1: re-poll the capture so async-attached connector jobs land in
        # backgroundJobs instead of showing an empty list the instant the
        # turn settles.
        captured = capture_turn_settled(bridge)
        if not captured.get("success"):
            tc.drive_error = captured.get("error") or "no captured turn"
            run.turns.append(tc)
            continue

        # H2 stale-capture guard: if the captured episode id didn't advance
        # past the prior turn's, we grabbed stale content (the send didn't
        # register, or the wait returned early). Mark it so the bundle and
        # roll-up flag it instead of silently judging the previous reply.
        cap_episode_id = captured.get("episodeId")
        if prior_episode_id is not None and cap_episode_id == prior_episode_id:
            tc.drive_error = (
                f"stale capture: episode id did not advance past prior turn "
                f"({cap_episode_id}); send may not have registered "
                f"(elapsed={finish.get('elapsedMs')}ms, sawStreaming={finish.get('sawStreaming')})"
            )
            run.turns.append(tc)
            continue

        # Replace approvals list with just THIS turn's deltas before
        # evaluating assertions. Keep the pre-turn IDs in a separate field
        # so the bundle reader can reconstruct the full state if needed.
        new_approvals = filter_new_approvals(captured, pre_approval_ids)
        captured["approvals_all_pending"] = captured.get("approvals") or []
        captured["approvals"] = new_approvals
        captured["pre_approval_ids"] = sorted(pre_approval_ids)

        tc.captured = captured
        try:
            tc.assertions.extend(evaluate_assertions(turn_spec, captured))
        except Exception as e:
            tc.assertions.append(AssertionResult(
                name="evaluate_assertions_crash",
                passed=False,
                detail=f"matcher raised: {e!r}",
            ))

        # Auto-approve every approval Athena fired this turn. We use the
        # diff-filtered `approvals` (only the NEW ones, not stale pending
        # from prior scenarios). The approval-result `clientAction` (e.g.
        # `navigate`, `prefill_persona_create`) is captured for the
        # bundle; downstream side-effects (build session start, scan job
        # enqueue) fire asynchronously and surface in subsequent turns.
        if new_approvals:
            tc.approval_outcomes = auto_approve_new_approvals(bridge, new_approvals)
            approved = sum(
                1 for o in tc.approval_outcomes
                if o.get("success")
                and (o.get("result") or {}).get("status") not in ("approved_failed", "rejected")
            )
            exec_failed = sum(
                1 for o in tc.approval_outcomes
                if o.get("success")
                and (o.get("result") or {}).get("status") == "approved_failed"
            )
            ipc_failed = sum(1 for o in tc.approval_outcomes if not o.get("success"))
            print(
                f"  [turn {idx + 1}/{len(turns)}] approved={approved} exec_failed={exec_failed} ipc_failed={ipc_failed}",
                flush=True,
            )
            # Apply approval-outcome assertions AFTER the auto-approve has
            # resolved. This is the "did the action actually work?" layer
            # that catches silent prod failures the op-emission layer
            # can't see (stale project_id, wrong UUID, 401 from a
            # connector). Append, don't replace.
            try:
                tc.assertions.extend(
                    evaluate_approval_assertions(turn_spec, tc.approval_outcomes)
                )
            except Exception as e:
                tc.assertions.append(AssertionResult(
                    name="approval_assertions_crash",
                    passed=False,
                    detail=f"matcher raised: {e!r}",
                ))

        tc.duration_ms = int((time.time() - t0) * 1000)
        run.turns.append(tc)
        # Pass / fail roll-up + a tight assertion summary, so a stalled
        # suite is diagnosable from the log alone.
        fails = [a for a in tc.assertions if not a.passed]
        if fails:
            print(f"  [turn {idx + 1}/{len(turns)}] FAIL  ({tc.duration_ms}ms)  fails={[a.name for a in fails]}", flush=True)
        else:
            print(f"  [turn {idx + 1}/{len(turns)}] PASS  ({tc.duration_ms}ms)", flush=True)
    return run


def write_bundle(run: ScenarioRun, run_dir: Path) -> None:
    """Write the bundle directory the Claude judge consumes."""
    bundle_dir = run_dir / "bundles" / run.id
    bundle_dir.mkdir(parents=True, exist_ok=True)
    verdict_dir = run_dir / "verdicts" / run.id
    verdict_dir.mkdir(parents=True, exist_ok=True)

    scenario_snapshot = {
        "id": run.id,
        "purpose": run.purpose,
        "tags": run.tags,
        "setup_error": run.setup_error,
        "hard_status": run.hard_status(),
        "turns": [
            {
                "turn_id": t.turn_id,
                "user_message": t.user_message,
                "drive_error": t.drive_error,
                "hard_passed": t.hard_passed(),
                "duration_ms": t.duration_ms,
                "assertions": [asdict(a) for a in t.assertions],
                "approval_outcomes": t.approval_outcomes,
            }
            for t in run.turns
        ],
    }
    (bundle_dir / "scenario.json").write_text(
        json.dumps(scenario_snapshot, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    for idx, t in enumerate(run.turns):
        md = render_turn_bundle(run, t, idx, verdict_dir)
        (bundle_dir / f"t{idx}-{t.turn_id}.md").write_text(md, encoding="utf-8")


def render_turn_bundle(run: ScenarioRun, t: TurnCapture, idx: int, verdict_dir: Path) -> str:
    """One markdown file per turn, in the shape the judge playbook expects."""
    captured = t.captured or {}
    recall = captured.get("recall") or {}
    summary = captured.get("turnSummary") or {}
    cards = captured.get("chatCards") or []
    approvals = captured.get("approvals") or []
    jobs = captured.get("backgroundJobs") or []
    qrs = captured.get("quickReplies") or []

    verdict_path = verdict_dir / f"t{idx}-{t.turn_id}.json"

    parts: list[str] = []
    parts.append(f"# Athena Quality Bundle — `{run.id}` / turn `{t.turn_id}`")
    parts.append("")
    parts.append(f"> **Scenario purpose:** {run.purpose}")
    parts.append("")
    parts.append(f"- Turn {idx + 1} of {len(run.turns)}")
    parts.append(f"- Hard-assertion status: **{'PASS' if t.hard_passed() else 'FAIL'}**")
    parts.append(f"- Wall time: {t.duration_ms}ms")
    if t.drive_error:
        parts.append(f"- Drive error: `{t.drive_error}`")
    parts.append("")
    parts.append("## User said")
    parts.append("")
    parts.append("```")
    parts.append(t.user_message)
    parts.append("```")
    parts.append("")
    parts.append("## Athena's reply")
    parts.append("")
    reply = captured.get("reply") or ""
    if reply:
        parts.append("```")
        parts.append(reply)
        parts.append("```")
    else:
        parts.append("_(no reply captured — turn likely failed before persistence)_")
    parts.append("")

    parts.append("## What Athena did this turn (dispatcher output)")
    parts.append("")
    parts.append(f"- **chat_cards** ({len(cards)}): " + (
        ", ".join(f"`{c.get('kind')}`" for c in cards) or "_none_"
    ))
    if cards:
        parts.append("")
        parts.append("  Card config keys:")
        for c in cards:
            keys = sorted(list((c.get("config") or {}).keys()))
            parts.append(f"  - `{c.get('kind')}` — keys: {keys}")
    parts.append(f"- **approvals_filed** ({len(approvals)}): " + (
        ", ".join(f"`{a.get('action')}`" for a in approvals) or "_none_"
    ))
    if approvals:
        for a in approvals:
            try:
                pj = json.loads(a.get("paramsJson") or "{}")
            except json.JSONDecodeError:
                pj = {}
            parts.append(f"  - `{a.get('action')}` params: `{json.dumps(pj, ensure_ascii=False)}`")
    parts.append(f"- **quick_replies** ({len(qrs)}): {qrs}")
    parts.append(f"- **background_jobs_queued** ({len(jobs)}): " + (
        ", ".join(f"`{j.get('kind')}`({j.get('status')})" for j in jobs) or "_none_"
    ))
    parts.append(f"- **turn_summary**: `{json.dumps(summary, ensure_ascii=False)}`")
    parts.append("")

    parts.append("## What Athena consulted (recall preview)")
    parts.append("")
    if recall:
        parts.append(f"- **doctrine** ({len(recall.get('doctrineTitles') or [])}): {recall.get('doctrineTitles') or []}")
        parts.append(f"- **facts** ({len(recall.get('factTitles') or [])}): {recall.get('factTitles') or []}")
        parts.append(f"- **procedurals** ({len(recall.get('proceduralTitles') or [])}): {recall.get('proceduralTitles') or []}")
        parts.append(f"- **goals** ({len(recall.get('goalTitles') or [])}): {recall.get('goalTitles') or []}")
        parts.append(f"- **backlog** ({len(recall.get('backlogTitles') or [])}): {recall.get('backlogTitles') or []}")
        parts.append(f"- **synthesized**: {bool(recall.get('synthesized'))}")
        parts.append(f"- **episode_count**: {recall.get('episodeCount')}")
    else:
        parts.append("_(no recall preview captured)_")
    parts.append("")

    if t.approval_outcomes:
        parts.append("## What happened on auto-approve")
        parts.append("")
        parts.append(
            "Every approval Athena emitted this turn was auto-approved by the "
            "harness. Below is each approval's resolution — `result.clientAction` "
            "names the follow-up the frontend would have run on click "
            "(navigate, prefill, etc.). Async side-effects (build session start, "
            "scan job enqueue) surface in the next turn's captured state."
        )
        parts.append("")
        for o in t.approval_outcomes:
            mark = "✅" if o.get("success") else "❌"
            action = o.get("action") or "?"
            if o.get("success"):
                result = o.get("result") or {}
                if isinstance(result, dict):
                    status = result.get("status") or "?"
                    msg = (result.get("message") or "").strip()
                    msg = (msg[:140] + "…") if len(msg) > 140 else msg
                    client = result.get("clientAction") or {}
                    if isinstance(client, dict):
                        client_repr = client.get("type") or "(none)"
                    else:
                        client_repr = "(none)"
                    parts.append(
                        f"- {mark} `{action}` — status: `{status}`, clientAction: `{client_repr}`{(' — ' + msg) if msg else ''}"
                    )
                else:
                    parts.append(f"- {mark} `{action}` — raw result: {result}")
            else:
                err = (o.get("error") or "").strip()
                err = (err[:200] + "…") if len(err) > 200 else err
                parts.append(f"- {mark} `{action}` — APPROVE FAILED: {err}")
        parts.append("")

    parts.append("## Hard assertions")
    parts.append("")
    if not t.assertions:
        parts.append("_(no hard assertions specified for this turn)_")
    else:
        for a in t.assertions:
            mark = "✅" if a.passed else "❌"
            detail = f" — {a.detail}" if a.detail else ""
            parts.append(f"- {mark} `{a.name}`{detail}")
    parts.append("")

    parts.append("## Judge rubric (this turn)")
    parts.append("")
    parts.append(f"**Axes to score:** {', '.join(t.judge_axes)}")
    parts.append("")
    parts.append("**Surface map:**")
    if t.judge_surface_map:
        for k, v in t.judge_surface_map.items():
            parts.append(f"- _\"{k}\"_ → {v}")
    else:
        parts.append("_(none — use universal axes only)_")
    parts.append("")
    parts.append("**Anti-patterns to flag explicitly:**")
    if t.judge_anti_patterns:
        for p in t.judge_anti_patterns:
            parts.append(f"- {p}")
    else:
        parts.append("_(none — use universal anti-patterns only)_")
    parts.append("")

    parts.append("## Your job, as the judge")
    parts.append("")
    parts.append(f"Read [the judge playbook](../../../judge-playbook.md) for the full contract, then write a verdict JSON to:")
    parts.append("")
    parts.append(f"    {verdict_path.relative_to(REPO_ROOT).as_posix()}")
    parts.append("")
    parts.append("matching the schema in the playbook §\"Verdict file format\".")
    parts.append("")
    return "\n".join(parts)


def cmd_run(args: argparse.Namespace) -> int:
    started = datetime.now(timezone.utc)
    stamp = started.strftime("%Y-%m-%d-%H%M")
    run_dir = (Path(args.out_dir) if args.out_dir else RESULTS_DIR) / stamp
    run_dir.mkdir(parents=True, exist_ok=True)

    client = Client(port=args.port, default_timeout=240)
    bridge = Bridge(client)

    try:
        health = client.health()
    except SystemExit as e:
        print(f"[preflight] {e}", file=sys.stderr)
        return 3
    print(f"[preflight] server={health.get('server')} version={health.get('version')}")

    fixtures = discover_fixtures(args.filter)
    skip = {s.strip() for s in (args.skip or "").split(",") if s.strip()}
    if skip:
        fixtures = [p for p in fixtures if p.stem not in skip]
        print(f"[discover] skipping: {sorted(skip)}", file=sys.stderr)
    if not fixtures:
        print(f"[discover] no fixtures matched filter={args.filter!r} skip={skip} in {FIXTURES_DIR}", file=sys.stderr)
        return 3
    print(f"[discover] {len(fixtures)} fixture(s): {[p.stem for p in fixtures]}")

    runs: list[ScenarioRun] = []
    for path in fixtures:
        fixture = load_fixture(path)
        print(f"\n[scenario] {fixture['id']} — running…", flush=True)
        r = run_scenario(bridge, fixture)
        try:
            write_bundle(r, run_dir)
        except Exception as e:
            # Don't lose the run on a bundle-write hiccup (Unicode encoding,
            # filesystem permission, etc). Record it but keep going.
            print(f"  [bundle-write-ERR] {fixture['id']}: {e!r}", flush=True)
        print(f"[scenario] {fixture['id']} — hard={r.hard_status().upper()}  (bundles: bundles/{r.id}/)", flush=True)
        runs.append(r)

    finished = datetime.now(timezone.utc)
    hard_overall = "fail" if any(r.hard_status() == "fail" for r in runs) else "pass"
    manifest = {
        "started": started.isoformat(),
        "finished": finished.isoformat(),
        "stamp": stamp,
        "phase": "captured",
        "hard_overall": hard_overall,
        "scenarios": [{"id": r.id, "hard_status": r.hard_status()} for r in runs],
        "next_step": (
            "Open Claude Code with this run dir in scope. For each "
            "bundles/<id>/t<n>-*.md, follow docs/tests/athena/judge-playbook.md "
            "and write a verdict JSON to verdicts/<id>/t<n>-*.json. Then run "
            f"`python tools/test-mcp/athena_quality_suite.py --aggregate {run_dir.relative_to(REPO_ROOT).as_posix()}`."
        ),
    }
    (run_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8",
    )
    print(f"\n[manifest] {run_dir / 'manifest.json'}")
    print(f"[next] feed the bundles under {run_dir / 'bundles'} to Claude Code, then run --aggregate.")
    return 0 if hard_overall == "pass" else 1


# ─── Pass 2 — aggregate verdicts ────────────────────────────────────────


def _axis_worst(verdict: dict[str, Any]) -> str:
    axes = [
        verdict.get("useful"), verdict.get("grounded"), verdict.get("right_data_source"),
        verdict.get("no_hallucinated_capabilities"), verdict.get("op_correctness"),
    ]
    axes = [a for a in axes if a and a != "n/a"]
    if any(a == "fail" for a in axes):
        return "fail"
    if any(a == "weak" for a in axes):
        return "weak"
    return "ok"


def _turn_status(hard_passed: bool, verdict: dict[str, Any] | None) -> str:
    if not hard_passed:
        return "fail"
    if verdict is None:
        return "ungraded"
    worst = _axis_worst(verdict)
    if worst == "fail":
        return "fail"
    if worst == "weak":
        return "warn"
    return "pass"


def cmd_aggregate(args: argparse.Namespace) -> int:
    run_dir = Path(args.aggregate)
    if not run_dir.is_absolute():
        run_dir = REPO_ROOT / run_dir
    if not run_dir.exists():
        print(f"[aggregate] run dir not found: {run_dir}", file=sys.stderr)
        return 3
    manifest_path = run_dir / "manifest.json"
    if not manifest_path.exists():
        print(f"[aggregate] no manifest at {manifest_path}", file=sys.stderr)
        return 3
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    bundles_root = run_dir / "bundles"
    verdicts_root = run_dir / "verdicts"

    scenarios_out: list[dict[str, Any]] = []
    missing: list[str] = []
    for entry in manifest.get("scenarios") or []:
        scenario_id = entry["id"]
        scenario_path = bundles_root / scenario_id / "scenario.json"
        if not scenario_path.exists():
            print(f"[aggregate] missing scenario.json for {scenario_id}", file=sys.stderr)
            return 3
        scenario_snapshot = json.loads(scenario_path.read_text(encoding="utf-8"))

        turns_out: list[dict[str, Any]] = []
        for idx, turn in enumerate(scenario_snapshot.get("turns") or []):
            verdict_path = verdicts_root / scenario_id / f"t{idx}-{turn['turn_id']}.json"
            verdict: dict[str, Any] | None = None
            if verdict_path.exists():
                try:
                    verdict = json.loads(verdict_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError as e:
                    print(f"[aggregate] malformed verdict at {verdict_path}: {e}", file=sys.stderr)
                    return 3
            else:
                missing.append(str(verdict_path.relative_to(REPO_ROOT)))
            turns_out.append({
                **turn,
                "verdict": verdict,
                "status": _turn_status(turn["hard_passed"], verdict),
            })

        statuses = {t["status"] for t in turns_out}
        if "fail" in statuses:
            scenario_status = "fail"
        elif "ungraded" in statuses:
            scenario_status = "ungraded"
        elif "warn" in statuses:
            scenario_status = "warn"
        else:
            scenario_status = "pass"

        scenarios_out.append({
            "id": scenario_id,
            "purpose": scenario_snapshot.get("purpose"),
            "status": scenario_status,
            "setup_error": scenario_snapshot.get("setup_error"),
            "turns": turns_out,
        })

    if missing:
        print(f"[aggregate] {len(missing)} verdict file(s) missing — judge pass incomplete:", file=sys.stderr)
        for m in missing[:10]:
            print(f"  - {m}", file=sys.stderr)
        if not args.partial:
            print("[aggregate] re-run with --partial to aggregate anyway (ungraded turns counted as such).", file=sys.stderr)
            return 3

    overall_statuses = {s["status"] for s in scenarios_out}
    if "fail" in overall_statuses:
        overall = "fail"
    elif "ungraded" in overall_statuses:
        overall = "ungraded"
    elif "warn" in overall_statuses:
        overall = "warn"
    else:
        overall = "pass"

    report = {
        "started": manifest.get("started"),
        "aggregated_at": datetime.now(timezone.utc).isoformat(),
        "stamp": manifest.get("stamp"),
        "overall": overall,
        "scenarios": scenarios_out,
    }
    (run_dir / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8",
    )
    print(f"[report] {run_dir / 'report.json'}")

    if args.markdown:
        write_markdown_report(report, run_dir / "report.md")
        print(f"[report] {run_dir / 'report.md'}")

    print(f"\n[summary] overall={overall.upper()}  scenarios={len(scenarios_out)}")
    return {"pass": 0, "warn": 1, "fail": 2, "ungraded": 1}[overall]


def write_markdown_report(report: dict[str, Any], path: Path) -> None:
    lines: list[str] = []
    lines.append(f"# Athena Quality Suite — {report.get('stamp')}")
    lines.append("")
    lines.append(f"**Overall:** `{report.get('overall', 'unknown').upper()}`")
    lines.append("")
    for s in report.get("scenarios") or []:
        lines.append(f"## `{s['id']}` — {s['status'].upper()}")
        lines.append("")
        lines.append(f"> {s.get('purpose', '')}")
        lines.append("")
        if s.get("setup_error"):
            lines.append(f"**Setup error:** `{s['setup_error']}`")
            lines.append("")
            continue
        for t in s.get("turns") or []:
            lines.append(f"### Turn `{t['turn_id']}` — {t['status'].upper()}  ({t.get('duration_ms', 0)}ms)")
            lines.append("")
            lines.append(f"> _user:_ {t['user_message']}")
            lines.append("")
            for a in t.get("assertions") or []:
                mark = "✅" if a["passed"] else "❌"
                detail = f" — {a['detail']}" if a.get("detail") else ""
                lines.append(f"- {mark} `{a['name']}`{detail}")
            v = t.get("verdict")
            if v:
                lines.append("")
                lines.append("**Judge:**")
                for axis in ["useful", "grounded", "right_data_source", "no_hallucinated_capabilities", "op_correctness"]:
                    val = v.get(axis)
                    if not val or val == "n/a":
                        continue
                    mark = {"ok": "✅", "weak": "⚠️", "fail": "❌"}.get(val, "•")
                    note = v.get(f"{axis}_note") or ""
                    lines.append(f"  - {mark} `{axis}` — {val}{(' — ' + note) if note else ''}")
                if v.get("overall_note"):
                    lines.append(f"  - _overall:_ {v['overall_note']}")
            elif t["status"] == "ungraded":
                lines.append("")
                lines.append("_(no verdict file found — judge pass not completed for this turn)_")
            lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


# ─── Main ───────────────────────────────────────────────────────────────


def main() -> None:
    p = argparse.ArgumentParser(description="Athena Quality Suite — two-pass runner (drive+capture, then aggregate Claude verdicts)")
    p.add_argument("--port", type=int, default=int(os.environ.get("PERSONAS_TEST_PORT", 17320)))
    p.add_argument("--filter", default=None, help="Substring filter on fixture id/filename")
    p.add_argument("--skip", default=None, help="Comma-separated scenario ids to skip (use after a partial run to resume)")
    p.add_argument("--out-dir", default=None, help="Override base results dir (default: docs/tests/athena/results/)")
    p.add_argument("--aggregate", default=None, help="PASS 2 — point at a run dir (docs/tests/athena/results/<stamp>) to merge verdicts into the final report")
    p.add_argument("--partial", action="store_true", help="Pass 2 only — emit the report even if some verdict files are missing (those turns roll up as 'ungraded')")
    p.add_argument("--markdown", action="store_true", help="Pass 2 only — also emit report.md alongside report.json")
    args = p.parse_args()

    if args.aggregate:
        sys.exit(cmd_aggregate(args))
    sys.exit(cmd_run(args))


if __name__ == "__main__":
    main()
