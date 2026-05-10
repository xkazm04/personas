"""Deadline-based polling helper.

Replaces the per-script `for attempt in range(N): time.sleep(K); ...`
pattern. Callers express what they're waiting for (a predicate),
how long they'll wait (timeout), and how often to poll (interval) —
the helper raises a structured TimeoutError on expiry.
"""
from __future__ import annotations

import time
from typing import Callable, TypeVar

T = TypeVar("T")


class WaitTimeout(TimeoutError):
    """Raised when wait_until's predicate never becomes truthy in time."""

    def __init__(self, message: str, last_value: object = None) -> None:
        super().__init__(message)
        self.last_value = last_value


def wait_until(
    predicate: Callable[[], T],
    timeout: float = 180.0,
    interval: float = 3.0,
    message: str | None = None,
) -> T:
    """Call `predicate()` every `interval` seconds until it returns truthy.

    Returns the truthy value. Raises WaitTimeout if `timeout` elapses with
    only falsy returns. The last falsy value is attached as `last_value`
    on the exception so callers can debug what was almost-but-not-quite.
    """
    deadline = time.time() + timeout
    last: object = None
    while time.time() < deadline:
        last = predicate()
        if last:
            return last  # type: ignore[return-value]
        time.sleep(interval)
    raise WaitTimeout(
        message or f"Predicate did not return truthy within {timeout}s",
        last_value=last,
    )
