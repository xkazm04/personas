"""Data model: facts with lifecycles, events, probes, and the answer record.

Everything is a plain dataclass serialisable to JSON so a scenario is a file and a run
is a directory of files. No backend-specific shapes live here.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class Fact:
    id: str
    scope: str            # "user" or a project slug - the join key coverage is computed over
    key: str              # e.g. "database", "city", "deploy-day"
    value: str
    valid_from: int       # day index
    valid_to: Optional[int] = None   # exclusive; None = still valid at day 365
    supersedes: Optional[str] = None  # fact id this one replaced
    kind: str = "fact"    # fact | preference | procedure | rule | failure-cause

    def valid_at(self, day: int) -> bool:
        return self.valid_from <= day and (self.valid_to is None or day < self.valid_to)


@dataclass
class Event:
    id: str
    day: int
    minute: int
    kind: str             # say | task | teach | noise | outcome
    scope: str
    text: str             # what the user said (or what happened), natural language
    facts: list[str] = field(default_factory=list)   # fact ids introduced/updated by this event
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class Probe:
    id: str
    day: int
    minute: int
    cls: str              # stable | reversal | expired | scope | preference | procedure | rule | failure-cause | adaptation | distractor
    scope: str
    question: str
    gold: str             # the value, or "UNKNOWN", or a multi-step procedure joined by " -> "
    wrong: list[str] = field(default_factory=list)   # values that are specifically wrong (old values)
    form: Optional[str] = None   # for form-judged classes: "no-emoji" | "asks-confirmation" | "applies:<fix>"
    fact_ids: list[str] = field(default_factory=list)
    history_days: int = 0        # days since the newest relevant fact was stated


@dataclass
class Answer:
    probe_id: str
    rung: str
    text: str
    context_tokens: int
    context_items: int
    verdict: str          # correct | wrong | wrong-old | abstained | error | screened
    judge: str            # deterministic | model-strict | model-lenient
    latency_ms: int
    note: str = ""


def to_json(obj: Any) -> Any:
    if isinstance(obj, list):
        return [to_json(o) for o in obj]
    if hasattr(obj, "__dataclass_fields__"):
        return asdict(obj)
    return obj
