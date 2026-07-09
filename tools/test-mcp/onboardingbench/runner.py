r"""onboarding-bench runner — drives PERSONA CREATION through the REAL APP UI.

Why not the `/build/*` HTTP routes? Because those bypass the UI entirely. The
failures that matter for onboarding (a question that renders but can't be
answered, a connector picker that never populates, a draft that never surfaces a
promote affordance) only exist in the UI layer. So every step here goes through
`window.__TEST__` bridge methods that manipulate the same surfaces a user does:

    startBuildFromIntent   -> types `agent-intent-input`, clicks `agent-launch-btn`
    listPendingBuildQuestions / answerPendingBuildQuestions
    promoteBuildDraft      -> the real promote path
    getPersonaDetail       -> the composed persona's metadata

Two UI facts drive the design (verified against src/, not the stale docs):
  * The from-scratch build renders questions in `GlyphAnswerCard`, whose options
    have NO data-testid. So answers are submitted via the bridge, while the
    connector *picker* is asserted through its testid `vault-connector-picker-<category>`
    — that is our proof the user could actually choose.
  * `draft_ready` is the interactive terminal. Interactive builds do NOT
    auto-promote (only one-shot does), so polling for `promoted` reads as a hang.

Nightly / incremental: state lives in `state.json`; `--batch N` runs the next N
pending scenarios and exits. Safe to kill and resume.

Usage:
  python tools/test-mcp/onboardingbench/runner.py --batch 10
  python tools/test-mcp/onboardingbench/runner.py --only-tier vague --batch 5
  python tools/test-mcp/onboardingbench/runner.py --scenario ctl-email-decoy-outlook
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[1]))  # tools/test-mcp

from lib import Client, Bridge, DB  # noqa: E402
from clarifybench.simulator import simulate_answer  # noqa: E402
from onboardingbench.evaluate import evaluate_scenario, judge_bundle  # noqa: E402

REPO = _HERE.parents[3]
SCENARIOS = REPO / "docs" / "tests" / "onboarding-bench" / "scenarios" / "scenarios.json"
RESULTS = REPO / "docs" / "tests" / "onboarding-bench" / "results"

# Interactive builds stop here — see module docstring.
CONVERGED = "draft_ready"
TERMINALS = {"draft_ready", "promoted", "test_complete", "failed", "cancelled"}
NAME_PREFIX = "OB-"          # every persona we create is tagged, for safe teardown
MAX_ROUNDS = 8               # design wants <=2; headroom so we can OBSERVE over-asking
PHASE_SLICE_MS = 20000       # waitForBuildPhase is sliced at 20s server-side


# --------------------------------------------------------------------------
# vault-aware connector resolution
# --------------------------------------------------------------------------
def load_vault_service_types(client: Client) -> set[str]:
    """service_types that actually have a credential on THIS machine."""
    try:
        res = client.get("/list-credentials")
    except Exception:
        return set()
    creds = res.get("credentials") or res.get("data") or []
    out = set()
    for c in creds if isinstance(creds, list) else []:
        st = (c.get("service_type") or c.get("serviceType") or "").strip().lower()
        if st:
            out.add(st)
    return out


def resolve_connector(scenario: dict, vault: set[str]) -> dict:
    """Bind `{{CONNECTOR}}` / `{{DECOY}}` to credentials that exist here.

    Degrades instead of failing: a scenario whose category has no credential can
    still prove the build ASKED (the picker renders `vault-connector-picker-empty`),
    it just can't prove the user could CHOOSE.
    """
    cc = scenario.get("connector_choice")
    if not cc:
        return {"mode": "none", "pick": None, "decoy": None}
    pick = cc.get("preferred_pick")
    decoy = cc.get("decoy")
    have_pick = pick in vault
    have_decoy = decoy in vault
    if have_pick and have_decoy:
        return {"mode": "choice", "pick": pick, "decoy": decoy, "category": cc["category"]}
    if have_pick:
        # Only one credential in the category -> can't prove a *choice* was made.
        return {"mode": "single", "pick": pick, "decoy": None, "category": cc["category"]}
    return {"mode": "degraded_no_credential", "pick": None, "decoy": decoy,
            "category": cc["category"]}


def materialize(text: str, res: dict) -> str:
    return (text or "").replace("{{CONNECTOR}}", (res.get("pick") or "the tool I set up")) \
                       .replace("{{DECOY}}", (res.get("decoy") or "the popular default"))


# --------------------------------------------------------------------------
# run one scenario through the real UI
# --------------------------------------------------------------------------
@dataclass
class QA:
    round: int
    cell_key: str
    question: str
    options: list[str]
    connector_category: str | None
    answer: str
    picker_testid_present: bool | None = None


@dataclass
class RunResult:
    scenario_id: str
    started_at: str
    finished_at: str = ""
    session_id: str | None = None
    persona_id: str | None = None
    terminal_phase: str | None = None
    converged: bool = False
    rounds: int = 0
    questions: int = 0
    connector_question_seen: bool = False
    connector_resolution: dict = field(default_factory=dict)
    transcript: list[dict] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    seconds: float = 0.0
    error: str | None = None
    status: str = "done"  # done | failed | degraded

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _picker_present(client: Client, category: str) -> bool | None:
    """UI proof that the connector picker rendered for this category."""
    for tid in (f"vault-connector-picker-{category}", "vault-connector-picker-empty"):
        try:
            r = client.post("/query", {"selector": f'[data-testid="{tid}"]'})
        except Exception:
            return None
        els = r.get("elements") or r.get("results") or []
        if els:
            return tid.endswith(category)
    return False


def run_scenario(client: Client, bridge: Bridge, db: DB, scenario: dict,
                 vault: set[str], *, timeout_s: int = 900) -> RunResult:
    res = RunResult(scenario_id=scenario["id"], started_at=datetime.now(timezone.utc).isoformat())
    conn = resolve_connector(scenario, vault)
    res.connector_resolution = conn
    true_intent = materialize(scenario["true_intent"], conn)
    t0 = time.monotonic()

    try:
        start = bridge.exec("startBuildFromIntent", {"intent": scenario["vague_intent"]},
                            timeout_secs=120)
        if not start.get("success", True) and not start.get("sessionId"):
            res.status, res.error = "failed", f"startBuildFromIntent: {start}"
            return res
        res.session_id = start.get("sessionId")
        res.persona_id = start.get("personaId")

        deadline = time.monotonic() + timeout_s
        rounds = 0
        while True:
            if time.monotonic() > deadline:
                res.error, res.status = "timeout waiting for terminal phase", "failed"
                break
            ph = bridge.exec("waitForBuildPhase",
                             {"phases": sorted(TERMINALS | {"awaiting_input"}),
                              "timeoutMs": PHASE_SLICE_MS}, timeout_secs=60)
            phase = ph.get("phase")
            if phase == "awaiting_input":
                qs = (bridge.exec("listPendingBuildQuestions", {}, timeout_secs=60)
                      .get("questions") or [])
                if not qs:
                    continue
                rounds += 1
                if rounds > MAX_ROUNDS:
                    res.error, res.status = f"exceeded {MAX_ROUNDS} question rounds", "failed"
                    break
                answers: dict[str, str] = {}
                for q in qs:
                    cell = q.get("cellKey") or q.get("cell_key") or "use-cases"
                    cat = q.get("connectorCategory") or q.get("connector_category")
                    opts = [o if isinstance(o, str) else str(o) for o in (q.get("options") or [])]
                    picker = None
                    if cat:
                        res.connector_question_seen = True
                        picker = _picker_present(client, cat)
                        # Selection in VaultConnectorPicker emits the service_type.
                        ans = conn.get("pick") or (opts[0] if opts else "use a sensible default")
                    else:
                        sim = simulate_answer(true_intent, q.get("question") or "", opts)
                        ans = sim.text if sim.ok else "Use a sensible default and proceed."
                    answers[cell] = ans
                    res.transcript.append(QA(rounds, cell, q.get("question") or "", opts,
                                             cat, ans, picker).__dict__)
                bridge.exec("answerPendingBuildQuestions", {"answers": answers}, timeout_secs=120)
                time.sleep(1.0)
                continue

            if phase in TERMINALS:
                res.terminal_phase = phase
                res.converged = phase in (CONVERGED, "promoted", "test_complete")
                break

        res.rounds = rounds
        res.questions = len(res.transcript)

        # ---- compose metadata from the REAL persona ------------------------
        if res.persona_id and res.converged:
            try:
                bridge.exec("promoteBuildDraft", {}, timeout_secs=180)
            except Exception as e:  # promote may be gated by tool-tests; not fatal
                res.error = f"promote skipped: {e}"
            res.metadata = collect_metadata(bridge, db, res.persona_id)

    except Exception as e:  # noqa: BLE001
        res.status, res.error = "failed", f"{type(e).__name__}: {e}"
    finally:
        res.seconds = round(time.monotonic() - t0, 2)
        res.finished_at = datetime.now(timezone.utc).isoformat()
        # Teardown: never leave benchmark personas behind.
        if res.persona_id:
            try:
                bridge.exec("deletePersona", {"personaId": res.persona_id}, timeout_secs=60)
            except Exception:
                pass
    if conn["mode"] == "degraded_no_credential" and res.status == "done":
        res.status = "degraded"
    return res


def collect_metadata(bridge: Bridge, db: DB, persona_id: str) -> dict:
    """The composed persona, as a user would see it."""
    meta: dict = {}
    try:
        meta["detail"] = bridge.exec("getPersonaDetail", {"personaId": persona_id}, timeout_secs=60)
    except Exception as e:
        meta["detail_error"] = str(e)
    try:
        rows = db.query(
            "SELECT name, description, system_prompt, design_context, model_profile, "
            "icon, color, setup_status FROM personas WHERE id = ? LIMIT 1", (persona_id,))
        if rows:
            r = dict(rows[0])
            dc = r.get("design_context")
            try:
                r["design_context"] = json.loads(dc) if isinstance(dc, str) else dc
            except Exception:
                pass
            meta["row"] = r
    except Exception as e:
        meta["row_error"] = str(e)
    return meta


# --------------------------------------------------------------------------
# nightly bookkeeping
# --------------------------------------------------------------------------
def preflight(client: Client, db: DB, *, require_idle: bool) -> list[str]:
    problems: list[str] = []
    try:
        client.health()
    except Exception as e:
        problems.append(f"bridge /health failed: {e}")
        return problems
    if require_idle:
        try:
            busy = db.query(
                "SELECT id, phase FROM build_sessions "
                "WHERE phase NOT IN ('promoted','failed','cancelled','completed','draft_ready') "
                "AND created_at > datetime('now','-30 minutes')")
            if busy:
                problems.append(f"app is busy: {len(busy)} in-flight build session(s) — "
                                "nightly runs require a quiet app")
        except Exception:
            pass  # DB shape drift shouldn't block the run
    return problems


def main() -> None:
    ap = argparse.ArgumentParser(description="onboarding-bench — real-UI persona creation at scale")
    ap.add_argument("--batch", type=int, default=10, help="run at most N pending scenarios, then exit")
    ap.add_argument("--scenario", action="append", help="run specific scenario id(s)")
    ap.add_argument("--only-tier", action="append", help="specified|partial|vague|extreme")
    ap.add_argument("--only-area", action="append")
    ap.add_argument("--only-kind", action="append", help="recipe|template-multi|control")
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--out", default=str(RESULTS))
    ap.add_argument("--no-idle-check", action="store_true")
    ap.add_argument("--reset-state", action="store_true")
    args = ap.parse_args()

    suite = json.load(open(SCENARIOS, encoding="utf-8"))["scenarios"]
    out = Path(args.out)
    (out / "runs").mkdir(parents=True, exist_ok=True)
    (out / "bundles").mkdir(parents=True, exist_ok=True)
    state_path = out / "state.json"
    state = {} if args.reset_state or not state_path.exists() else json.load(open(state_path, encoding="utf-8"))

    client = Client(port=args.port, default_timeout=max(120, args.timeout))
    db = DB()
    problems = preflight(client, db, require_idle=not args.no_idle_check)
    if problems:
        for p in problems:
            print(f"PREFLIGHT FAIL: {p}")
        raise SystemExit(2)
    bridge = Bridge(client)
    vault = load_vault_service_types(client)
    print(f"vault credentials: {sorted(vault) or '(none)'}")

    def eligible(s: dict) -> bool:
        if args.scenario:
            return s["id"] in args.scenario
        if state.get(s["id"], {}).get("status") in ("done", "degraded"):
            return False
        if args.only_tier and s["vagueness_tier"] not in args.only_tier:
            return False
        if args.only_area and s["business_area"] not in args.only_area:
            return False
        if args.only_kind and s["kind"] not in args.only_kind:
            return False
        return True

    queue = [s for s in suite if eligible(s)][: args.batch]
    print(f"running {len(queue)} scenario(s); {len(suite)} total, "
          f"{sum(1 for s in suite if state.get(s['id'],{}).get('status') in ('done','degraded'))} already done")

    for s in queue:
        print(f"\n=== {s['id']} [{s['vagueness_tier']}/{s['business_area']}] ===", flush=True)
        res = run_scenario(client, bridge, db, s, vault, timeout_s=args.timeout)
        verdict = evaluate_scenario(s, res.as_dict())
        print(f"    -> {res.terminal_phase or res.status} · {res.rounds}r/{res.questions}q "
              f"· {res.seconds}s · gates {verdict['gates_passed']}/{verdict['gates_total']}"
              f"{' · DEGRADED' if res.status=='degraded' else ''}", flush=True)

        (out / "runs" / f"{s['id']}.json").write_text(
            json.dumps({"scenario": s, "run": res.as_dict(), "verdict": verdict}, indent=1, default=str),
            encoding="utf-8")
        (out / "bundles" / f"{s['id']}.md").write_text(
            judge_bundle(s, res.as_dict(), verdict), encoding="utf-8")
        state[s["id"]] = {"status": res.status, "terminal": res.terminal_phase,
                          "gates": f"{verdict['gates_passed']}/{verdict['gates_total']}",
                          "ts": res.finished_at}
        state_path.write_text(json.dumps(state, indent=1), encoding="utf-8")

    done = sum(1 for v in state.values() if v.get("status") in ("done", "degraded"))
    print(f"\nstate: {done}/{len(suite)} scenarios complete -> {state_path}")


if __name__ == "__main__":
    main()
