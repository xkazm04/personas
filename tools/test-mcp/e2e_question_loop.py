r"""
Question-by-question verification runner.

Purpose: drive a build-from-scratch through its full Q&A loop, asserting at
each boundary that (a) the question renders with the expected testid and
(b) the right answering affordance appears (options list, vault-connector
picker, or freetext). Stops as soon as a rendering expectation fails so
the developer can see the exact first breakage.

Unlike e2e_build_from_scratch.py this runner:
  - Gives deterministic free-text answers chosen per cellKey.
  - Actually POSTs each answer via the bridge's answerPendingBuildQuestions
    (which now re-fetches the store snapshot post-collect).
  - After every turn, queries the DOM for
    `[data-testid="glyph-question-<cellKey>"]` and (when applicable)
    `[data-testid^="vault-connector-picker-"]`.
  - Fails loudly with a one-line summary if any expected testid is missing.

Usage:
  uvx --with httpx python tools/test-mcp/e2e_question_loop.py \
      [--intent "..."] \
      [--max-rounds 12] \
      [--report /tmp/run.json]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=17320)
parser.add_argument(
    "--intent",
    default="I want an agent that helps me process incoming documents",
    help="Start ambiguous so the LLM must ask.",
)
parser.add_argument("--max-rounds", type=int, default=12)
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()

BASE = f"http://127.0.0.1:{args.port}"
client = httpx.Client(base_url=BASE, timeout=120)


def bridge(method: str, params: dict | None = None, timeout_secs: int = 30) -> dict:
    r = client.post(
        "/bridge-exec",
        json={"method": method, "params": params or {}, "timeout_secs": timeout_secs},
        timeout=timeout_secs + 10,
    )
    try:
        return json.loads(r.text)
    except json.JSONDecodeError:
        return {"_raw": r.text, "_status": r.status_code}


def query(selector: str) -> list[dict]:
    r = client.post("/query", json={"selector": selector}, timeout=10)
    try:
        arr = json.loads(r.text)
        if isinstance(arr, list):
            return arr
    except Exception:
        pass
    return []


def get_state() -> dict:
    r = client.get("/state", timeout=10)
    try:
        return json.loads(r.text)
    except Exception:
        return {}


log: list[dict] = []


def record(step: str, outcome: str, **kw) -> None:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "step": step, "outcome": outcome}
    entry.update(kw)
    log.append(entry)
    marker = "[OK]" if outcome == "ok" else ("[..]" if outcome == "info" else "[XX]")
    sys.stdout.write(f"  {marker} {step}: {outcome}  {json.dumps({k: v for k, v in kw.items() if not isinstance(v, (dict, list))})}\n")
    sys.stdout.flush()


ANSWERS_BY_KEY = {
    "behavior_core": "Real-time event-driven processor. Automatically analyze each English document as it arrives in the built-in local drive and save the Czech translation alongside the original.",
    "connectors": "local_drive",
    "triggers": "Event-driven: subscribe to drive.document.added from the built-in local_drive connector. No schedule, no polling.",
    "events": "drive.document.added on local_drive source.",
    "human-review": "No review. Translation is reversible; user can discard the output file.",
    "messages": "Save the Czech translation next to the source file using a _cs suffix before the extension. Also surface a built-in status message.",
    "memory": "No memory. Each translation is independent.",
    "error-handling": "Log the error and surface a built-in message. Do not retry more than twice.",
    "use-cases": "Single capability: Translate Incoming Document from English to Czech.",
}
FALLBACK_ANSWER = "Please proceed with the most sensible default for this dimension given the translation scenario."


def preflight() -> None:
    print("[0] preflight")
    r = client.get("/health", timeout=5)
    try:
        h = json.loads(r.text)
    except Exception:
        record("preflight", "fail", error=r.text)
        raise SystemExit("preflight")
    record("preflight", "ok", server=h.get("server"), version=h.get("version"))


def start_build() -> dict:
    print("\n[1] startBuildFromIntent")
    r = bridge("startBuildFromIntent", {"intent": args.intent, "timeoutMs": 25000}, 30)
    if not r.get("success"):
        record("start_build", "fail", error=r.get("error"))
        raise SystemExit("start_build")
    record("start_build", "ok", session_id=r.get("sessionId"), persona_id=r.get("personaId"))
    return r


def wait_for_question_or_terminal(prev_session_phase: str = "") -> dict:
    """Slice-poll waitForBuildPhase until awaiting_input / draft_ready / test_complete / failed."""
    deadline = time.time() + 240
    targets = ["awaiting_input", "draft_ready", "test_complete", "promoted", "failed"]
    while time.time() < deadline:
        r = bridge(
            "waitForBuildPhase",
            {"phases": targets, "timeoutMs": 20_000},
            25,
        )
        if r.get("success"):
            return r
        if not r.get("timedOut"):
            return r
    return {"success": False, "error": "wait_for_question_or_terminal exceeded 240s"}


def inspect_question_dom(cell_key: str, connector_category: str | None) -> None:
    """Hard-assert the inline panel rendered the expected elements for this question.
    A missing testid means the UI didn't render the question — failure, stop."""
    panels = query('[data-testid="build-inline-questions"]')
    if len(panels) == 0 or not panels[0].get("visible"):
        record(f"dom.panel.{cell_key}", "fail", note="build-inline-questions is not visible")
        raise SystemExit("inline panel missing")
    record(f"dom.panel.{cell_key}", "ok", count=len(panels))

    card = query(f'[data-testid="glyph-question-{cell_key}"]')
    if len(card) == 0 or not card[0].get("visible"):
        record(f"dom.card.{cell_key}", "fail", note=f"glyph-question-{cell_key} not visible")
        raise SystemExit(f"card testid missing for {cell_key}")
    record(f"dom.card.{cell_key}", "ok")

    if connector_category:
        picker = query(f'[data-testid="vault-connector-picker-{connector_category}"]')
        empty = query('[data-testid="vault-connector-picker-empty"]')
        if len(picker) == 0 and len(empty) == 0:
            record(
                f"dom.vault.{cell_key}",
                "fail",
                note=f"expected vault-connector-picker-{connector_category} or vault-connector-picker-empty",
            )
            raise SystemExit("vault picker missing")
        record(
            f"dom.vault.{cell_key}",
            "ok",
            picker=len(picker),
            empty=len(empty),
        )


