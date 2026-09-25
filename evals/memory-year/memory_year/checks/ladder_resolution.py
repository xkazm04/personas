"""Ladder resolution: may one arm be called the leader over another, on these 194 probes?

The ladder in FINDINGS.md bolds a new leader whenever an arm's accuracy is higher. Every
rung shares the probe set, so two arms can be compared probe by probe, and only the
DISCORDANT probes (one arm right, the other wrong) carry information about which is better.
A gap of two points is four probes; if forty probes disagree in both directions, four net is
noise. This check pairs the runs, counts the discordant probes each way, and applies an
exact two-sided sign test. A pair that does not clear `ALPHA` is a tie, and a tie at the top
of the ladder is not a leader.

It is dependency-free and model-free: it reads `answers.json` and nothing else.

    py -m memory_year.checks.ladder_resolution                 # the published ladder's top
    py -m memory_year.checks.ladder_resolution RUN_A RUN_B     # any two run directories

The instrument asserts itself before it reports: a run against itself must tie, and the
no-memory rung against full history must resolve. Exit 0 = report printed. Exit 1 = a
control failed, so the report would not mean anything.

Limit: the sign test prices sampling over probes, not grader variance. A class judged by
form can move 0.56 -> 0.84 -> 0.56 across near-identical code (FINDINGS, round four), and
a replay against recorded contexts ties with itself by construction. A pair that resolves
here can still be inside the grader's band; a pair that ties here is a tie.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ALPHA = 0.05
OUT = Path(__file__).resolve().parents[2] / "out" / "s7-d365-x10"

# Adjacent pairs on the published ladder's top, plus the controls. (label, run dir)
LADDER = [
    ("athena, both tiers governed (0.86)", "run-athena-20260906-114628-d82991"),
    ("hybrid verbatim (0.87)", "run-hybrid-verbatim-20260904-221333-09cc58"),
    ("retrieval, 200-chunk ceiling (0.89)", "run-raw-retrieval-20260904-222502-9ff531"),
    ("versioned store, mixed read (0.90)", "run-supermemory-20260918-093544-03b512"),
    ("versioned store, curated read (0.92)", "run-recorded-20260918-094102-f63231"),
]
NONE = "run-none-20260903-124549-873266"
FULL = "run-full-history-20260903-125004-b8affd"


def load(run: str) -> dict[str, bool]:
    raw = json.loads((OUT / run / "answers.json").read_text(encoding="utf-8"))
    rows = raw if isinstance(raw, list) else raw.get("answers", list(raw.values()))
    return {r["probe_id"]: r["verdict"] == "correct" for r in rows}


def sign_test(k: int, n: int) -> float:
    """Exact two-sided sign test at p = 0.5."""
    if n == 0:
        return 1.0
    lo = min(k, n - k)
    tail = sum(math.comb(n, i) for i in range(lo + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def compare(a: str, b: str) -> dict:
    A, B = load(a), load(b)
    shared = A.keys() & B.keys()
    only_a = sum(1 for p in shared if A[p] and not B[p])
    only_b = sum(1 for p in shared if B[p] and not A[p])
    p = sign_test(only_a, only_a + only_b)
    return {"n": len(shared), "only_a": only_a, "only_b": only_b, "p": p, "resolved": p < ALPHA}


def main(argv: list[str]) -> int:
    run = LADDER[0][1]
    if compare(run, run)["resolved"] or not compare(NONE, FULL)["resolved"]:
        print("ladder_resolution: CONTROL FAILED - a run against itself resolved, or none vs "
              "full history did not. The report below would mean nothing.")
        return 1
    pairs = ([(argv[0], argv[0], argv[1], argv[1])] if len(argv) == 2 else
             [(LADDER[i][0], LADDER[i][1], LADDER[i + 1][0], LADDER[i + 1][1])
              for i in range(len(LADDER) - 1)]
             + [(LADDER[2][0], LADDER[2][1], LADDER[4][0], LADDER[4][1])])
    print(f"controls: self-pair ties, none vs full history resolves (alpha {ALPHA})\n")
    for la, a, lb, b in pairs:
        r = compare(a, b)
        verdict = "RESOLVED" if r["resolved"] else "tie"
        print(f"{la}  ->  {lb}\n    n={r['n']}  only-first={r['only_a']}  only-second={r['only_b']}  "
              f"net={r['only_b'] - r['only_a']:+d} of {r['only_a'] + r['only_b']} discordant  "
              f"p={r['p']:.3f}  {verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
