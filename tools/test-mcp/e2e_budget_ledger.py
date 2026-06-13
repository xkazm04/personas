r"""
End-to-end scenario: P2 aggregate run-budget ledger on an evolution cycle.

Exercises `engine/run_budget.rs` (warn-only) end-to-end against a REAL evolution
cycle, which fans out many CLI spawns (variants x <=3 scenarios x run+eval). It
asserts that:
  1. The ledger TRACKED cumulative cost across the cycle's spawns
     (summary.budget.spawnCount > 0, spentUsd >= 0).
  2. Warn-only did NOT abort the run (cycle status == "completed").
  3. Budget/exceeded are self-consistent, and when the instance is launched with
     a tiny ceiling, the exceed path fires (budget.exceeded == True).

The final RunBudgetState is embedded in EvolutionCycleSummary.budget (persisted to
the cycle's summary_json + surfaced by `evolution_list_cycles`), so this needs no
dedicated bridge method — it reads the existing cycle summary.

Prerequisites:
  1. Dev app running with the test-automation feature:
       npx tauri dev --features test-automation
     To exercise the EXCEED path cheaply, launch it with a tiny ceiling:
       PERSONAS_RUN_BUDGET_EVOLUTION_USD=0.001 npx tauri dev --features test-automation
  2. Health check: curl http://127.0.0.1:17320/health

Usage:
  uvx --with httpx python tools/test-mcp/e2e_budget_ledger.py
  uvx --with httpx python tools/test-mcp/e2e_budget_ledger.py --persona <id-or-name>
  uvx --with httpx python tools/test-mcp/e2e_budget_ledger.py --port 17320 --variants 2

Flags:
  --port <int>        test-automation server port (default 17320)
  --persona <str>     use an EXISTING promoted persona (id or name); skips build
  --variants <int>    variants_per_cycle for the evolution policy (default 2)
  --expect-exceed     also assert budget.exceeded == True (run with tiny ceiling env)
  --cycle-timeout <s> max seconds to wait for the cycle to finish (default 900)
"""

import argparse
import json
import time

from lib import Bridge, Client, DB, wait_until, WaitTimeout, EventLog

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=17320)
ap.add_argument("--persona", type=str, default=None)
ap.add_argument("--variants", type=int, default=2)
ap.add_argument("--expect-exceed", action="store_true")
ap.add_argument("--cycle-timeout", type=int, default=900)
ap.add_argument("--build-timeout", type=int, default=180)
args = ap.parse_args()

client = Client(port=args.port, default_timeout=240)
bridge = Bridge(client)
db = DB()
log = EventLog()
started = time.time()


def exec_(method: str, params: dict, timeout: int = 60) -> dict:
    r = bridge.exec(method, params, timeout)
    if not r.get("success"):
        log.record(method, "fail", error=r.get("error"))
        raise SystemExit(f"{method} failed: {r.get('error')}")
    return r


def cmd(command: str, params: dict, timeout: int = 60):
    """Invoke a Tauri command via the generic bridge passthrough."""
    r = exec_("invokeCommand", {"command": command, "params": params}, timeout)
    return r.get("result")


# ---- 1. Preflight --------------------------------------------------------
print("\n[1/5] Preflight")
try:
    h = client.get("/health")
except Exception as e:  # noqa: BLE001
    raise SystemExit(
        "Test-automation server not responding. Launch the app with "
        "`npx tauri dev --features test-automation` first."
    ) from e
log.record("preflight.health", "ok", server=h.get("server"), version=h.get("version"))


# ---- 2. Resolve or build a promoted persona ------------------------------
print("\n[2/5] Resolve persona")


def resolve_persona(name_or_id: str) -> str | None:
    row = db.find_persona_by_name(name_or_id)
    if row:
        return row["id"]
    # maybe it's already an id
    hit = db.scalar("SELECT id FROM personas WHERE id = ?", (name_or_id,))
    return hit


def build_minimal_persona() -> str:
    """Build + promote a minimal persona via the canonical build harness,
    answering whatever the LLM asks with a generic fallback."""
    intent = (
        "Summarize any English text you are given into three concise bullet "
        "points. No external connectors, no schedule, no manual review."
    )
    r = exec_("startBuildFromIntent", {"intent": intent, "timeoutMs": 30_000}, 40)
    persona_id = r.get("personaId")
    log.record("build.start", "ok", persona_id=persona_id)

    # Answer pending questions until the draft is ready (generic fallback).
    fallback = (
        "Keep it simple: take the provided text, produce exactly three short "
        "bullet-point summaries, and return them. No connectors, no trigger, "
        "no review. A manual trigger is fine."
    )
    for _ in range(8):
        ph = exec_("waitForBuildPhase",
                   {"phases": ["awaiting_input", "draft_ready", "test_complete", "promoted"],
                    "timeoutMs": args.build_timeout * 1000}, args.build_timeout + 20)
        phase = ph.get("phase")
        if phase in ("draft_ready", "test_complete", "promoted"):
            break
        q = exec_("listPendingBuildQuestions", {}, 30)
        questions = q.get("questions", [])
        if not questions:
            continue
        answers = {qq["cellKey"]: fallback for qq in questions if qq.get("cellKey")}
        exec_("answerPendingBuildQuestions", {"answers": answers}, 120)

    exec_("promoteBuildDraft", {}, 120)
    log.record("build.promote", "ok", persona_id=persona_id)
    return persona_id