def submit_answer_for(q: dict) -> dict:
    cell = q.get("cellKey") or q.get("cell_key") or ""
    ans = ANSWERS_BY_KEY.get(cell, FALLBACK_ANSWER)
    r = bridge(
        "answerPendingBuildQuestions",
        {"answers": {cell: ans}},
        30,
    )
    return r


def main() -> None:
    started = datetime.now(timezone.utc)
    try:
        preflight()
        start_build()
        seen_cells: set[str] = set()
        for round_ix in range(args.max_rounds):
            print(f"\n[round {round_ix}] wait for pending or terminal")
            wait_r = wait_for_question_or_terminal()
            phase = wait_r.get("phase")
            record(
                f"round{round_ix}.wait",
                "ok" if wait_r.get("success") else "info",
                phase=phase,
                pending=wait_r.get("pendingCount"),
            )
            if phase in ("draft_ready", "test_complete", "promoted"):
                record("loop.done", "ok", final_phase=phase)
                break
            if phase == "failed":
                record("loop.fail", "fail", error=wait_r.get("error"))
                break
            if phase != "awaiting_input":
                record(f"round{round_ix}.wait", "info", note=f"unexpected phase {phase}, retrying")
                time.sleep(1)
                continue

            qs_r = bridge("listPendingBuildQuestions", {}, 15)
            qs = qs_r.get("questions") or []
            if not qs:
                time.sleep(1)
                continue

            q = qs[0]
            cell = q.get("cellKey") or q.get("cell_key") or ""
            cat = q.get("connectorCategory")
            record(
                f"round{round_ix}.question",
                "ok",
                cell=cell,
                category=cat,
                text=(q.get("question") or "")[:120],
                options=len(q.get("options") or []),
            )

            if cell in seen_cells:
                record(
                    f"round{round_ix}.loop",
                    "fail",
                    error=f"same cellKey {cell} re-asked — answer not accepted last turn",
                )
                break
            seen_cells.add(cell)

            try:
                inspect_question_dom(cell, cat)
            except SystemExit as e:
                record("dom.assert", "fail", error=str(e))
                break

            ans_r = submit_answer_for(q)
            if not ans_r.get("success"):
                record(f"round{round_ix}.submit", "fail", error=ans_r.get("error"))
                break
            record(f"round{round_ix}.submit", "ok", answered=ans_r.get("answered"))
    except SystemExit as e:
        record("scenario.abort", "fail", error=str(e))
    finally:
        finished = datetime.now(timezone.utc)
        out = {
            "started": started.isoformat(),
            "finished": finished.isoformat(),
            "duration_s": (finished - started).total_seconds(),
            "log": log,
        }
        if args.report:
            Path(args.report).write_text(json.dumps(out, indent=2))
            print(f"\nWrote {args.report}")


if __name__ == "__main__":
    main()
