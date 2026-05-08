"""
Model calibration harness — for each of the 20 R-scenarios, builds a
persona, then runs the SAME post-promote IR against Haiku, Sonnet, and
Opus. Captures the artifacts each model produces (Messages, Memories,
Manual Reviews, Execution rows) so an external judge (you, reading the
emitted JSON) can compare content quality across model tiers and
calibrate "when to use which".

Operating model:
  - Talks to the test-automation HTTP server on 127.0.0.1:17320 — start
    the desktop app with `npm run tauri:dev:test`.
  - Reuses the build flow from e2e_rapid_validation.py so the persona
    always lands at draft_ready with the same fixture answers.
  - After promote, calls the new `forcePersonaModel` bridge method to
    rewrite the persona's `model_profile` AND each use_case's
    `model_override` to the test model — guarantees the fired execution
    actually hits the chosen tier rather than the LLM's recommendation.
  - Fires `executePersona` once per use case, waits for completion, then
    pulls the artifacts via `getPersonaArtifacts`.
  - Personas are NOT deleted. Names are tagged `R01 [Haiku]` etc. so you
    can find them in the UI.

Output:
  tools/test-mcp/reports/model_calibration/<UTC-ts>/<scenario>.json
  - One file per scenario containing all three model variants side by
    side, with full content of every artifact. Read three at a time.

Usage:
  python tools/test-mcp/e2e_model_calibration.py --persona R01
  python tools/test-mcp/e2e_model_calibration.py --all
  python tools/test-mcp/e2e_model_calibration.py --all --models sonnet,opus
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

# Reuse PERSONAS + build_answer recipe from the rapid-validation suite.
sys.path.insert(0, str(Path(__file__).parent))
from e2e_rapid_validation import (  # type: ignore[import-not-found]
    PERSONAS,
    build_answer,
)


# ─── Models under test ─────────────────────────────────────────────────────

# Bare model ids accepted by `model_override`. Tiered short-tags map to the
# canonical Anthropic model ids documented in CLAUDE.md.
MODELS: dict[str, str] = {
    "haiku":  "claude-haiku-4-5-20251001",
    "sonnet": "claude-sonnet-4-6",
    "opus":   "claude-opus-4-7",
}


# ─── CLI ────────────────────────────────────────────────────────────────────

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

parser = argparse.ArgumentParser(description="Model calibration suite (20 scenarios × 3 models)")
parser.add_argument("--port", type=int, default=17320)
group = parser.add_mutually_exclusive_group(required=True)
group.add_argument("--persona", type=str, help="Single scenario id e.g. R01")
group.add_argument("--all", action="store_true", help="Run R01..R20")
parser.add_argument(
    "--models", type=str, default="haiku,sonnet,opus",
    help="Comma-separated subset of models to test (default: all three)",
)
parser.add_argument("--build-timeout", type=int, default=300)
parser.add_argument("--exec-timeout", type=int, default=240)
parser.add_argument(
    "--report-dir", type=str, default=None,
    help="Override report directory. Default: tools/test-mcp/reports/model_calibration/<ts>/",
)
args = parser.parse_args()

selected_models: list[str] = []
for token in args.models.split(","):
    t = token.strip().lower()
    if not t:
        continue
    if t not in MODELS:
        raise SystemExit(f"Unknown model {t!r}. Valid: {sorted(MODELS)}")
    selected_models.append(t)

if args.persona and args.persona not in PERSONAS:
    raise SystemExit(f"Unknown scenario {args.persona!r}. Valid: {sorted(PERSONAS)}")

scenarios: list[str] = sorted(PERSONAS) if args.all else [args.persona]

BASE = f"http://127.0.0.1:{args.port}"
client = httpx.Client(base_url=BASE, timeout=600)


# ─── HTTP / bridge helpers ─────────────────────────────────────────────────

def _post(path: str, body: dict | None = None, *, timeout: int = 120) -> dict:
    r = client.post(path, json=body or {}, timeout=timeout)
    try:
        return json.loads(r.text)
    except json.JSONDecodeError:
        return {"_raw": r.text, "_status": r.status_code}


def bridge(method: str, params: dict | None = None, *, timeout_secs: int = 180,
           retry_on_timeout: int = 0) -> dict:
    """Forward to /bridge-exec — the test-automation generic dispatcher.

    `retry_on_timeout` controls automatic retries for `ReadTimeout`
    failures, which we've observed transiently on the very first call
    of a round (the WebView state needs a moment to settle after the
    previous round's persona finished and the build form re-appears).
    Sleeps 5s between attempts. ReadTimeout on every attempt re-raises
    so the round-level handler can mark the round as harness_exception.
    """
    body = {"method": method, "params": params or {}, "timeout_secs": timeout_secs}
    last_exc: Exception | None = None
    for attempt in range(retry_on_timeout + 1):
        try:
            return _post("/bridge-exec", body, timeout=timeout_secs + 20)
        except httpx.ReadTimeout as e:
            last_exc = e
            if attempt < retry_on_timeout:
                time.sleep(5.0)
                continue
            raise
        except json.JSONDecodeError:
            # Already handled inside _post — never reaches here.
            raise
    if last_exc:
        raise last_exc
    return {}


# ─── Build flow (reused from rapid-validation) ─────────────────────────────

def step_start(intent: str) -> dict:
    """Fire startBuildFromIntent. Retries once on ReadTimeout — the
    very first call after a previous round's persona finished can hang
    transiently while the WebView state settles back to "creating
    persona = false → reset → true". A 5s sleep + retry has been
    enough in practice."""
    return bridge(
        "startBuildFromIntent",
        {"intent": intent},
        timeout_secs=args.build_timeout,
        retry_on_timeout=1,
    )


def settle_between_rounds() -> None:
    """Reset the WebView's persona/build state and pause to let the UI
    transitions and any in-flight network calls finish. Called between
    each (scenario, model) round to reduce ReadTimeout noise on the
    next `startBuildFromIntent`."""
    # Best-effort — failures here just degrade to "no settle"; the
    # next round's retry-on-timeout will compensate.
    try:
        _post("/test/reset", {}, timeout=20)
        bridge("navigate", {"section": "personas"}, timeout_secs=15)
    except Exception:  # noqa: BLE001
        pass
    time.sleep(6)


def step_answer_loop(intent: str, spec: dict, *, max_rounds: int = 40) -> dict:
    """Drain the build's question queue until the session reaches a
    terminal-ish phase the harness can act on.

    Awaited phases match e2e_rapid_validation.step_answer_dimensions:
    `draft_ready`, `test_complete`, `promoted` are all valid stop
    points because the UI's auto-test useEffect fires `_test`
    immediately on `draft_ready`, so the session may transition past
    DraftReady before the bridge's 20s polling slice catches it.
    Treat any of those as success — `step_promote` validates the
    transition, and `BuildPhase::validate_transition` accepts both
    `DraftReady → Promoted` and `TestComplete → Promoted`.
    """
    ask_counts: dict[str, int] = {}
    for _ in range(max_rounds):
        phase_resp = bridge("waitForBuildPhase", {
            "phases": [
                "awaiting_input",
                "draft_ready",
                "test_complete",
                "promoted",
                "failed",
                "cancelled",
            ],
            "timeoutMs": 60_000,
        }, timeout_secs=70)
        phase = phase_resp.get("phase")
        if phase in ("draft_ready", "test_complete", "promoted", "failed", "cancelled"):
            return {"phase": phase, "rounds": _ + 1}
        # phase is None / "initializing" / "analyzing" / "resolving" — keep
        # polling, and only ask the question listing when actually awaiting
        # input. Fixes the regression where the harness called
        # listPendingBuildQuestions every iteration even mid-analysis.
        if phase != "awaiting_input":
            time.sleep(0.5)
            continue

        listing = bridge("listPendingBuildQuestions", {})
        questions = listing.get("questions") or []
        if not questions:
            time.sleep(1.0)
            continue

        answers: dict[str, str] = {}
        for q in questions:
            cell_key = q.get("cellKey") or q.get("cell_key") or "unknown"
            ask_counts[cell_key] = ask_counts.get(cell_key, 0) + 1
            answers[cell_key] = build_answer(intent, cell_key, spec, ask_counts[cell_key], q)
        bridge("answerPendingBuildQuestions", {"answers": answers}, timeout_secs=120)

    return {"phase": "timeout", "rounds": max_rounds}


def step_promote() -> dict:
    """Promote the draft. Reuses /promote-build (direct invoke + bridge nav)."""
    return _post("/promote-build", {}, timeout=120)


# ─── Calibration-specific steps ────────────────────────────────────────────

def step_rename(persona_id: str, new_name: str) -> dict:
    """Tag the persona with the model so it's findable in the UI."""
    return bridge("forcePersonaModel", {"personaId": persona_id, "model": ""},
                  timeout_secs=10) if False else (
        # Use update_persona via eval — simplest path for a one-shot rename.
        bridge_update_persona(persona_id, {"name": new_name})
    )


def bridge_update_persona(persona_id: str, fields: dict) -> dict:
    """Direct update_persona invoke via the bridge's eval_js fallback —
    avoids adding a dedicated rename helper for a one-line write."""
    fields_json = json.dumps(fields)
    js = (
        "(async () => { const inv = (await import('@tauri-apps/api/core')).invoke;"
        f" return await inv('update_persona', {{ id: {json.dumps(persona_id)}, input: {fields_json} }});"
        " })()"
    )
    return _post("/eval", {"js": js}, timeout=30)


def step_force_model(persona_id: str, model: str) -> dict:
    """Override the persona's model_profile + every use_case's model_override
    so the fired executions definitively run on the test model."""
    return bridge("forcePersonaModel", {"personaId": persona_id, "model": model},
                  timeout_secs=30)


def step_fire_executions(persona_id: str) -> list[dict]:
    """Fire one execution per use case so each capability gets a chance to
    produce artifacts. For single-UC personas this is one call; for
    multi-UC, we hit each independently."""
    listing = bridge("listPersonaUseCases", {"nameOrId": persona_id}, timeout_secs=30)
    ucs = listing.get("useCases") or []
    fires: list[dict] = []
    if not ucs:
        # No use cases — fire the persona directly so we still get a
        # signal of "model can/can't even start the persona".
        r = bridge("executePersona", {"nameOrId": persona_id},
                   timeout_secs=args.exec_timeout)
        fires.append({"useCaseId": None, "result": r})
        return fires
    for uc in ucs:
        uc_id = uc.get("id")
        if not uc_id:
            continue
        r = bridge("executePersona",
                   {"nameOrId": persona_id, "useCaseId": uc_id},
                   timeout_secs=args.exec_timeout)
        fires.append({"useCaseId": uc_id, "title": uc.get("title"), "result": r})
    return fires


def step_capture_artifacts(persona_id: str) -> dict:
    """Pull executions + messages + memories + manual_reviews so the
    judge can read what each model actually produced."""
    return bridge("getPersonaArtifacts", {"personaId": persona_id},
                  timeout_secs=30)


TERMINAL_EXEC_STATUSES = {"completed", "failed", "cancelled", "incomplete", "timeout"}


def wait_for_exec_terminal(persona_id: str, exec_ids: list[str],
                           *, timeout_seconds: int = 240) -> dict:
    """Poll `getPersonaArtifacts` until every fired exec id reaches a
    terminal status (or the timeout fires). Re-uses the same bridge
    method we'll call for the final artifact capture, so the polling
    overhead is one cheap query every 4s rather than per-exec
    individual lookups (which would also need ownership verification
    we don't trivially have).

    Returns the per-exec final statuses so the per-scenario report
    shows whether each fire ran to completion or got truncated by
    the timeout — useful when judging output quality, since a
    `timeout`-status exec means the model didn't finish and the
    artifacts are incomplete.
    """
    if not exec_ids:
        return {"reason": "no exec ids", "statuses": {}}
    pending = set(exec_ids)
    statuses: dict[str, str] = {}
    deadline = time.time() + timeout_seconds
    poll_interval = 4.0
    while pending and time.time() < deadline:
        r = bridge("getPersonaArtifacts", {"personaId": persona_id}, timeout_secs=20)
        if r.get("success"):
            for ex in (r.get("executions") or []):
                eid = ex.get("id")
                if eid in pending:
                    s = ex.get("status")
                    if s in TERMINAL_EXEC_STATUSES:
                        statuses[eid] = s
                        pending.discard(eid)
        if pending:
            time.sleep(poll_interval)
    for eid in pending:
        statuses[eid] = "timeout"
    return {
        "timeout_seconds": timeout_seconds,
        "statuses": statuses,
        "all_terminal": not pending,
    }


# ─── Single (scenario, model) round ────────────────────────────────────────

def run_round(scenario: str, spec: dict, model_tag: str, model_id: str) -> dict:
    """One end-to-end build+test round for a (scenario, model) pair."""
    started = datetime.now(timezone.utc).isoformat()
    started_at = time.time()

    record: dict[str, Any] = {
        "scenario": scenario,
        "model_tag": model_tag,
        "model_id": model_id,
        "intent": spec["intent"],
        "started_at": started,
        "phases": {},
        "errors": [],
    }

    # 1) Build
    print(f"\n[{scenario} / {model_tag}] starting build")
    build_resp = step_start(spec["intent"])
    if not build_resp.get("success"):
        record["errors"].append({"step": "start_build", "detail": build_resp})
        record["status"] = "build_failed"
        return record
    record["phases"]["build_started"] = build_resp
    persona_id = build_resp.get("personaId")
    session_id = build_resp.get("sessionId")
    record["session_id"] = session_id
    record["draft_persona_id"] = persona_id

    # 2) Answer questions until draft_ready / test_complete / promoted
    answer_summary = step_answer_loop(spec["intent"], spec)
    record["phases"]["answer_loop"] = answer_summary
    settled_phase = answer_summary.get("phase")
    if settled_phase not in ("draft_ready", "test_complete", "promoted"):
        record["status"] = f"build_phase_{settled_phase}"
        record["errors"].append({"step": "answer_loop", "detail": answer_summary})
        return record

    # 3) Promote — skip if the session is already promoted (the UI's
    #    auto-test path can land us at test_complete; the rapid-validation
    #    flow then still calls promote, so do the same here unless we're
    #    already past it).
    if settled_phase != "promoted":
        promote = step_promote()
        record["phases"]["promote"] = {"success": promote.get("success"),
                                       "personaId": promote.get("personaId"),
                                       "from_phase": settled_phase}
        if not promote.get("success"):
            record["errors"].append({"step": "promote", "detail": promote})
            record["status"] = "promote_failed"
            return record
        persona_id = promote.get("personaId") or persona_id
    else:
        record["phases"]["promote"] = {"skipped": True, "from_phase": settled_phase}
    record["persona_id"] = persona_id

    # 4) Tag persona name with the model so the user can find it.
    new_name = f"{scenario} [{model_tag.title()}]"
    rename = bridge_update_persona(persona_id, {"name": new_name})
    record["phases"]["rename"] = {"name": new_name,
                                  "ok": rename.get("status") not in (400, 401, 500)}

    # 5) Override model on persona + every use_case
    forced = step_force_model(persona_id, model_id)
    record["phases"]["force_model"] = forced
    if not forced.get("success"):
        record["errors"].append({"step": "force_model", "detail": forced})

    # 6) Fire executions
    fires = step_fire_executions(persona_id)
    record["phases"]["fires"] = fires

    # 7) Wait for every fired execution to reach a terminal status before
    #    capturing artifacts. Without this the artifact dump catches
    #    `status=running` rows with no output/messages, defeating the
    #    quality-judging purpose of the harness. Budget: 4 min total
    #    across all execs (LLM + tool calls; failure modes like missing
    #    credential are usually fast).
    exec_ids: list[str] = []
    for f in fires:
        ex = (f.get("result") or {}).get("execution") or {}
        if ex.get("id"):
            exec_ids.append(ex["id"])
    waited = wait_for_exec_terminal(persona_id, exec_ids, timeout_seconds=240)
    record["phases"]["wait_for_exec"] = waited

    # 8) Capture artifacts
    artifacts = step_capture_artifacts(persona_id)
    record["artifacts"] = artifacts if artifacts.get("success") else {
        "error": artifacts.get("error"),
    }

    record["duration_seconds"] = round(time.time() - started_at, 1)
    record["status"] = "ok"
    return record


# ─── Driver ────────────────────────────────────────────────────────────────

def main() -> None:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = Path(args.report_dir) if args.report_dir else (
        Path(__file__).parent / "reports" / "model_calibration" / ts
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nCalibration report directory: {out_dir.resolve()}")
    print(f"Scenarios: {scenarios}")
    print(f"Models:    {selected_models}")

    summary: list[dict] = []
    for scenario in scenarios:
        spec = PERSONAS[scenario]
        scenario_record: dict[str, Any] = {
            "scenario": scenario,
            "intent": spec["intent"],
            "expected_use_cases": spec.get("expected_use_cases"),
            "rounds": {},
        }
        for tag_idx, model_tag in enumerate(selected_models):
            model_id = MODELS[model_tag]
            # Settle WebView state between rounds so startBuildFromIntent
            # doesn't ReadTimeout against a stale `isCreatingPersona`
            # transition.
            if tag_idx > 0:
                settle_between_rounds()
            try:
                record = run_round(scenario, spec, model_tag, model_id)
            except Exception as e:  # noqa: BLE001
                record = {
                    "scenario": scenario,
                    "model_tag": model_tag,
                    "model_id": model_id,
                    "status": "harness_exception",
                    "exception": repr(e),
                }
            scenario_record["rounds"][model_tag] = record
            print(f"[{scenario} / {model_tag}] -> {record.get('status')}")

        # Persist per-scenario report so the judge can read three model
        # rounds side-by-side without scrolling through other scenarios.
        scenario_path = out_dir / f"{scenario}.json"
        scenario_path.write_text(json.dumps(scenario_record, indent=2), encoding="utf-8")
        summary.append({
            "scenario": scenario,
            "outcomes": {
                tag: scenario_record["rounds"][tag].get("status", "missing")
                for tag in selected_models
            },
        })

    # Summary index
    (out_dir / "_summary.json").write_text(
        json.dumps({
            "started_at": ts,
            "models": selected_models,
            "scenarios": summary,
        }, indent=2),
        encoding="utf-8",
    )
    print(f"\nDone. {len(scenarios)} scenarios × {len(selected_models)} models.")
    print(f"Reports: {out_dir.resolve()}")


if __name__ == "__main__":
    try:
        main()
    finally:
        client.close()
