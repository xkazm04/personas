"""Clock purity: replay the same short scenario at two base dates; recall must not differ.

A backend whose recall changes when only the base date moves is reading the wall clock
somewhere - and the part of the system that decides what the agent knows is then the
part with no tests. This is the memory-value-model rule made into a pass/fail check.

    py -m memory_year.checks.clock_purity --scenario out/smoke --rung athena --backend-kw '{...}'
    py -m memory_year.checks.clock_purity --scenario out/smoke --self-test
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta, timezone

DAY_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
SHIFT_DAYS = 400


# The word boundaries below were once four literal backspace bytes (0x08), so the pattern
# matched nothing and ids were never erased. Keep them as the two characters backslash-b.
ID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{16,64}\b")


def fixture_dates(scenario: dict) -> frozenset[str]:
    """Dates the scenario writes into its own event and probe text. The base shift does not
    move them, so they are compared as written rather than rebased."""
    texts = [e.text for e in scenario["events"]] + [p.question for p in scenario["probes"]]
    return frozenset(d for t in texts for d in DAY_RE.findall(t))


def normalise(text: str, base: datetime, literals: frozenset[str] = frozenset()) -> str:
    """Recall renders the injected instant, so the two replays differ in every date they print.

    This used to mask every date, which made the check blind to the wall-clock read most likely
    to happen - a date rendered from the writer's clock lands in exactly the field the mask
    erased. A backend stamping the wall clock on every recalled line passed 46/46 probes. So a
    date is rebased onto its offset from this replay's base instead: one derived from the
    injected clock reads the same on both replays, one read from anywhere else is off by the
    shift. Time of day is left as written (the shift is whole days, UTC). Ids are still
    erased: every replay mints fresh ones and nothing injected produced them."""
    def rebase(m: re.Match) -> str:
        day = m.group(0)
        if day in literals:
            return day
        return f"<base{(datetime.strptime(day, '%Y-%m-%d').date() - base.date()).days:+d}d>"
    return ID_RE.sub("<id>", DAY_RE.sub(rebase, text))


def first_diff(a: str, b: str, width: int = 90) -> str:
    n = min(len(a), len(b))
    i = next((k for k in range(n) if a[k] != b[k]), n)
    lo = max(0, i - width // 2)
    return f"@{i}: A {a[lo:i + width]!r} | B {b[lo:i + width]!r}"
from pathlib import Path

from .. import backends
from ..clock import Clock, EPOCH
from ..world import World


def replay(rung: str, scenario: dict, base: datetime, budget: int, max_days: int, kw: dict, consolidate: bool = True) -> dict[str, str]:
    literals = fixture_dates(scenario)
    b = backends.make(rung, **kw)
    events = [e for e in scenario["events"] if e.day < max_days]
    probes = [p for p in scenario["probes"] if p.day < max_days]
    timeline = sorted([("e", e.day, e.minute, e) for e in events] + [("p", p.day, p.minute, p) for p in probes], key=lambda t: (t[1], t[2], 0 if t[0] == "e" else 1))
    out = {}
    last_day = -1
    for kind, day, minute, obj in timeline:
        clock = Clock(day, minute, base)
        if consolidate and day != last_day and last_day >= 0:
            b.consolidate(Clock(last_day, 23 * 60, base))
        last_day = day
        if kind == "e":
            b.ingest(obj, clock)
        else:
            c = b.recall(obj, clock, budget)
            out[obj.id] = normalise(c.text, base, literals) + chr(10) + f"#items={len(c.items)}"
    b.close()
    return out


def self_test(scenario: dict, budget: int, max_days: int) -> bool:
    """The check's own negative control. full-history renders the injected instant on every
    line; a copy that renders the wall clock instead must FAIL, and the unmodified backend must
    PASS. A purity check never seen red cannot say whether it is guarding anything."""
    from ..backends import full_history

    stock = full_history.render
    wall = Clock(0, 0, datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0))
    differ = {}
    for label, render in (("clean", stock), ("wall-clock", lambda event, _clock: stock(event, wall))):
        full_history.render = render
        try:
            a = replay("full-history", scenario, EPOCH, budget, max_days, {}, False)
            b = replay("full-history", scenario, EPOCH + timedelta(days=SHIFT_DAYS), budget, max_days, {}, False)
        finally:
            full_history.render = stock
        differ[label] = (sum(a[k] != b.get(k) for k in a), len(a))
    ok = differ["clean"][0] == 0 and differ["wall-clock"][0] > 0
    for label, (n, total) in differ.items():
        print(f"self-test {label:10s}: {n}/{total} probes differ -> {'PASS' if n == 0 else 'FAIL'}")
    print(f"self-test: {'OK - clean passes, wall-clock is caught' if ok else 'BROKEN - the check cannot tell them apart'}")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", required=True)
    ap.add_argument("--rung")
    ap.add_argument("--self-test", action="store_true",
                    help="run the check against full-history and a wall-clock copy of it: the copy must fail")
    ap.add_argument("--max-days", type=int, default=30)
    ap.add_argument("--budget", type=int, default=6000)
    ap.add_argument("--backend-kw", default="{}")
    ap.add_argument("--no-consolidate", action="store_true",
                    help="skip the design's scheduled passes: a model-driven consolidation is non-deterministic by nature, so the clock question is asked of the deterministic layer alone")
    a = ap.parse_args()
    scenario = World.load(Path(a.scenario))
    if a.self_test:
        raise SystemExit(0 if self_test(scenario, a.budget, a.max_days) else 1)
    if not a.rung:
        ap.error("--rung is required unless --self-test is given")
    kw = json.loads(a.backend_kw)
    a1 = replay(a.rung, scenario, EPOCH, a.budget, a.max_days, kw, not a.no_consolidate)
    a2 = replay(a.rung, scenario, EPOCH + timedelta(days=SHIFT_DAYS), a.budget, a.max_days, kw, not a.no_consolidate)
    diff = [k for k in a1 if a1[k] != a2.get(k)]
    out_dir = Path(a.scenario) / "clock-purity"
    out_dir.mkdir(exist_ok=True)
    (out_dir / f"{a.rung}-A.json").write_text(json.dumps(a1, indent=1), encoding="utf-8")
    (out_dir / f"{a.rung}-B.json").write_text(json.dumps(a2, indent=1), encoding="utf-8")
    layer = "deterministic layer only (no scheduled passes)" if a.no_consolidate else "full design"
    print(f"clock purity for {a.rung} [{layer}]: {len(a1)} probes compared, {len(diff)} differ -> {'PASS' if not diff else 'FAIL'}")
    for k in diff[:6]:
        print(f"  {k} {first_diff(a1[k], a2.get(k, ''))}")
    raise SystemExit(0 if not diff else 1)


if __name__ == "__main__":
    main()
