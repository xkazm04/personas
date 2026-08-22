---
layer: application
subject: scheduling
technique: overlap-and-reentrancy
stack: rust
---

# Overlap & reentrancy in the Personas trigger scheduler (Rust)

How this repo realizes the overlap-and-reentrancy technique across four layers: the
per-trigger single-flight guard, CAS slot claims, orphan-loop retirement, and the
stuck-claim reaper. File references are to the desktop backend.

## 1. Single-flight, drop — with a visible signal

The scheduled-fire path implements the technique's default policy (single-flight,
drop, recorded) at `src-tauri/src/engine/background/:2545-2566`. When a `schedule`
trigger comes due while its previous run is still active, the tick:

- detects overlap via `schedule_overlap_active` (`background.rs:2199-2229`) — an
  EXISTS query over `persona_executions` in `('queued','running')` whose payload
  carries this trigger's id, OR'd with `persona_events` rows still
  `('pending','processing')` for the trigger;
- **consumes** the slot with `mark_triggered` rather than merely advancing the
  pointer — the comment at `background.rs:2532-2544` spells out the watermark
  interplay: an overlap skip is an intentional drop, so the slot must be neither
  replayed by auto-backfill nor counted as an offline miss (both key off
  `(last_triggered_at, now]`);
- emits `schedule.skipped.overlap` (`emit_overlap_skip_signal`,
  `background.rs:2260-2283`) with `reason: "previous_run_active"` into the event
  feed, so the drop is never silent.

Note the guard's *chosen failure direction* at `background.rs:2203-2206`: on a DB pool
error the check returns `false` — fail open, "better to risk a rare overlap than to
silently drop a legitimate fire on a transient pool hiccup" — with a warn log either
way.

## 2. Claims are CAS on a version column

The claim primitive is optimistic concurrency on `trigger_version`
(`src-tauri/db/src/repos/resources/triggers.rs:1773-1830`): `mark_triggered` updates
`last_triggered_at + next_trigger_at + trigger_version` guarded by
`WHERE id = ?3 AND trigger_version = ?4`, so of two ticks racing on the same due
trigger exactly one wins; `advance_schedule_pointer` gives the same CAS guarantee
while deliberately *not* moving the fired-watermark (the replayable-skip primitive).

The backfill path shows claim-before-compute (`background.rs:2617-2667`): the startup
overdue sweep and the first subscription tick both read the same
`last_triggered_at` watermark and would both publish the identical missed-slot
backlog; a `mark_triggered` CAS that only runs *after* the loop cannot prevent that.
So the code takes an `advance_schedule_pointer` claim (version bump, watermark and
schedule untouched) before enumerating slots, and the loser skips its backlog attempt
for the tick.

## 3. The scheduler's own reentrancy: generation counters

`SchedulerState.generation` (`background.rs:127-143`) exists because dropping a tokio
`JoinHandle` does not abort the task: a stop-then-restart left every previous loop
alive, and a bare `running: AtomicBool` reads `true` again after restart — the orphan
concludes it is current, and every trigger fires twice. The generation is bumped on
every start *and* stop; each loop captures it at spawn and `run_single`
(`src-tauri/src/engine/subscription/:1218-1272`) re-loads it per tick, self-retiring
when it moved on. The start transition itself is guarded by `try_begin_start`
(`background.rs:197-206`), a `compare_exchange` on `running`, closing the
two-concurrent-starts double-spawn race.

## 4. The reaper for claims without identity

Events claimed into `processing` carry no claim timestamp or holder id — the
deviation from the technique's "claim with identity" rule — so the stuck-event reaper
compensates behaviorally: a row must appear in `processing` on **two consecutive**
reap passes (`stuck_reap_seen`, `background.rs:116-122`) five minutes apart
(`STUCK_EVENT_REAP_INTERVAL`, `background.rs:1028-1038`) before being reclaimed to
`pending` or dead-lettered, because "a single snapshot cannot tell a stranded row from
one a healthy tick is processing right now". Reclaims write `stuck_reclaimed` /
`stuck_retry_exhausted` reason tokens, keeping the reaper's actions on the same
non-fire ledger as every other gate.

## What to copy, what to improve

Copy: the consume-vs-preserve watermark distinction, claim-before-compute for
catch-up, the generation counter, the fail-open comment discipline. Improve: give
`claim_pending` a claim timestamp and holder identity so the reaper can act on
evidence instead of a two-pass heuristic — the code's own comments name this exact
gap.
