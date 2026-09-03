"""The injected clock.

Every instant the harness hands to a backend comes from here. A backend that reads the
wall clock cannot be asserted against a fixed expected number, which is why the
memory-value-model technique makes the score a pure derivation of a supplied instant.
The harness's clock test (`memory_year.checks.clock_purity`) replays the same scenario at
two different base dates and fails a backend whose recall differs.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

EPOCH = datetime(2025, 1, 6, 9, 0, tzinfo=timezone.utc)  # a Monday, 09:00 UTC


@dataclass(frozen=True)
class Clock:
    """A simulated instant: day index within the year plus a minute offset."""

    day: int
    minute: int = 0
    base: datetime = EPOCH

    @property
    def at(self) -> datetime:
        return self.base + timedelta(days=self.day, minutes=self.minute)

    @property
    def iso(self) -> str:
        return self.at.isoformat()

    @property
    def unix(self) -> int:
        return int(self.at.timestamp())

    def plus_minutes(self, m: int) -> "Clock":
        return Clock(self.day, self.minute + m, self.base)

    def weekday(self) -> int:
        return self.at.weekday()
