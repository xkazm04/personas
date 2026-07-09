"""Drive one INTERACTIVE build and let a simulated user answer its clarifying
questions, recording the full Q&A transcript.

Unlike build-bench's driver (headless one-shot, junk auto-answers), this runs
`mode="interactive"` so the build's ASK-DON'T-ASSUME machinery (session_prompt
Rule 16 + the gates.rs state machine) actually engages, then answers each
question as the hidden-intent user. What we measure is whether it asked the
RIGHT questions and converged — not just build time.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from lib import Client

from .simulator import simulate_answer

# In INTERACTIVE mode the build stops at `draft_ready` — the persona is fully
# resolved and it waits for the user to test/promote in the UI (no headless
# auto-promote like one_shot). So draft_ready IS the convergence terminal for
# clarify-bench; treating only `promoted` as terminal made every interactive run
# poll to timeout and falsely read as HUNG.
TERMINAL_PHASES = {"draft_ready", "promoted", "completed", "failed", "cancelled"}
SUCCESS_PHASES = {"draft_ready", "promoted", "completed"}

# A correct build asks ≤1 mission round + ≤1 Phase-C round (session_prompt Rule 25:
# "3+ question rounds destabilizes IR generation and frequently HANGS the build").
# We allow headroom so we can OBSERVE over-asking rather than cut it off early.
MAX_ROUNDS = 6
MAX_QUESTIONS = 16


def _first(d: dict, *keys, default=None):
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default


def _extract_questions(pending) -> list[dict]:
    """Normalise a /build/status pendingQuestion into a list of
    {cell_key, question, options}. Tolerant of snake/camel case and of a single
    object, an array, or a {questions:[...]} batch wrapper."""
    if pending is None:
        return []
    if isinstance(pending, dict) and isinstance(pending.get("questions"), list):
        items = pending["questions"]
    elif isinstance(pending, list):
        items = pending
    else:
        items = [pending]
    out: list[dict] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        cell = _first(it, "cell_key", "cellKey", default="")
        q = _first(it, "question", "prompt", "text", default="")
        opts_raw = _first(it, "options", default=[]) or []
        opts = []
        for o in opts_raw:
            if isinstance(o, str):
                opts.append(o)
            elif isinstance(o, dict):
                opts.append(_first(o, "label", "value", "text", default=str(o)))
        cat = _first(it, "connector_category", "connectorCategory")
        out.append({"cell_key": cell, "question": q, "options": opts, "connector_category": cat})
    return out


@dataclass
class QAExchange:
    round: int
    cell_key: str
    question: str
    options: list[str]
    connector_category: str | None
    answer: str
    sim_ok: bool
    sim_error: str | None = None


@dataclass
class ClarifyRun:
    fixture_id: str
    variant: str
    session_id: str | None
    persona_id: str | None
    true_intent: str
    vague_intent: str
    terminal_phase: str | None
    ok: bool
    total_seconds: float
    num_rounds: int
    num_questions: int
    transcript: list[QAExchange] = field(default_factory=list)
    phase_timeline: list[dict] = field(default_factory=list)
    error_message: str | None = None
    hung: bool = False  # never reached terminal within the round/time budget
    # Why it didn't converge — "timeout" (ran out of wall-clock mid-flight, usually
    # because serial question rounds ate the budget) vs "round_cap" (kept asking
    # past MAX_ROUNDS). Distinguishing these matters: a timeout is a SPEED failure,
    # a round_cap is an over-asking failure.
    stall_reason: str | None = None

    def as_dict(self) -> dict:
        d = self.__dict__.copy()
        d["transcript"] = [q.__dict__ for q in self.transcript]
        return d


def run_clarify_build(
    client: Client,
    fixture: dict,
    variant: str = "sequential",
    *,
    poll_interval: float = 1.5,
    timeout_s: int = 900,
) -> ClarifyRun:
    vague = fixture["vague_intent"]
    true_intent = fixture["true_intent"]
    body = {"intent": vague, "mode": "interactive", "orchestration": variant, "persona_id": ""}

    t0 = time.monotonic()
    start = client.post("/build/start", body)
    if not start.get("success"):
        raise SystemExit(f"/build/start failed ({variant}): {start.get('error') or start}")
    session_id = start.get("sessionId")
    persona_id = start.get("personaId")

    seen: list[str] = []
    timeline: list[dict] = []
    transcript: list[QAExchange] = []
    answered_cells: dict[str, int] = {}
    rounds = 0
    last: dict = {}
    deadline = time.monotonic() + timeout_s
    hung = False

    stall_reason: str | None = None
    while True:
        status = client.post("/build/status", {"session_id": session_id})
        last = status
        phase = status.get("phase")
        if phase and (not seen or seen[-1] != phase):
            seen.append(phase)
            timeline.append({"phase": phase, "offset_s": round(time.monotonic() - t0, 2)})

        # Deadline is checked on EVERY path (the answer path used to `continue`
        # past it, so a mid-flight timeout was mislabelled as a hang).
        if time.monotonic() > deadline:
            timeline.append({"phase": "__timeout__", "offset_s": round(time.monotonic() - t0, 2)})
            hung, stall_reason = True, "timeout"
            break

        if phase == "awaiting_input" and not status.get("isTerminal"):
            questions = _extract_questions(status.get("pendingQuestion"))
            if not questions:
                # Parked with no readable question — nudge and re-poll.
                time.sleep(poll_interval)
                continue
            rounds += 1
            if rounds > MAX_ROUNDS or len(transcript) >= MAX_QUESTIONS:
                hung, stall_reason = True, "round_cap"
                timeline.append({"phase": "__round_cap_exceeded__", "offset_s": round(time.monotonic() - t0, 2)})
                break
            for q in questions:
                cell = q["cell_key"] or "answer"
                # Guard against an unresolvable gate looping forever.
                if answered_cells.get(cell, 0) >= 3:
                    continue
                sim = simulate_answer(true_intent, q["question"], q["options"])
                ans = sim.text if sim.ok else "Use a sensible default and proceed."
                client.post(
                    "/build/answer",
                    {"session_id": session_id, "cell_key": cell, "answer": ans},
                )
                answered_cells[cell] = answered_cells.get(cell, 0) + 1
                transcript.append(
                    QAExchange(
                        round=rounds,
                        cell_key=cell,
                        question=q["question"],
                        options=q["options"],
                        connector_category=q["connector_category"],
                        answer=ans,
                        sim_ok=sim.ok,
                        sim_error=sim.error,
                    )
                )
            time.sleep(0.8)  # let the runner ingest the answers before re-polling
            continue

        if status.get("isTerminal") or (phase in TERMINAL_PHASES):
            break
        time.sleep(poll_interval)

    total = round(time.monotonic() - t0, 2)
    terminal_phase = last.get("phase")
    return ClarifyRun(
        fixture_id=fixture["id"],
        variant=variant,
        session_id=session_id,
        persona_id=last.get("personaId") or persona_id,
        true_intent=true_intent,
        vague_intent=vague,
        terminal_phase=terminal_phase,
        ok=(terminal_phase in SUCCESS_PHASES),
        total_seconds=total,
        num_rounds=rounds,
        num_questions=len(transcript),
        transcript=transcript,
        phase_timeline=timeline,
        error_message=last.get("errorMessage"),
        hung=hung,
        stall_reason=stall_reason,
    )
