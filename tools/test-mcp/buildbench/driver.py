"""Drive one headless one-shot build and stamp its phase timeline.

The driver is deliberately dumb about *what* the build produces — it only owns
"start it, watch it, time it". Structural capture lives in ``capture.py`` and
correctness/quality in ``quality.py``.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from lib import Client


# BuildPhase string values (src-tauri/src/db/models/build_session.rs:26-40).
TERMINAL_PHASES = {"promoted", "completed", "failed", "cancelled"}
SUCCESS_PHASE = "promoted"

# Auto-answer: a one-shot build occasionally parks in `awaiting_input` (a gate
# the LLM couldn't resolve autonomously — often a connector-credential choice).
# The benchmark measures build TIME, not interaction, so we answer with a
# sensible default to keep the build flowing. Bounded per cell so a question the
# answer can't resolve doesn't loop forever.
MAX_ANSWERS_PER_CELL = 3
DEFAULT_ANSWER = (
    "Use sensible defaults and whatever matching vault credential is available. "
    "Do not ask further clarifying questions — proceed with a reasonable choice."
)


@dataclass
class BuildRun:
    """One build's timing + terminal outcome (structure is captured separately)."""

    fixture_id: str
    variant: str
    session_id: str | None
    persona_id: str | None
    ok: bool                                   # reached "promoted"
    terminal_phase: str | None
    error_message: str | None
    total_seconds: float
    # first-seen wall-clock offset (s from start) for each distinct phase, in order
    phase_timeline: list[dict] = field(default_factory=list)
    # precise fields, present only once Phase 0 telemetry lands (else None)
    cost_usd: float | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    num_turns: int | None = None
    phase_timings: dict | None = None          # from build_sessions.phase_timings_json
    questions_answered: int = 0                 # clarifying questions the driver auto-answered
    stuck_question: str | None = None           # cell_key we couldn't resolve (bailed)
    started_at: str = ""
    finished_at: str = ""

    def per_phase_seconds(self) -> dict[str, float]:
        """Coarse per-phase durations derived from the polled timeline.

        Duration of phase N = (first-seen of phase N+1) - (first-seen of phase N);
        the last phase runs to total_seconds.
        """
        out: dict[str, float] = {}
        tl = self.phase_timeline
        for i, entry in enumerate(tl):
            start = entry["offset_s"]
            end = tl[i + 1]["offset_s"] if i + 1 < len(tl) else self.total_seconds
            out[entry["phase"]] = round(end - start, 2)
        return out


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_one_build(
    client: Client,
    fixture_id: str,
    intent: str,
    variant: str,
    *,
    persona_id: str | None = None,
    mode: str = "one_shot",
    poll_interval: float = 1.5,
    timeout_s: int = 900,
    answers: dict | None = None,
    default_answer: str | None = None,
) -> BuildRun:
    """Start a build, poll to terminal, return timing + outcome.

    ``variant`` is sent as the ``orchestration`` body field (ignored by the
    engine until Phase 2). ``persona_id`` may be omitted once Phase 0's
    auto-create is in place; before that, pass an existing draft persona id.
    """
    body = {"intent": intent, "mode": mode, "orchestration": variant}
    if persona_id:
        body["persona_id"] = persona_id
    else:
        # Phase 0 auto-create contract: empty persona_id => engine mints a draft
        # shell and returns its id. Pre-Phase-0 engines reject this — surfaced below.
        body["persona_id"] = ""

    t0 = time.monotonic()
    started_at = _now_iso()
    start = client.post("/build/start", body)
    if not start.get("success"):
        raise SystemExit(
            f"/build/start failed for variant '{variant}': {start.get('error') or start}. "
            "If the error is about a missing/empty persona_id, Phase 0 auto-create "
            "is not in this build yet — pass --persona-id <existing draft persona>."
        )
    session_id = start.get("sessionId")
    started_persona = start.get("personaId") or persona_id

    answer_map = answers or {}
    fallback_answer = default_answer or DEFAULT_ANSWER
    answered: dict[str, int] = {}
    questions_answered = 0
    stuck_question: str | None = None

    seen: list[str] = []
    timeline: list[dict] = []
    last: dict = {}
    deadline = time.monotonic() + timeout_s

    while True:
        status = client.post("/build/status", {"session_id": session_id})
        last = status
        phase = status.get("phase")
        if phase and (not seen or seen[-1] != phase):
            seen.append(phase)
            timeline.append({"phase": phase, "offset_s": round(time.monotonic() - t0, 2)})

        # Auto-answer a parked clarifying question so the build keeps flowing.
        if phase == "awaiting_input" and not status.get("isTerminal"):
            pq = status.get("pendingQuestion") or {}
            cell = pq.get("cell_key") or pq.get("cellKey")
            if cell:
                n = answered.get(cell, 0)
                if n >= MAX_ANSWERS_PER_CELL:
                    # The answer isn't resolving this gate — stop re-asking.
                    stuck_question = cell
                    timeline.append({"phase": f"__stuck:{cell}__", "offset_s": round(time.monotonic() - t0, 2)})
                    break
                ans = answer_map.get(cell) or fallback_answer
                client.post("/build/answer", {"session_id": session_id, "cell_key": cell, "answer": ans})
                answered[cell] = n + 1
                questions_answered += 1
                time.sleep(0.6)  # let the runner ingest the answer before re-polling
                continue

        if status.get("isTerminal") or (phase in TERMINAL_PHASES):
            break
        if time.monotonic() > deadline:
            timeline.append({"phase": "__timeout__", "offset_s": round(time.monotonic() - t0, 2)})
            break
        time.sleep(poll_interval)

    total = round(time.monotonic() - t0, 2)
    terminal_phase = last.get("phase")
    persona_id_final = last.get("personaId") or started_persona

    run = BuildRun(
        fixture_id=fixture_id,
        variant=variant,
        session_id=session_id,
        persona_id=persona_id_final,
        ok=(terminal_phase == SUCCESS_PHASE),
        terminal_phase=terminal_phase,
        error_message=last.get("errorMessage"),
        total_seconds=total,
        phase_timeline=timeline,
        questions_answered=questions_answered,
        stuck_question=stuck_question,
        started_at=started_at,
        finished_at=_now_iso(),
    )

    # Phase 0 telemetry (present only when the engine has been instrumented).
    run.cost_usd = last.get("costUsd")
    run.input_tokens = last.get("inputTokens")
    run.output_tokens = last.get("outputTokens")
    run.num_turns = last.get("numTurns")
    pt = last.get("phaseTimings")
    if isinstance(pt, (dict, list)):
        run.phase_timings = pt
    return run
