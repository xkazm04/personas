---
layer: technique
subject: self-healing
technique: effectiveness-accounting
status: forged
laws:
  - failure-not-empty-success
  - count-carries-predicate
  - derivation-names-recomputation
shared_with: []
---

# Effectiveness accounting

A healer that does not measure itself does not stay merely unmeasured — it
degrades. Strategies that stopped working keep running (nothing demotes them),
strategies that never worked keep running (nothing exposed them), operators learn
that "healed" in the log means nothing, and the healer completes its arc from
maintenance tool to noise generator. The countermeasure is a ledger with three
properties: honest outcomes, per-cell resolution, and a closed feedback loop.

## Three outcomes, and unknown is the honest default

Every healing attempt terminates in exactly one of:

- **confirmed-fixed** — positive evidence arrived inside the attribution window:
  the failed work item subsequently succeeded, or the signature stayed silent on
  a subject that had been failing repeatedly, per the strategy's stated
  confirmation predicate;
- **reverted** — the change was undone: by auto-rollback, by an operator, or by
  the strategy's own verification step failing post-apply;
- **unknown** — the window closed without qualifying evidence either way.

The load-bearing rule is that **absence of evidence lands in unknown, never in
confirmed** (law: failure-not-empty-success — "no news" spelled differently from
"good news"). The tempting shortcut — mark attempts fixed unless something
complains — inflates the rate with every failure that simply never re-ran, every
subject that was abandoned, every window that elapsed overnight. A healer scored
that way reports 95% effectiveness while doing nothing at all, which is precisely
the failure the ledger exists to catch. A large unknown share is not an
embarrassment to hide; it is a finding: *this strategy's confirmation predicate
is unobservable as designed*, and the fix is a better predicate, not a more
optimistic default.

## Attribution windows and confirmation predicates

"It worked" needs a definition per strategy, stated at design time:

- **The predicate** names the observable that counts as confirmation — *the
  specific work item this heal targeted succeeded on its next execution*, or
  *zero recurrences of signature S on subject B for duration W*. Predicates
  bind to the healed subject; "overall errors went down" confirms nothing about
  this attempt (that aggregate belongs to auto-rollback, watching for the
  opposite).
- **The window** is long enough for the subject to actually re-exercise the
  failing path, short enough that unrelated changes don't pollute attribution.
  A window that never closes is an unknown factory; a window closed before the
  subject's next scheduled run is a confirmation that can never fire.
- **One attempt owns the window.** If a second heal lands on the same subject
  mid-window, the first attempt's outcome is no longer attributable — which is
  why selection enforces the cooldown (see strategy-selection); the accounting
  discipline and the cooldown are one design, seen from two sides.

## Per-strategy × per-category, because aggregates are propaganda

The unit of learning is the cell: *strategy S against category C confirms at
R%.* Aggregate rates mislead in both directions. A healer whose volume is
dominated by cheap tier-0 fixes with high confirmation looks excellent in
aggregate while its session-reset strategy quietly runs at 8%; conversely one
misdiagnosed high-volume category can drag the aggregate low enough to get a
genuinely working healer turned off. Decisions are made per cell:

- **demotion** — a cell whose rate falls below threshold (with a minimum-volume
  floor; three attempts prove nothing) stops being selected, automatically;
- **promotion** — a gated strategy's sustained high rate is the written evidence
  that earns tier advancement (see blast-radius-bounds);
- **escalation** — a cell with high volume and low confirmation is the healer
  saying "I keep trying and it keeps not working"; that pattern feeds
  incident-promotion.

Every published rate carries its predicate and denominator (law:
count-carries-predicate): "session-reset confirmed 41 of 63 attempts on
category C, confirmation = next-run success within 24h" travels; "88% healed"
gets quoted in a status report to justify expanding the healer's autonomy, which
is exactly the claim it does not support.

## Rates are derived; name the recomputation

Stored rates, rollups, and dashboards derive from the attempt records — so the
attempt record is the source of truth and every derived figure names how it is
recomputed from those records (law: derivation-names-recomputation). When the
dashboard says 74% and the operator's ad-hoc query says 60%, an invokable
recomputation is the arbiter; without it the discrepancy is a standoff between
two numbers. This also future-proofs the inevitable predicate revision: outcomes
recorded under predicate v1 must not silently pool with v2 — the epoch rides on
the record, exactly like the diagnosis layer's signature versioning.

## The loop must actually close

The ledger's consumers, enumerated — because a ledger nobody reads is overhead,
not accounting:

1. **The selection tree**, at read time: demoted cells are skipped mechanically
   (see strategy-selection).
2. **Operators**, on a surface that leads with the cells needing decisions:
   collapsed rates, unknown-heavy strategies, promotion candidates.
3. **The promotion pipeline**: futility (attempts high, confirmations absent) is
   a first-class promotion trigger (see incident-promotion).

## Decision rules

- **Record the attempt before applying the fix.** An attempt record written
  after success is survivorship bias built into the schema — the crashed heal
  vanishes, and the crashed heals are the interesting ones.
- **The in-flight state names its reaper.** Between "fix applied" and "outcome
  observed" the attempt sits in a pending state — and a crash in that gap
  leaves it pending forever, silently lying about healing progress. Pending
  gets a TTL swept by a scheduled tick that runs regardless of whether any new
  failure ever arrives; an opportunistic sweep that only fires on the next
  healing pass never reaps the last patient. TTL expiry is its own recorded
  exit with its own reason, distinct from an observed failure.
- **Outcome transitions are compare-and-swap, and a lost swap is an error.**
  Confirming an attempt that is no longer pending must fail loudly, not no-op:
  no other actor records that outcome on this caller's behalf, so a swallowed
  lost race is a confirmation that silently never happened — the ledger's
  version of the commit that didn't land.
- **Reverted is not a scandal, it is a datum.** A strategy with occasional
  reversions and honest confirmation beats one with a perfect record and an
  unknown share of 90%. Rank strategies by confirmed rate *with unknown share
  displayed beside it*, never by confirmed-over-resolved alone.
- **Mind measurement asymmetry.** Strategies whose confirmations are easy to
  observe will look better than strategies healing rarely-re-executed subjects,
  independent of merit. Before comparing cells, compare their unknown shares;
  a rate difference between cells with wildly different observability is noise
  wearing a ranking.
- **Account the do-nothing strategy too.** Its "outcome" is what happened
  without intervention — the closest thing the ledger has to a control group,
  and the honest baseline for the claim that healing helps at all.
