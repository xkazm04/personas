from __future__ import annotations

from . import Backend, Context, Cost
from ..clock import Clock
from ..llm import estimate_tokens
from ..model import Event, Probe


def render(event: Event, clock: Clock) -> str:
    who = "user" if event.kind in ("say", "task", "teach", "noise") else "system"
    return f"[{clock.at.date().isoformat()}] {who}: {event.text}"


class FullHistory(Backend):
    """Rung 2: every prior event, most recent first, as much as fits the budget.

    This is the rung most often skipped and the one that most often wins. It is the
    incumbent; the pipeline is the challenger.
    """

    name = "full-history"

    def __init__(self):
        self.lines: list[tuple[str, str, int]] = []   # (event id, rendered, tokens)
        self.bytes = 0

    def ingest(self, event: Event, clock: Clock) -> None:
        r = render(event, clock)
        self.lines.append((event.id, r, estimate_tokens(r)))
        self.bytes += len(r.encode())

    def recall(self, probe: Probe, clock: Clock, budget_tokens: int) -> Context:
        chosen, used = [], 0
        for eid, r, t in reversed(self.lines):
            if used + t > budget_tokens:
                break
            chosen.append((eid, r)); used += t
        chosen.reverse()   # chronological inside the window
        return Context(text="\n".join(r for _, r in chosen), items=[e for e, _ in chosen], tokens=used)

    def cost(self) -> Cost:
        return Cost(store_bytes=self.bytes)