if args.persona:
    persona_id = resolve_persona(args.persona)
    if not persona_id:
        raise SystemExit(f"Persona '{args.persona}' not found (by name or id).")
    log.record("persona.resolve", "ok", persona_id=persona_id)
else:
    persona_id = build_minimal_persona()

print(f"  persona_id = {persona_id}")


# ---- 3. Configure + trigger an evolution cycle ---------------------------
print("\n[3/5] Configure evolution policy + trigger cycle")
# Mechanical strategy = no LLM critique calls; evaluation still spawns CLIs per
# scenario, which is exactly the multi-spawn fan-out the ledger tracks.
cmd("evolution_upsert_policy", {
    "personaId": persona_id,
    "enabled": True,
    "variantsPerCycle": args.variants,
    "mutationRate": 0.3,
    "improvementThreshold": 0.01,
    "mutationStrategy": "mechanical",
}, 60)
log.record("evolution.policy", "ok", variants=args.variants)

cycle = cmd("evolution_trigger_cycle", {"personaId": persona_id}, args.cycle_timeout + 60)
cycle_id = cycle.get("id") if isinstance(cycle, dict) else None
log.record("evolution.trigger", "ok", cycle_id=cycle_id)
print(f"  cycle_id = {cycle_id}")


# ---- 4. Wait for the cycle to finish -------------------------------------
print("\n[4/5] Wait for cycle completion")


def cycle_row():
    cycles = cmd("evolution_list_cycles", {"personaId": persona_id, "limit": 20}, 30) or []
    return next((c for c in cycles if c.get("id") == cycle_id), None)


try:
    final = wait_until(
        lambda: (lambda c: c if c and c.get("status") in ("completed", "failed") else None)(cycle_row()),
        timeout=args.cycle_timeout,
        interval=5,
        message="evolution cycle did not reach a terminal status",
    )
except WaitTimeout as e:
    log.record("cycle.wait", "fail", error=str(e))
    raise SystemExit(str(e))

status = final.get("status")
log.record("cycle.done", "ok", status=status)
print(f"  cycle status = {status}")


# ---- 5. Read + assert the budget ledger state ----------------------------
print("\n[5/5] Assert run-budget ledger")


def read_budget() -> dict | None:
    # Prefer the typed cycle field, else parse summary_json from the DB.
    for key in ("summary", "summaryJson", "summary_json"):
        raw = final.get(key)
        if isinstance(raw, str) and raw.strip():
            try:
                return (json.loads(raw) or {}).get("budget")
            except json.JSONDecodeError:
                pass
        if isinstance(raw, dict):
            return raw.get("budget")
    for col in ("summary_json", "summary"):
        raw = db.scalar(f"SELECT {col} FROM evolution_cycles WHERE id = ?", (cycle_id,))
        if raw:
            try:
                return (json.loads(raw) or {}).get("budget")
            except (json.JSONDecodeError, TypeError):
                pass
    return None


budget = read_budget()
failures = []

# Warn-only must never abort the cycle.
if status != "completed":
    failures.append(f"cycle status is '{status}', expected 'completed' (warn-only must not abort)")

if budget is None:
    failures.append("EvolutionCycleSummary.budget is missing — ledger not wired/recorded")
else:
    print(f"  budget = {json.dumps(budget)}")
    if budget.get("kind") != "evolution":
        failures.append(f"budget.kind = {budget.get('kind')!r}, expected 'evolution'")
    if not (budget.get("spawnCount", 0) > 0):
        failures.append("budget.spawnCount == 0 — ledger recorded no spawns")
    if budget.get("spentUsd", -1) < 0:
        failures.append("budget.spentUsd is negative")
    # exceeded must be consistent with the ceiling.
    ceiling = budget.get("ceilingUsd", 0.0)
    spent = budget.get("spentUsd", 0.0)
    if ceiling > 0 and spent >= ceiling and not budget.get("exceeded"):
        failures.append("spent crossed a non-zero ceiling but exceeded is False")
    if args.expect_exceed and not budget.get("exceeded"):
        failures.append("--expect-exceed set but budget.exceeded is False "
                        "(launch the app with PERSONAS_RUN_BUDGET_EVOLUTION_USD=0.001)")

finished = time.time()
log.record("assert", "fail" if failures else "ok", failures=failures)
log.dump(None, started, finished)

if failures:
    print("\nFAIL:")
    for f in failures:
        print(f"  - {f}")
    raise SystemExit(1)

print("\nPASS: run-budget ledger tracked the evolution cycle's spawns; warn-only "
      "did not abort.")
