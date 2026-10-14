"""Temporal vote: does a period named in a question help retrieval, and is it safe as a vote?

The probe set asks about the present. A question that names a period ("what was the host
back in March") asks for a statement the newest one on the same topic outranks, and no
lane reads the period. This check builds such questions from the scenario's own ground
truth - for every superseded fact, what it was in the month it was first stated - and
replays the hybrid-verbatim arm's ranking over the store as it stood when the question is
asked. It then compares, by retrieval coverage only:

- A: the arm's ranking, unchanged;
- vote: the same ranking fused by reciprocal rank (k=60) with one more list, the fetched
  candidates (top 200) whose event day falls in the named window, at weight 1, 0.5, 0.25;
- filter: the fetched candidates inside the window only.

Each under the right window and under a window shifted one month early (a misremembered
month, or a misparse). Coverage = an event stating the asked-about value reached the
packed context (the arm's own packing: 6,000 tokens, stop at the first miss, cap, +-1
sibling hydration), at caps 5, 10 and 40.

No consumer, no judge, no model call. The local embedder reads its cache in out/cache.

    py -m memory_year.checks.temporal_vote

The instrument asserts itself before it reports: the parser must fire on none of the 194
standard probes (so their contexts are identical under every arm), a vote at weight 0
must equal A, and a window that matches no candidate must change nothing. Exit 0 =
report printed. Exit 1 = a control failed.

Limit: coverage is not accuracy. A context holding the right statement can still be
answered wrong; this resolves only whether the vote moves the statement into reach.
Source: the period-as-a-vote design read in an open-source memory store, 2026-10-14
(registry technique retrieval/named-period-vote).
"""
from __future__ import annotations

import calendar
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from ..backends.hybrid_verbatim import HybridVerbatim, _tokens, _unit
from ..clock import EPOCH, Clock
from ..llm import estimate_tokens
from ..model import Event

ROOT = Path(__file__).resolve().parents[2]
SCENARIO = ROOT / "out" / "s7-d365-x10"
CACHE = ROOT / "out" / "cache"
BUDGET = 6000
RRF_K = 60
CAPS = (5, 10, 40)
DEPTH = 200
MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
PERIOD = re.compile(r"\b(?:in|back in|during)\s+(" + "|".join(MONTHS) + r")(?:\s+(\d{4}))?\b", re.I)


def at(day: int, minute: int = 0) -> datetime:
    return EPOCH + timedelta(days=day, minutes=minute)


def month_window(year: int, month: int):
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=timezone.utc)
    return start, end


def parse_window(question: str, now: datetime):
    """Named month only, and only with its preposition. No year: the most recent such
    month that has started at `now` (the asker's instant, never the wall clock)."""
    m = PERIOD.search(question)
    if not m:
        return None
    month = MONTHS[m.group(1).lower()]
    year = int(m.group(2)) if m.group(2) else (now.year if month <= now.month else now.year - 1)
    return month_window(year, month)


def shifted(window, months: int):
    start, _ = window
    y, m = start.year, start.month + months
    while m < 1:
        y, m = y - 1, m + 12
    while m > 12:
        y, m = y + 1, m - 12
    return month_window(y, m)


def questions(events, facts):
    by_fact: dict[str, list[dict]] = {}
    for ev in events:
        for fid in ev["facts"]:
            by_fact.setdefault(fid, []).append(ev)
    out = []
    for f in facts.values():
        old_id = f.get("supersedes")
        if not old_id or f["kind"] not in ("fact", "preference"):
            continue
        old_evs, new_evs = by_fact.get(old_id, []), by_fact.get(f["id"], [])
        if not old_evs or not new_evs:
            continue
        first_old = at(min(e["day"] for e in old_evs))
        first_new = at(min(e["day"] for e in new_evs))
        if (first_new.year, first_new.month) == (first_old.year, first_old.month):
            continue  # one window would hold both statements
        day = min(364, min(e["day"] for e in new_evs) + 30)
        gold = {e["id"] for e in old_evs
                if (at(e["day"], e["minute"]).year, at(e["day"], e["minute"]).month) == (first_old.year, first_old.month)}
        newer = {e["id"] for e in new_evs if e["day"] <= day}
        subject = f"my {f['key']}" if f["scope"] == "user" else f"the {f['key']} for project {f['scope']}"
        name = calendar.month_name[first_old.month]
        for q in (f"What did I say {subject} was in {name} {first_old.year}?",
                  f"What did I say {subject} was back in {name}?"):
            out.append({"day": day, "minute": 1439, "question": q, "gold": gold, "newer": newer})
    return sorted(out, key=lambda p: (p["day"], p["minute"]))


def ranked(b: HybridVerbatim, question: str) -> list[int]:
    b._flush()
    q = b.embedder.embed([question])[0]
    scores = b.vector_weight * _unit(np.vstack(b.vecs) @ q) + b.lexical_weight * _unit(b._bm25(_tokens(question)))
    scores = scores * b._key_multiplier(question)
    return [int(i) for i in np.argsort(-scores, kind="stable")]


def inside(b: HybridVerbatim, ids: list[int], window) -> list[int]:
    start, end = window
    return [i for i in ids if start <= at(b.days[i]) < end]


