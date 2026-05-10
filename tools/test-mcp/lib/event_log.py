"""Append-only step log used by e2e scripts.

Mirrors the inline `record()` function found in 30+ scripts — same
ASCII-only output format (`[OK]`, `[..]`, `[XX]` markers) so existing
parse tools keep working, but with a single shared implementation.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any


_MARKERS = {"ok": "[OK]", "info": "[..]"}


class EventLog:
    """Collects step records as a list of dicts, with stdout mirror."""

    def __init__(self, *, mirror_stdout: bool = True) -> None:
        self.entries: list[dict[str, Any]] = []
        self.mirror = mirror_stdout

    def record(self, step: str, outcome: str, **kw: Any) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "step": step,
            "outcome": outcome,
        }
        entry.update(kw)
        self.entries.append(entry)
        if self.mirror:
            self._print(step, outcome, kw)
        return entry

    def _print(self, step: str, outcome: str, kw: dict[str, Any]) -> None:
        marker = _MARKERS.get(outcome, "[XX]")
        sys.stdout.write(f"  {marker} {step}: {outcome}")
        brief = {
            k: v
            for k, v in kw.items()
            if k != "detail" and not isinstance(v, (dict, list))
        }
        if brief:
            sys.stdout.write(f"  {brief}")
        sys.stdout.write("\n")
        sys.stdout.flush()

    def summary(self, started: datetime, finished: datetime) -> dict[str, Any]:
        """Return the canonical run-summary dict scripts emit at the end."""
        return {
            "started": started.isoformat(),
            "finished": finished.isoformat(),
            "duration_s": (finished - started).total_seconds(),
            "log": self.entries,
        }

    def dump(self, path: str | None = None, *, started: datetime, finished: datetime) -> None:
        """Write the summary to `path`, or stdout if None."""
        s = self.summary(started, finished)
        body = json.dumps(s, indent=2)
        if path:
            from pathlib import Path

            Path(path).write_text(body)
            print(f"\nWrote {path}")
        else:
            print("\n── summary ──")
            print(body)
