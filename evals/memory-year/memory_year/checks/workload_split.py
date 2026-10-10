"""Workload split: does a run's record attribute every token it drew on the seat?

One subscription seat serves every model call a run makes: the unaided screen, the
consumer answering, the judge, and the arm's own write path. A window is planned as
capacity split between those workloads, and a split that is not recorded cannot be
planned. Until 2026-10-10 the header carried the consumer's counters, which silently
included the screen, and the arm's write cost; the judge's draw was counted by its own
client and never written down.

Model-free and offline: a small world is generated into a temp directory and
`subprocess.run` is replaced, so no CLI is launched. The fake answers each model with a
known usage, so the tokens the seat served are known exactly and can be compared with
what the header attributes.

    py -m memory_year.checks.workload_split

Exit 0 = every served token is attributed to exactly one named workload, and the screen
is apart from the answering. Exit 1 = the report names what was not.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

from .. import llm as llm_mod
from ..run import run
from ..world import World

CONSUMER = "claude:fake-consumer@low"
JUDGE = "claude:fake-judge@low"
USAGE = {"fake-consumer": (100, 20), "fake-judge": (7, 1)}
# long enough that the judge's extraction runs on every value probe
REPLY = {"fake-consumer": "I have no record of that in what I was given. " * 6, "fake-judge": "NONE"}


class _Seat:
    def __init__(self):
        self.served = defaultdict(lambda: [0, 0, 0])   # model -> calls, tokens in, tokens out
        self.real = subprocess.run

    def run(self, args, *a, **k):
        if not isinstance(args, list) or "--model" not in args:
            return self.real(args, *a, **k)   # the revision stamp's git calls
        model = args[args.index("--model") + 1]
        tin, tout = USAGE[model]
        s = self.served[model]
        s[0] += 1; s[1] += tin; s[2] += tout
        env = {"type": "result", "subtype": "success", "is_error": False, "result": REPLY[model],
               "usage": {"input_tokens": tin, "output_tokens": tout}}
        return subprocess.CompletedProcess(args, 0, json.dumps(env), "")


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="memory-year-split-"))
    scen = tmp / "s1-d60-x4"
    World(1, 60, 4.0, 2).generate().save(scen)
    seat = _Seat()
    llm_mod.subprocess.run = seat.run
    try:
        rd = run(scen, "none", CONSUMER, JUDGE, 6000, "direct", tmp / "out", parallel=2)
    finally:
        llm_mod.subprocess.run = seat.real
    h = json.loads((rd / "header.json").read_text(encoding="utf-8"))
    verdicts = [(a["probe_id"], a["verdict"]) for a in json.loads((rd / "answers.json").read_text(encoding="utf-8"))]
    # the floor: recording the split must not move a verdict
    print(f"verdicts over {len(verdicts)} probes: {hashlib.sha256(json.dumps(verdicts).encode()).hexdigest()[:12]}")
    served = sum(t[1] + t[2] for t in seat.served.values())
    al = h.get("allowance")
    if al:
        attributed = sum(w.get("tokens_in", 0) + w.get("tokens_out", 0) for w in al.values())
        named = ", ".join(f"{k} {w.get('tokens_in', 0) + w.get('tokens_out', 0)}" for k, w in al.items())
    else:
        wc = h.get("write_cost") or {}
        attributed = (h.get("consumer_tokens_in") or 0) + (h.get("consumer_tokens_out") or 0) \
            + (wc.get("tokens_in") or 0) + (wc.get("tokens_out") or 0)
        named = f"consumer {attributed} (screen and answering together), writing 0"
    misses = []
    print(f"seat served {served} tokens: " + ", ".join(f"{m} {c} calls {i}+{o}" for m, (c, i, o) in sorted(seat.served.items())))
    print(f"header attributes {attributed}: {named}")
    if attributed > served:
        misses.append(f"the header attributes {attributed - served} tokens the seat never served (cache replays counted as draw)")
    if al is None or attributed < served:
        j = seat.served.get("fake-judge", [0, 0, 0])
        unseen = served - attributed if al else j[1] + j[2]
        if unseen:
            misses.append(f"{unseen} served tokens are attributed to no workload")
    if not al:
        misses.append("the header has no per-workload allowance record")
    else:
        j = seat.served.get("fake-judge", [0, 0, 0])
        if (al["judging"]["tokens_in"], al["judging"]["tokens_out"]) != (j[1], j[2]):
            misses.append(f"judging recorded {al['judging']} but the judge drew {j}")
        if not al["screening"]["calls"] or not al["answering"]["calls"]:
            misses.append("the screen and the answering are not recorded apart")
    if "parallel" not in h:
        misses.append("the header does not record the concurrency the run drew at")
    for m in misses:
        print(f"MISS: {m}")
    print("ok" if not misses else f"{len(misses)} miss(es)")
    return 1 if misses else 0


if __name__ == "__main__":
    sys.exit(main())
