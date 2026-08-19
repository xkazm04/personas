---
layer: technique
subject: sync-replication
technique: change-tracking-and-cursors
status: forged
laws: [derivation-names-recomputation, identity-survives-reuse, failure-not-empty-success]
shared_with: []
---

# Change tracking and cursors

The transfer loop of a sync engine answers two questions forever: *is
there work?* and *where did I stop?* The first is change tracking, the
second is the cursor, and the discipline for both is the same: **the
durable record is the truth; every faster signal is only an
accelerator.**

## The cursor: durable, per stream, advanced after settlement

A cursor is the loop's memory of how far transfer has settled — a
position in the source's change order, persisted in the same durable
store as the data it tracks (a cursor that outlives the data it points
into, or dies while the data survives, corrupts on restore). Three
rules:

**Per stream.** One cursor per replicated stream. A shared cursor
couples unrelated streams' fates in both directions: one stream's
failing batch pins every stream's progress (the retry re-reads and
re-sends everyone's changes), and one stream's advance can mark
another's unsent changes as done — silent skip, the worst outcome in the
subject. The cost of N cursors is N small rows; the cost of one shared
cursor is that no stream's failure is contained.

**A position, not a timestamp.** Two changes can share a clock tick, and
"strictly after the cursor" then either re-delivers or skips the
boundary's siblings depending on the comparison. A cursor is a tuple —
monotonic ordinate plus a unique identity as tiebreaker — compared as a
tuple ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
Where the source offers a genuine monotonic sequence, prefer it to wall
clocks entirely; device clocks regress, and a cursor that trusts them
inherits every regression as a re-delivery or a gap.

**Advance after settlement, never before.** The cursor moves past a
batch only when the far side has durably accepted it. Optimistic
advance converts every crash between send and settle into silent loss —
at-least-once quietly becomes at-most-once with nobody deciding it. The
corollary: crash *after* settle but *before* advance re-sends the batch,
so deliveries are idempotent by identity — the far side upserts by key,
and a duplicate is a no-op, not a second row. The cursor is the stored
derivation of "what has settled", and the loop reading past it is the
derivation's named recomputation
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)):
if the cursor is ever doubted, deleting it and re-running the loop must
reproduce it — which the idempotent-upsert rule is what makes affordable.

## The new cursor value comes from the data, never the clock

Advance the cursor to the **maximum position observed in the rows the
pass actually read** — never to "now" captured at pass start or pass
end. The clock version harbors a race that loses data permanently: a
row committed after the pass's read snapshot but stamped *before* the
captured instant falls behind the advanced cursor without ever being
read, and no later pass will return to it — the loss is silent, has no
error, and is unrecoverable from the cursor's side. The observed
maximum cannot outrun a row the pass did not read, by construction.
Two companions to the rule: the cursor *write's* failure must propagate
— a progress mark that silently failed to persist is the one fact the
next pass cannot re-derive, and swallowing that error converts a
transient storage hiccup into either replay or a stalled stream nobody
sees. And the rule must be applied at **every** cursor in the system,
not just the main one; the observed failure mode is a codebase that
fixes the race on its busiest stream, documents why, and leaves the
clock capture in a sibling stream a hundred lines away.

**The tracked column must be one every mutation touches.** A cursor
over a creation timestamp sees inserts and is blind to updates; the
patch — re-reading a trailing window of recent rows to catch in-place
mutations — is a bet that nothing mutates later than the window, and
every mutation that loses the bet is invisible to the far side forever.
If the rows mutate, the watermark column is a last-modified that every
write path updates; a window is a stopgap with a measured margin, not a
design.

## Wake channels are lossy; dirty marks are not

The loop needs a cadence, and the honest architecture layers three
mechanisms whose failure modes cover each other:

- **A periodic tick** — the floor. Runs regardless of signals; bounds
  the staleness of everything below it. A sync with no tick is a sync
  whose liveness depends on every signal arriving, which no signal
  channel promises.
- **A change wake** — the accelerator. When a local write lands, poke
  the loop so propagation is prompt rather than tick-bounded. The wake
  channel may coalesce and may drop under pressure — that is fine *by
  design*, because a missed wake costs latency, not data. (Where the
  wake originates from storage-level capture, that machinery is the
  [change-data-capture](../../realtime-events/techniques/change-data-capture.md)
  leg of the event subject; sync consumes it as a hint, never as the
  record of what changed.)
- **A persistent dirty mark** — the bridge. The *fact that unsynced work
  exists* is stored durably (a flag, or simply the comparison of cursor
  to tail), so a wake that is dropped, or a process that dies between
  write and wake, leaves the pending work discoverable by the next tick.
  The wake is allowed to be lossy only because the dirty mark is not.

The anti-pattern is collapsing the layers: a loop driven only by wakes
loses whatever the channel loses; a loop driven only by ticks makes
every edit wait; a dirty mark held only in memory silently forgets
pending work across restart. All three, each doing the one job its
guarantees actually support.

## The first run is a different animal

A stream's first sync — and every re-enable after a long gap, and every
cursor reset — faces the entire retained history, not an increment. Run
it through the increment path and the loop built for tens of changes
meets tens of thousands: timeouts, memory spikes, a far side rate-limiting
the flood, and a cursor that never advances because the one giant batch
never wholly settles. Backfill is therefore **explicit and bounded**:
chunked into batches each of which settles and advances the cursor
independently, resumable at any chunk boundary, and rate-shaped for the
far side. The cursor makes partial progress safe by construction — a
backfill interrupted at chunk 40 of 100 resumes at 41, which is exactly
the restart property the increment loop already has. The design test: a
fresh replica pointed at a decade of history must converge without any
code path the daily loop does not also exercise, only more times.

## Distinguish "nothing to do" from "could not look"

A loop pass that finds zero pending changes and a loop pass that failed
to read the change record must produce different observable outcomes —
different status, different log shape, different effect on the "last
success" clock ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The lying version — swallow the read error, report an uneventful pass —
is how a broken stream shows weeks of green while its lag grows
unbounded. The cursor's stillness is only meaningful against the tail's
stillness; report both, and let the gap be the alarm.
