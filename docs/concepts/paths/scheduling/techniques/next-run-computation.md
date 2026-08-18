---
layer: technique
subject: scheduling
technique: next-run-computation
status: forged
laws:
  - derivation-names-recomputation
shared_with: []
---

# Next-run computation

Given a recurrence rule and a reference instant, produce the next instant at which the
item is due. This is the one pure function at the heart of every clock trigger — and the
place where timezone, DST, and drift bugs concentrate, because it is the only place
calendar math happens.

## Procedure

1. **Normalize the rule into one of three shapes** at authoring time, not at
   evaluation time:
   - *interval* — "every N seconds/minutes/hours" (a duration, no calendar);
   - *calendar* — a cron-style expression ("minute 0 of hour 9, weekdays"), which names
     wall-clock fields;
   - *one-shot* — a single absolute instant.
2. **Decide the anchor.** Interval rules must state whether they anchor on the
   *previous scheduled time* (fixed cadence: 09:00, 09:10, 09:20 even if a run was late)
   or on the *previous completion* (fixed gap: heavy jobs that must not stack). The two
   drift apart within hours; picking implicitly means picking both, in different code
   paths, eventually.
3. **Compute in the rule's own frame, store in universal time.** Calendar rules are
   evaluated in the timezone the author wrote them in — "09:00 daily" means the
   author's 09:00, across DST transitions. The *result* is converted to a universal
   instant for storage and comparison, so the reconciliation loop compares plain
   numbers. Storing wall-clock strings and comparing them at tick time re-runs the
   calendar math on every tick and multiplies the surface for error.
4. **Make the function total.** Every rule string either parses to a schedule or is
   rejected *at authoring time* with a message; and every valid rule yields either a
   next instant or an explicit "never again" (expired one-shot, terminated recurrence).
   A rule that fails to parse only when it first comes due is a delayed-fuse authoring
   bug.
5. **Persist the computed `next_run_at` alongside the rule** — and treat it as a cache
   of the rule, recomputable at will (law: derivation-names-recomputation). Any edit to
   the rule, the item's timezone, or the enabled flag invalidates and recomputes it in
   the same write. A stored next-run that can disagree with its rule, with no arbiter,
   will.

## DST and calendar edge decisions (make them once, write them down)

- **Spring-forward gap** ("02:30 daily" on a night with no 02:30): fire at the first
  valid instant after the gap, once. Skipping the day entirely surprises authors;
  firing twice is worse.
- **Fall-back repeat** (02:30 occurs twice): fire on the first occurrence only. The
  rule means "the 02:30 event", not "every instant whose wall-clock reads 02:30".
- **Day-of-month overflow** ("31st monthly" in a 30-day month): choose clamp-to-last-day
  or skip-month explicitly; either is defensible, silence is not.
- **Sub-tick intervals**: an interval shorter than the reconciliation tick fires once
  per tick, not N times — the tick is the floor, and the authoring surface should say
  so rather than accept a cadence it cannot honor.

## Fleet spread — don't let popular rules synchronize

Calendar rules cluster on round numbers: authors write "top of the hour", and a system
with fifty such items fires fifty jobs in the same second. The fix is deterministic
jitter: where the rule leaves a degree of freedom (an "any minute in this range" token,
or an interval's phase), expand it with a stable hash of the *item's identity*, so two
items with the same rule land on different minutes — and the same item lands on the
*same* minute across every recomputation. Random jitter fails the second property: the
schedule wanders on each recompute, next-fire previews lie, and missed-run enumeration
cannot reproduce the slots that were actually due. Seeded-by-identity is the only
version that spreads the herd and keeps the function pure.

## Decision rules

- Anchor on **schedule** for observability-style jobs where cadence regularity matters;
  anchor on **completion** for resource-heavy jobs where the gap matters. Never leave
  it to whichever the implementation found convenient.
- If two of the shapes in step 1 can express the author's intent, prefer *interval* —
  it has no calendar edge cases.
- Validate at the door, compute in one function, cache with recomputation named. If
  next-run math exists in more than one place, one of them is already wrong on some
  DST boundary.
