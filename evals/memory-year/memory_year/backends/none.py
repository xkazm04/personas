from __future__ import annotations

from . import Backend, Context, Cost
from ..clock import Clock
from ..model import Event, Probe


class NoMemory(Backend):
    """Rung 1: the consumer answers from the question alone."""

    name = "none"

    def ingest(self, event: Event, clock: Clock) -> None:
        return None

    def recall(self, probe: Probe, clock: Clock, budget_tokens: int) -> Context:
        return Context(text="", items=[], tokens=0)

    def cost(self) -> Cost:
        return Cost()
