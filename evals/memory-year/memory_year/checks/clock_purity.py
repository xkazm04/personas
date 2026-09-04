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


ID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,64}")


def normalise(text: str) -> str:
    """Rendered recall embeds absolute instants and generated ids; the base-date shift
    moves every instant by design and every replay mints fresh ids. Only the structure
    and the substance must be identical."""
    return ID_RE.sub("<id>", DATE_RE.sub("<date>", text))


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
            out[obj.id] = normalise(c.text) + chr(10) + f"#items={len(c.items)}"
    b.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", required=True)
    ap.add_argument("--rung", required=True)
    ap.add_argument("--max-days", type=int, default=30)
    ap.add_argument("--budget", type=int, default=6000)
    ap.add_argument("--backend-kw", default="{}")
    ap.add_argument("--no-consolidate", action="store_true",
                    help="skip the design's scheduled passes: a model-driven consolidation is non-deterministic by nature, so the clock question is asked of the deterministic layer alone")
    a = ap.parse_args()
    scenario = World.load(Path(a.scenario))
    kw = json.loads(a.backend_kw)
    a1 = replay(a.rung, scenario, EPOCH, a.budget, a.max_days, kw, not a.no_consolidate)
    a2 = replay(a.rung, scenario, EPOCH + timedelta(days=400), a.budget, a.max_days, kw, not a.no_consolidate)
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
