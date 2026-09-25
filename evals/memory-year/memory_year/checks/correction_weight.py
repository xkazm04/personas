"""Correction standing: does charging a row for having been corrected change what recall
returns, and in which direction?

The seam. `write_verdict` accumulates a per-row `confidence` on every `support` verdict
(1117 times in the 365-day run) and the read path never looks at it: `recall` ranks on
cosine alone. So the store already carries a standing signal with no reader, and the
60-item cap in `recall` binds hard - 159 active rows, 60 slots - which means a standing
that does reach the ranking decides which rows are dropped.

The question. A memory store can hand a corrected row LESS standing than the row it
replaced, so that correcting costs something. Under that rule the row that is right now
pays, and the row nobody ever maintained keeps what it had. This check replays one real
scenario through every standing policy and reports what each does to recall, with no
model call and no consumer: the metric is retrieval-level, which is where a ranking rule
can be right or wrong on its own terms.

    py -m memory_year.checks.correction_weight --scenario <dir> --cache <dir>

Every write pass must be a cache HIT: the prompt is untouched by any policy, so a miss
means the scenario or the model spec has moved and the numbers would not be comparable.
A miss raises rather than spending.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from .. import backends
from ..backends.write_verdict import WEIGHT_POLICIES
from ..clock import Clock
from ..model import Probe
from ..world import World

# gold that is not a value: nothing to look for in a rendered context
NOT_A_VALUE = ("UNKNOWN", "FORM")

# the probe classes whose fact was corrected at least once before the probe - the rows a
# correction charge is actually levied on
CORRECTED = ("reversal", "preference")
# the probe classes whose fact was never corrected - the rows that must not be crowded
# out when corrected rows are given their standing back
UNCORRECTED = ("stable", "failure-cause", "scope")
# stale-answer hygiene is asked of every class that has a specifically wrong old value
STALE = ("reversal", "preference", "expired")

WS = re.compile(r"\s+")


def norm(s: str) -> str:
    return WS.sub(" ", s.strip().lower())


class CacheOnly(Exception):
    """A write pass missed the content cache, so this replay is not the recorded one."""


def replay(scenario: dict, policy: str, cache_dir: Path, budget: int, model: str,
           max_days: int | None = None, item_cap: int = 60, weight_step: float = 0.1) -> dict:
    kw = {"cache_dir": cache_dir, "weight_policy": policy, "model": model, "item_cap": item_cap,
          "weight_step": weight_step}
    b = backends.make("write-verdict", **kw)

    inner = b.llm.complete

    def cache_only(prompt: str, system: str = ""):
        before = b.llm.cache_hits
        r = inner(prompt, system)
        if b.llm.cache_hits == before:
            raise CacheOnly(f"uncached write pass under policy {policy!r}: {prompt[:160]!r}")
        return r

    b.llm.complete = cache_only            # type: ignore[method-assign]

    events = scenario["events"]
    probes = scenario["probes"]
    if max_days is not None:
        events = [e for e in events if e.day < max_days]
        probes = [p for p in probes if p.day < max_days]
    timeline = sorted(
        [("e", e.day, e.minute, e) for e in events] + [("p", p.day, p.minute, p) for p in probes],
        key=lambda t: (t[1], t[2], 0 if t[0] == "e" else 1))

    rows: list[dict] = []
    day_seen = -1
    for kind, day, minute, obj in timeline:
        clock = Clock(day, minute)
        if day != day_seen:
            if day_seen >= 0:
                b.consolidate(Clock(day_seen, 23 * 60))
            day_seen = day
        if kind == "e":
            b.ingest(obj, clock)
            continue
        p: Probe = obj
        ctx = b.recall(p, clock, budget)
        text = norm(ctx.text)
        # where the row actually sits in the ranking, and whether it is in the store at
        # all. Without the second, a miss cannot be told from a row that was never
        # written, and the first number would be a claim about retrieval that is really
        # a claim about extraction.
        ranked = b.ranking(p.question)
        gold_rank = stale_rank = None
        gold_in_store = stale_in_store = None
        if p.gold not in NOT_A_VALUE:
            g = norm(p.gold)
            gold_rank = next((i for i, f in enumerate(ranked) if g in norm(f.render())), None)
            gold_in_store = gold_rank is not None
        if p.wrong:
            ws = [norm(w) for w in p.wrong]
            stale_rank = next((i for i, f in enumerate(ranked) if any(w in norm(f.render()) for w in ws)), None)
            stale_in_store = stale_rank is not None
        rows.append({
            "probe": p.id, "cls": p.cls, "day": p.day, "items": len(ctx.items),
            "active": len(ranked),
            "gold_hit": None if p.gold in NOT_A_VALUE else (norm(p.gold) in text),
            "stale_hit": any(norm(w) in text for w in p.wrong) if p.wrong else None,
            "gold_in_store": gold_in_store, "gold_rank": gold_rank,
            "stale_in_store": stale_in_store, "stale_rank": stale_rank,
        })
    return {"policy": policy, "describe": b.describe(), "rows": rows,
            "llm_calls": b.llm.calls, "llm_cache_hits": b.llm.cache_hits,
            "embed_misses": b.embedder.calls}


def rate(rows: list[dict], classes: tuple[str, ...], field: str) -> tuple[int, int]:
    sel = [r for r in rows if r["cls"] in classes and r[field] is not None]
    return sum(1 for r in sel if r[field]), len(sel)


def summarise(res: dict) -> dict:
    rows = res["rows"]
    t1 = rate(rows, CORRECTED, "gold_hit")
    t2 = rate(rows, UNCORRECTED, "gold_hit")
    t3 = rate(rows, STALE, "stale_hit")
    per_cls = {}
    for cls in sorted({r["cls"] for r in rows}):
        g = rate(rows, (cls,), "gold_hit")
        s = rate(rows, (cls,), "stale_hit")
        per_cls[cls] = {"gold": f"{g[0]}/{g[1]}", "stale": f"{s[0]}/{s[1]}"}
    # rank is measured only where the row IS in the store, so a retrieval number is never
    # carrying an extraction failure
    def mean_rank(classes: tuple[str, ...], field: str) -> float | None:
        sel = [r[field] for r in rows if r["cls"] in classes and r[field] is not None]
        return round(sum(sel) / len(sel), 3) if sel else None

    return {
        "policy": res["policy"],
        "T1_corrected_gold": f"{t1[0]}/{t1[1]}",
        "T2_uncorrected_gold": f"{t2[0]}/{t2[1]}",
        "T3_stale": f"{t3[0]}/{t3[1]}",
        "R1_corrected_gold_rank": mean_rank(CORRECTED, "gold_rank"),
        "R2_uncorrected_gold_rank": mean_rank(UNCORRECTED, "gold_rank"),
        "R3_stale_rank": mean_rank(STALE, "stale_rank"),
        "gold_in_store": f"{sum(1 for r in rows if r['gold_in_store'])}/{sum(1 for r in rows if r['gold_in_store'] is not None)}",
        "mean_items": round(sum(r["items"] for r in rows) / max(1, len(rows)), 2),
        "item_cap": res["describe"].get("item_cap"),
        "weight_max": res["describe"].get("weight_max"),
        "weight_distinct": res["describe"].get("weight_distinct"),
        "weight_above_one": res["describe"].get("weight_above_one"),
        "weight_min": res["describe"].get("weight_min"),
        "weight_below_one": res["describe"].get("weight_below_one"),
        "deepest_correction_chain": res["describe"].get("deepest_correction_chain"),
        "verdicts": res["describe"].get("verdicts"),
        "facts_active": res["describe"].get("facts_active"),
        "llm_cache_hits": f"{res['llm_cache_hits']}/{res['llm_calls']}",
        "embed_misses": res["embed_misses"],
        "per_class": per_cls,
        # kept so the comparison between policies can be PAIRED per probe: a mean rank
        # can move while no individual probe did, and a tie between two arms on the mean
        # is the shape a replay that never ran also has
        "rows": rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--scenario", required=True, type=Path)
    ap.add_argument("--cache", required=True, type=Path, help="directory holding llm.sqlite and emb.sqlite")
    ap.add_argument("--policies", default=",".join(WEIGHT_POLICIES))
    ap.add_argument("--budget-tokens", type=int, default=6000)
    ap.add_argument("--model", default="claude:claude-sonnet-5@low")
    ap.add_argument("--max-days", type=int, default=None)
    ap.add_argument("--item-cap", type=int, default=60, help="the shipped value is 60")
    ap.add_argument("--weight-step", type=float, default=0.1,
                    help="what one correction costs; 0.2 at a real chain depth of 5 stands in "
                         "for 0.1 at the depth of 10 the claim under test assumes")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()

    scenario = World.load(a.scenario)
    out = []
    for policy in [p.strip() for p in a.policies.split(",") if p.strip()]:
        res = replay(scenario, policy, a.cache, a.budget_tokens, a.model, a.max_days, a.item_cap,
                     a.weight_step)
        s = summarise(res)
        out.append(s)
        print(json.dumps(s, indent=1), flush=True)
    if a.out:
        a.out.write_text(json.dumps(out, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
