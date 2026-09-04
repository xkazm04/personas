"""Judge calibration: plant cases whose verdict is known, and count what the judge returns.

`clock_purity` protects the part of the system that decides what the agent knows.
This protects the part that decides whether the agent was RIGHT. Every rung score in
this harness is the judge's opinion, so a judge whose own error rate has never been
measured publishes a ladder whose rungs carry an unmeasured predicate - and the
hardening already done to it (article stripping, the deterministic fix-phrase check)
was done by inspection, which is how a judge becomes "trusted" without ever being
shown a case it should fail.

The check is deliberately dependency-free and model-free: it exercises the
deterministic predicates only, so it runs in CI, offline, in under a second. The
model judge's own calibration needs planted cases too, but it needs a key.

    py -m memory_year.checks.judge_calibration

Exit 0 = every planted case graded as constructed. Exit 1 = the judge is miscalibrated
and the report names each case.
"""
from __future__ import annotations

import sys

from ..judge import contains_value, is_abstention

# (answer, gold value, what a correct judge MUST return)
CONTAINS: list[tuple[str, str, bool]] = [
    # the answer really does state the value
    ("We run Postgres 16 in production.", "Postgres 16", True),
    ("The database is postgres 16.", "Postgres 16", True),
    ("It's the Redis cache.", "the Redis cache", True),
    ("Deployed on Kubernetes.", "Kubernetes", True),
    # the answer does NOT state the value - these are the probes the suite exists for
    ("We run Postgres 14 in production.", "Postgres 16", False),      # superseded value
    ("We migrated off Postgres years ago.", "Postgres 16", False),    # expired
    ("There is no database at all.", "Postgres 16", False),           # absent
    ("We considered Kubernetes but chose Nomad.", "Kubernetes", False),  # distractor
    ("Redis was removed in the last refactor.", "Redis 7", False),    # expired
]

ABSTAIN: list[tuple[str, bool]] = [
    ("unknown", True),
    ("Unknown - it is not recorded.", True),
    ("I don't know.", True),
    ("I do not know", True),
    ("It is Postgres 16.", False),
    ("The unknown soldier was buried in 1921.", False),  # 'unknown' not at the head
]


def main() -> int:
    # Assert the harness before trusting its verdict: a suite with no negative cases
    # cannot detect over-matching, which is the failure this check exists for.
    if not any(expected is False for _, _, expected in CONTAINS):
        print("harness has no negative cases - it cannot detect over-matching", file=sys.stderr)
        return 2

    misgraded: list[str] = []

    for answer, gold, expected in CONTAINS:
        got = contains_value(answer, gold)
        if got != expected:
            kind = "false positive" if got else "false negative"
            misgraded.append(
                f"contains_value  {kind}: gold={gold!r} answer={answer!r} "
                f"(want {expected}, got {got})"
            )

    for text, expected in ABSTAIN:
        got = bool(is_abstention(text))
        if got != expected:
            kind = "false positive" if got else "false negative"
            misgraded.append(
                f"is_abstention   {kind}: text={text!r} (want {expected}, got {got})"
            )

    total = len(CONTAINS) + len(ABSTAIN)
    print(f"judge calibration: {total - len(misgraded)}/{total} planted cases graded as constructed")
    for line in misgraded:
        print(f"  {line}")

    if misgraded:
        print()
        print(
            "A false positive here marks a wrong answer correct, which inflates every\n"
            "rung that uses it. Fix the predicate or narrow the gold value; do not\n"
            "delete the case."
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