def vote(b, order, window, weight, depth=DEPTH):
    head = order[:depth]
    lane = inside(b, head, window)
    if not lane or weight == 0:
        return order
    score: dict[int, float] = {}
    for lst, w in ((head, 1.0), (lane, weight)):
        for r, i in enumerate(lst):
            score[i] = score.get(i, 0.0) + w / (RRF_K + r + 1)
    pos = {i: r for r, i in enumerate(head)}
    return sorted(head, key=lambda i: (-score[i], pos[i])) + order[depth:]


def filtered(b, order, window, depth=DEPTH):
    lane = inside(b, order[:depth], window)
    return lane if lane else order


def pack(b: HybridVerbatim, order: list[int], cap: int) -> set[str]:
    chosen, used = [], 0
    for i in order:
        t = estimate_tokens(b.texts[i])
        if used + t > BUDGET:
            if used > 0:
                break
            continue
        chosen.append(i)
        used += t
        if len(chosen) >= cap:
            break
    picked = set(chosen)
    for i in chosen:
        for j in (i - 1, i + 1):
            if 0 <= j < len(b.texts) and j not in picked:
                t = estimate_tokens(b.texts[j])
                if used + t <= BUDGET:
                    picked.add(j)
                    used += t
    return {b.ids[i] for i in picked}


def main() -> int:
    events = sorted(json.loads((SCENARIO / "events.json").read_text(encoding="utf-8")), key=lambda e: (e["day"], e["minute"]))
    facts = {f["id"]: f for f in json.loads((SCENARIO / "facts.json").read_text(encoding="utf-8"))}
    standard = json.loads((SCENARIO / "probes.json").read_text(encoding="utf-8"))
    probes = questions(events, facts)

    fired = [p["id"] for p in standard if parse_window(p["question"], at(p["day"], p["minute"]))]
    if fired:
        print(f"CONTROL FAILED: the parser fired on {len(fired)} standard probes: {fired[:5]}")
        return 1

    b = HybridVerbatim(cache_dir=CACHE)
    arms = ["A", "vote 1", "vote 0.5", "vote 0.25", "filter"]
    tally = {(w, a, c): 0 for w in ("right", "wrong") for a in arms for c in CAPS}
    newer = {(a, c): 0 for a in ("A", "vote 1") for c in CAPS}
    depth_gain = {d: 0 for d in (50, 200, 10_000)}
    k = 0
    for p in probes:
        while k < len(events) and (events[k]["day"], events[k]["minute"]) <= (p["day"], p["minute"]):
            ev = events[k]
            b.ingest(Event(**ev), Clock(ev["day"], ev["minute"]))
            k += 1
        window = parse_window(p["question"], at(p["day"], p["minute"]))
        if window is None:
            print(f"CONTROL FAILED: no window parsed from {p['question']!r}")
            return 1
        order = ranked(b, p["question"])
        if vote(b, order, window, 0.0) != order or vote(b, order, month_window(2099, 1), 1.0) != order:
            print("CONTROL FAILED: a zero-weight vote or an empty window changed the order")
            return 1
        base = {c: bool(pack(b, order, c) & p["gold"]) for c in CAPS}
        for which, w in (("right", window), ("wrong", shifted(window, -1))):
            orders = {"A": order, "vote 1": vote(b, order, w, 1.0), "vote 0.5": vote(b, order, w, 0.5),
                      "vote 0.25": vote(b, order, w, 0.25), "filter": filtered(b, order, w)}
            for a, o in orders.items():
                for c in CAPS:
                    ctx = pack(b, o, c)
                    if which == "wrong":
                        tally[(which, a, c)] += int(base[c] and not (ctx & p["gold"]))  # lost vs A
                    else:
                        tally[(which, a, c)] += int(bool(ctx & p["gold"]))
                        if a in ("A", "vote 1"):
                            newer[(a, c)] += int(bool(ctx & p["newer"]))
        for d in depth_gain:
            depth_gain[d] += int(bool(pack(b, vote(b, order, window, 1.0, d), 40) & p["gold"]) and not base[40])

    print(f"temporal vote - {len(probes)} past-state questions over {SCENARIO.name}, "
          f"embedder {b.embedder.name}, budget {BUDGET}, candidate depth {DEPTH}, rrf k {RRF_K}")
    print("standard probes with a parsed window: 0 (their contexts are identical under every arm)")
    print("\nright window - questions whose context held a statement from the asked-about month")
    print("cap   " + "".join(f"{a:>11}" for a in arms))
    for c in CAPS:
        print(f"{c:<6}" + "".join(f"{tally[('right', a, c)]:>11}" for a in arms))
    print("\nwrong window (one month early) - questions A answered that the arm lost")
    print("cap   " + "".join(f"{a:>11}" for a in arms[1:]))
    for c in CAPS:
        print(f"{c:<6}" + "".join(f"{tally[('wrong', a, c)]:>11}" for a in arms[1:]))
    print("\nsuperseding statement also in context (right window): "
          + ", ".join(f"cap {c}: A {newer[('A', c)]} vote {newer[('vote 1', c)]}" for c in CAPS))
    print("questions gained at cap 40 by a full-weight vote, by candidate depth: "
          + ", ".join(f"{d}: {g}" for d, g in depth_gain.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
