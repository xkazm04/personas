"""Clock purity: replay the same short scenario at two base dates; recall must not differ.

A backend whose recall changes when only the base date moves is reading the wall clock
somewhere - and the part of the system that decides what the agent knows is then the
part with no tests. This is the memory-value-model rule made into a pass/fail check.

    py -m memory_year.checks.clock_purity --scenario out/smoke --rung athena --backend-kw '{...}'
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta, timezone

DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\+00:00|Z)?)?")


def normalise(text: str) -> str:
    """Rendered recall embeds absolute instants; the base-date shift moves every one of
    them by design. Only the structure and the items must be identical."""
    return DATE_RE.sub("<date>", text)
from pathlib import Path

from .. import backends
from ..clock import Clock, EPOCH
from ..world import World


def replay(rung: str, scenario: dict, base: datetime, budget: int, max_days: int, kw: dict) -> dict[str, str]:
    b = backends.make(rung, **kw)
    events = [e for e in scenario["events"] if e.day < max_days]
    probes = [p for p in scenario["probes"] if p.day < max_days]
    timeline = sorted([("e", e.day, e.minute, e) for e in events] + [("p", p.day, p.minute, p) for p in probes], key=lambda t: (t[1], t[2], 0 if t[0] == "e" else 1))
    out = {}
    last_day = -1
    for kind, day, minute, obj in timeline:
        clock = Clock(day, minute, base)
        if day != last_day and last_day >= 0:
            b.consolidate(Clock(last_day, 23 * 60, base))
        last_day = day
        if kind == "e":
            b.ingest(obj, clock)
        else:
            c = b.recall(obj, clock, budget)
            out[obj.id] = normalise(c.text) + chr(10) + "#items=" + ",".join(sorted(c.items))
    b.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", required=True)
    ap.add_argument("--rung", required=True)
    ap.add_argument("--max-days", type=int, default=30)
    ap.add_argument("--budget", type=int, default=6000)
    ap.add_argument("--backend-kw", default="{}")
    a = ap.parse_args()
    scenario = World.load(Path(a.scenario))
    kw = json.loads(a.backend_kw)
    a1 = replay(a.rung, scenario, EPOCH, a.budget, a.max_days, kw)
    a2 = replay(a.rung, scenario, EPOCH + timedelta(days=400), a.budget, a.max_days, kw)
    diff = [k for k in a1 if a1[k] != a2.get(k)]
    print(f"clock purity for {a.rung}: {len(a1)} probes compared, {len(diff)} differ -> {'PASS' if not diff else 'FAIL'}")
    for k in diff[:5]:
        print(f"  {k}: base A {a1[k][:120]!r} | base B {a2.get(k, '')[:120]!r}")
    raise SystemExit(0 if not diff else 1)


if __name__ == "__main__":
    main()
