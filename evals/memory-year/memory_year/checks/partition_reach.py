"""Partition reach: which state changes can a write-time reconciliation ever see?

A store that reconciles at write time (dedup, update, supersede) first recalls candidates
for the new statement, and the candidate pool is filtered by some partition key. The read
path usually spans more than that pool. A change whose old value was stated in another
partition is never compared with it, so both values stay live and the reader is served the
pair. This check prices that, per partition key, from the scenario's own ground truth:

- a change is a fact that supersedes another, or an expiry that closes one;
- it is REACHABLE under a key when some earlier event stating the old fact carries the
  same key as the event stating the change.

The harness ingests the whole year as one conversation, so on the ladder every arm runs
with the first row below and a session-partitioned design cannot lose anything. This check
is what the ladder cannot show: the same scenario with a realistic session boundary.

No consumer, no judge, no model call.

    py -m memory_year.checks.partition_reach [--scenario out/s7-d365-x10]

The instrument asserts itself before it reports: every change must have an earlier
statement of its old fact (else the change list is wrong), and the read-scope partition
must reach every change (else the reach test is wrong). Exit 0 = report printed. Exit 1 =
a control failed.

Limit: reach is not accuracy. An unreached change leaves both values served; a reader
that sees the dates can still answer right (stale-served is not stale-answered).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[2]
DEFAULT_SCENARIO = HERE / "out" / "s7-d365-x10"

PARTITIONS = {
    "one conversation for the year (the harness)": lambda e: "sim-year",
    "scope, all time (the read scope)": lambda e: e["scope"],
    "scope + week": lambda e: (e["scope"], e["day"] // 7),
    "scope + day (a working session)": lambda e: (e["scope"], e["day"]),
    "day, any scope": lambda e: e["day"],
}
READ_SCOPE = "scope, all time (the read scope)"
SESSION = "scope + day (a working session)"


def changes(events: list[dict], facts: dict[str, dict]) -> list[tuple[str, str, dict]]:
    """(kind, old fact id, the event that states the change), in event order."""
    first = {}
    for e in events:
        for fid in e["facts"]:
            first.setdefault(fid, e)
    superseded = {f["supersedes"] for f in facts.values() if f.get("supersedes")}
    out = []
    for f in facts.values():
        if f.get("supersedes") and f["id"] in first:
            out.append(("supersede", f["supersedes"], first[f["id"]]))
    for f in facts.values():
        if f.get("valid_to") is not None and f["id"] not in superseded:
            closing = [e for e in events if f["id"] in e["facts"] and e["day"] == f["valid_to"]]
            if closing:
                out.append(("expire", f["id"], closing[0]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", type=Path, default=DEFAULT_SCENARIO)
    a = ap.parse_args()
    events = sorted(json.loads((a.scenario / "events.json").read_text(encoding="utf-8")),
                    key=lambda e: (e["day"], e["minute"], e["id"]))
    facts = {f["id"]: f for f in json.loads((a.scenario / "facts.json").read_text(encoding="utf-8"))}
    probes = json.loads((a.scenario / "probes.json").read_text(encoding="utf-8"))
    order = {e["id"]: i for i, e in enumerate(events)}
    stated: dict[str, list[dict]] = {}
    for e in events:
        for fid in e["facts"]:
            stated.setdefault(fid, []).append(e)

    ch = changes(events, facts)

    def earlier(old: str, ev: dict) -> list[dict]:
        return [m for m in stated.get(old, []) if order[m["id"]] < order[ev["id"]]]

    def reached(key) -> set[str]:
        return {old for _, old, ev in ch if any(key(m) == key(ev) for m in earlier(old, ev))}

    orphan = [old for _, old, ev in ch if not earlier(old, ev)]
    if not ch or orphan:
        print(f"CONTROL FAILED: {len(ch)} changes, {len(orphan)} with no earlier statement of the old fact")
        return 1
    if len(reached(PARTITIONS[READ_SCOPE])) != len({old for _, old, _ in ch}):
        print("CONTROL FAILED: the read-scope partition does not reach every change")
        return 1

    gaps = [ev["day"] - max(m["day"] for m in earlier(old, ev)) for _, old, ev in ch]
    kinds = {k: sum(1 for c in ch if c[0] == k) for k in ("supersede", "expire")}
    print(f"scenario {a.scenario.name}: {len(facts)} facts, {len(events)} events, {len(probes)} probes")
    print(f"state changes: {len(ch)} ({kinds['supersede']} supersede, {kinds['expire']} expire); "
          f"days since the old value was last stated: same day {sum(g == 0 for g in gaps)}, "
          f"1-7 {sum(1 <= g <= 7 for g in gaps)}, 8-30 {sum(8 <= g <= 30 for g in gaps)}, >30 {sum(g > 30 for g in gaps)}")
    print()
    print("| candidate pool partitioned by | changes reached | share |")
    print("| --- | --- | --- |")
    for name, key in PARTITIONS.items():
        n = sum(1 for _, old, ev in ch if any(key(m) == key(ev) for m in earlier(old, ev)))
        print(f"| {name} | {n}/{len(ch)} | {n / len(ch):.2f} |")

    missed = {old for _, old, _ in ch} - reached(PARTITIONS[SESSION])
    graded = [p for p in probes if p["cls"] in ("reversal", "expired")]
    hit = [p for p in graded if any(fid in missed or facts.get(fid, {}).get("supersedes") in missed
                                    for fid in p["fact_ids"])]
    print()
    print(f"reversal and expired probes resting on a change the session partition never reaches: "
          f"{len(hit)}/{len(graded)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
