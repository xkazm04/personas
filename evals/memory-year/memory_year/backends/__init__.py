"""Memory backends: the rungs of the ladder and the adapters over designs under test."""
from __future__ import annotations

from dataclasses import dataclass, field

from ..clock import Clock
from ..model import Event, Probe


@dataclass
class Context:
    text: str
    items: list[str] = field(default_factory=list)   # item ids the backend chose (event ids, memory ids)
    tokens: int = 0


@dataclass
class Cost:
    model_calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    embeddings: int = 0
    store_bytes: int = 0
    write_ms: int = 0

    def as_dict(self):
        return self.__dict__.copy()


class Backend:
    """The four-call contract. `recall` is a probe read: no usage feedback may result."""

    name = "base"

    def ingest(self, event: Event, clock: Clock) -> None:
        raise NotImplementedError

    def consolidate(self, clock: Clock) -> None:
        return None

    def recall(self, probe: Probe, clock: Clock, budget_tokens: int) -> Context:
        raise NotImplementedError

    def cost(self) -> Cost:
        return Cost()

    def answers_itself(self) -> bool:
        """True for a rung where the design under test produces the reply itself (its own
        prompt assembler and model call), so the harness's consumer is bypassed. Such a
        rung is reported beside the ladder, never as a rung of it: its consumer differs."""
        return False

    def answer(self, probe: Probe, clock: Clock) -> Context:
        raise NotImplementedError

    def describe(self) -> dict:
        return {"name": self.name}

    def close(self) -> None:
        return None


def make(name: str, **kw) -> Backend:
    if name == "none":
        from .none import NoMemory
        return NoMemory()
    if name == "full-history":
        from .full_history import FullHistory
        return FullHistory()
    if name == "raw-retrieval":
        from .raw_retrieval import RawRetrieval
        return RawRetrieval(**kw)
    if name == "compiled-truth":
        from .compiled_truth import CompiledTruth
        return CompiledTruth(**kw)
    if name == "hybrid-verbatim":
        from .hybrid_verbatim import HybridVerbatim
        return HybridVerbatim(**kw)
    if name == "athena":
        from .athena import Athena
        return Athena(**kw)
    if name == "athena-turn":
        from .athena import AthenaTurn
        return AthenaTurn(**kw)
    if name == "write-verdict":
        from .write_verdict import WriteVerdict
        return WriteVerdict(**kw)
    raise SystemExit(f"unknown backend {name}")


def accepted(name: str, kw: dict) -> dict:
    """Filter `kw` down to what this backend's constructor actually takes.

    The caller offers shared resources (a cache directory today) to every arm; an arm
    that has no use for one must not have to declare it. Asking the constructor is the
    only way that stays true as arms are added.
    """
    import inspect

    cls = _class_for(name)
    if cls is None:
        return {}
    try:
        params = inspect.signature(cls.__init__).parameters
    except (TypeError, ValueError):
        return {}
    return {k: v for k, v in kw.items() if k in params}


def _class_for(name: str):
    if name == "raw-retrieval":
        from .raw_retrieval import RawRetrieval
        return RawRetrieval
    if name == "hybrid-verbatim":
        from .hybrid_verbatim import HybridVerbatim
        return HybridVerbatim
    if name == "write-verdict":
        from .write_verdict import WriteVerdict
        return WriteVerdict
    if name == "compiled-truth":
        from .compiled_truth import CompiledTruth
        return CompiledTruth
    return None
