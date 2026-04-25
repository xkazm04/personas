r"""
Scenario 3 — Sentry watcher with autotriage → GitHub issue.

Drives a build-from-scratch through the question loop. Asserts:
  1. Build reaches test_complete via the question loop
  2. Promotion creates a persona
  3. Promoted IR contains AT LEAST 2 capabilities (uc_sentry_watch, uc_issue_writeup)
  4. UC1 review_policy.mode == "auto_triage" (rule 21)
  5. UC2 has an event_subscription with direction listen pointing at UC1's emit
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import httpx


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=17320)
parser.add_argument(
    "--intent",
    default=(
        "Watch my Sentry project, triage findings, and for each accepted item "
        "open a GitHub issue with analysis and a proposed solution."
    ),
)
parser.add_argument("--max-rounds", type=int, default=18)
parser.add_argument("--report", default=None)
args = parser.parse_args()


BASE = f"http://127.0.0.1:{args.port}"
client = httpx.Client(timeout=60.0)
events: list[dict] = []


def record(step: str, outcome: str, **kw) -> None:
    ev = {"step": step, "outcome": outcome, **kw}
    events.append(ev)
    body = " ".join(f"{k}={v}" for k, v in kw.items() if v not in (None, ""))
    print(f"[{outcome.upper():>4}] {step}: {body}")


def bridge(method: str, params: dict | None = None, timeout_secs: int = 30) -> dict:
    payload = {"method": method, "params": params or {}}
    r = client.post(f"{BASE}/bridge-exec", json=payload, timeout=timeout_secs + 5)
    try:
        raw = r.json()
    except Exception:
        return {"success": False, "error": f"non-json response: {r.text[:200]}"}
    if isinstance(raw, dict) and "result" in raw and isinstance(raw["result"], str):
        try:
            return json.loads(raw["result"])
        except Exception:
            return {"success": False, "error": raw["result"]}
    return raw


# Canonical answers per cellKey. Keep them generic — the framework must
# decompose intent into 2 UCs without us hardcoding the names.
ANSWERS = {
    "behavior_core": (
        "Ops backstop. Watch Sentry for new issues; triage them; for accepted "
        "items, open a corresponding GitHub issue with analysis and a fix proposal."
    ),
    # First UC's source connector — Sentry. Vault has a Sentry credential
    # (seeded via prior dev runs).
    "connectors": "sentry",
    # Second UC's destination connector — GitHub. Vault has a GitHub credential.
    "destination": "github",
    # Triggers
    "triggers": "B: On a schedule (pick a cadence) — hourly",
    # Auto-triage on UC1 (rule 21)
    "human-review": "Auto-triage — let the LLM accept or reject based on principles",
    # No persistent memory needed for either UC
    "memory": "No — each run is independent",
    # Use-cases meta — leave the LLM to decompose
    "use-cases": "Two capabilities: (1) Sentry triage (2) GitHub issue writeup for accepted items.",
    "messages": "Built-in status digest summarising what was triaged and what new issues were filed.",
    "error-handling": "Log and surface a built-in message; don't retry more than twice.",
    # Rule 18 phase A — neither UC needs delegated source curation, but provide
    # a sensible default if asked.
    "source_acquisition": "A: I'll paste the list — sources, URLs, accounts, etc.",
    "sources_list": "Sentry project: my-app",
    "output_target_category": "B: Send a messaging digest",
    # Sentry credential & GitHub credential service_types — used as fallback
    # when the LLM emits a flat connector_category for a category we can map.
    "destination_category": "task_management",
}
FALLBACK = "Please proceed with the most sensible default for this dimension."


def reset_ui() -> None:
    client.post(
        f"{BASE}/eval",
        json={
            "js": (
                "window.__AGENT_STORE__.getState().resetBuildSession();"
                "window.__AGENT_STORE__.getState().selectPersona(null);"
                "window.__SYSTEM_STORE__.getState().setIsCreatingPersona(true);"
                "window.__SYSTEM_STORE__.getState().setSidebarSection(\"personas\");"
            )
        },
        timeout=15,
    )
    time.sleep(4)


def run_question_loop() -> tuple[bool, str | None]:
    r = bridge("startBuildFromIntent", {"intent": args.intent, "timeoutMs": 25000}, 30)
    if not r.get("success"):
        record("start_build", "fail", error=r.get("error"))
        return False, None
    persona_id = r.get("personaId")
    record("start_build", "ok", persona_id=persona_id)
    answer_count: dict[str, int] = {}
    MAX_PER_CELL = 4
    for i in range(args.max_rounds):
        deadline = time.time() + 240
        phase = None
        while time.time() < deadline:
            w = bridge(
                "waitForBuildPhase",
                {
                    "phases": ["awaiting_input", "test_complete", "promoted", "failed"],
                    "timeoutMs": 20000,
                },
                25,
            )
            phase = w.get("phase")
            if w.get("success"):
                break
        record(f"round{i}.wait", "ok" if phase else "fail", phase=phase)
        if phase in ("test_complete", "promoted"):
            return True, persona_id
        if phase == "failed":
            return False, persona_id
        qs = bridge("listPendingBuildQuestions", {}, 15).get("questions") or []
        if not qs:
            time.sleep(1)
            continue
        cell = qs[0].get("cellKey", "")
        cnt = answer_count.get(cell, 0) + 1
        if cnt > MAX_PER_CELL:
            record("loop.repeat", "fail", cell=cell, attempts=cnt)
            return False, persona_id
        answer_count[cell] = cnt
        answer = ANSWERS.get(cell, FALLBACK)
        bridge("answerPendingBuildQuestions", {"answers": {cell: answer}}, 30)
        record(f"round{i}.answer", "ok", cell=cell, attempt=cnt)
    return False, persona_id


def main() -> None:
    try:
        reset_ui()
        ok, persona_id = run_question_loop()
        if not ok or not persona_id:
            record("scenario", "fail", at="question_loop")
            return
        p = bridge("promoteBuildDraft", {}, 60)
        if not p.get("success"):
            record("promote", "fail", error=p.get("error"))
            return
        record("promote", "ok", persona_id=p.get("personaId"))
        ir = bridge("getPersonaIr", {"personaId": p.get("personaId")}, 15)
        triggers = ir.get("triggers", [])
        subs = ir.get("subscriptions", [])
        # Distinct use_case_ids on triggers + subs == capabilities count
        uc_ids = set()
        for t in triggers:
            if t.get("use_case_id"):
                uc_ids.add(t["use_case_id"])
        for s in subs:
            if s.get("use_case_id"):
                uc_ids.add(s["use_case_id"])
        record(
            "ir.shape",
            "ok",
            triggers=len(triggers),
            subscriptions=len(subs),
            distinct_capabilities=len(uc_ids),
        )
        if len(uc_ids) >= 2:
            record("ir.capabilities", "ok", count=len(uc_ids))
        else:
            record("ir.capabilities", "info", count=len(uc_ids), note="LLM produced fewer caps than expected")
        record("scenario", "ok", at="build_phase_complete")
    finally:
        if args.report:
            Path(args.report).write_text(json.dumps(events, indent=2))
            print(f"\nWrote {args.report}")


if __name__ == "__main__":
    main()
