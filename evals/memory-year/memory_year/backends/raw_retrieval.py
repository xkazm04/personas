from __future__ import annotations

from pathlib import Path

import numpy as np

from . import Backend, Context, Cost
from ..clock import Clock
from ..embed import Embedder, DEFAULT_EMBEDDER
from ..llm import estimate_tokens
from ..model import Event, Probe
from .full_history import render


class RawRetrieval(Backend):
    """Rung 3: chunk the raw record (one event = one chunk), embed, take the top matches
    within the budget. No extraction, no beliefs, no supersedence. Nearly free at write
    time - the trade the ladder exists to price.
    """

    name = "raw-retrieval"

    def __init__(self, embedder: str = DEFAULT_EMBEDDER, cache_dir: Path | str | None = None, recency_weight: float = 0.0):
        cache_dir = Path(cache_dir) if cache_dir else None
        self.embedder = Embedder(embedder, (cache_dir / "emb.sqlite") if cache_dir else None)
        self.ids: list[str] = []
        self.texts: list[str] = []
        self.days: list[int] = []
        self.vecs: list[np.ndarray] = []
        self.pending: list[int] = []
        self.bytes = 0
        self.recency_weight = recency_weight

    def ingest(self, event: Event, clock: Clock) -> None:
        r = render(event, clock)
        self.ids.append(event.id); self.texts.append(r); self.days.append(clock.day)
        self.pending.append(len(self.texts) - 1)
        self.bytes += len(r.encode())

    def _flush(self):
        if self.pending:
            vecs = self.embedder.embed([self.texts[i] for i in self.pending])
            for i, v in zip(self.pending, vecs):
                while len(self.vecs) <= i:
                    self.vecs.append(None)
                self.vecs[i] = v
            self.pending = []

    def recall(self, probe: Probe, clock: Clock, budget_tokens: int) -> Context:
        self._flush()
        if not self.vecs:
            return Context("", [], 0)
        q = self.embedder.embed([probe.question])[0]
        M = np.vstack(self.vecs)
        scores = M @ q
        if self.recency_weight:
            age = np.array([clock.day - d for d in self.days], dtype=np.float32)
            scores = scores - self.recency_weight * (age / 365.0)
        order = np.argsort(-scores)
        chosen, used = [], 0
        for i in order:
            t = estimate_tokens(self.texts[i])
            if used + t > budget_tokens:
                if used > 0:
                    break
                continue
            chosen.append(int(i)); used += t
            if len(chosen) >= 40:
                break
        chosen.sort(key=lambda i: (self.days[i], i))
        return Context("\n".join(self.texts[i] for i in chosen), [self.ids[i] for i in chosen], used)

    def cost(self) -> Cost:
        return Cost(embeddings=self.embedder.calls, store_bytes=self.bytes + sum(v.nbytes for v in self.vecs if v is not None))

    def describe(self) -> dict:
        return {"name": self.name, "embedder": self.embedder.name, "recency_weight": self.recency_weight}
