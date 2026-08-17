# Golden path — Session delta digest

> Situation node: `product-surfaces/monitoring-surfaces/session-delta-digest` ·
> [situation spine](../situation-spine.md) · recurrence 4 · risk **medium** ·
> sides: **client** · convergence: **converged** ·
> dimensions: **function · ui**
> Composed 2026-08-17 against `master` @ `6c97502d3`, re-verified at `c7c153b57`.
> **Short form** (Mode-2
> tiering: recurrence 4) — spine header, §0, §2, §7, §9, §12. The quality core is
> unchanged: two implementations of every count, a positive control, private-registry
> validation, hand-verified precision.
> Mode-2 batch (`product-surfaces/monitoring-surfaces`), shared measurement pass
> with [`usage-analytics`](./usage-analytics.md) and
> [`dev-only-diagnostics`](./dev-only-diagnostics.md).
>
> **Sweep.** Both digest engines in the tree, read in full. Backend:
> `src-tauri/src/engine/project_tracking/` — `consolidator.rs` (528),
> `push.rs` (324), `scheduler.rs` (193), `subscription.rs` (236), `pulse.rs`
> (182), `events.rs` (109), `mod.rs` (102), `watchers/{git,ledger,obsidian}.rs`
> — plus `commands/companion/project_tracking.rs` (112),
> `src/api/companion/projectTracking.ts`, `features/plugins/companion/sub_setup/SetupPanel.tsx`
> and `companion/prompt.rs:1960-2020` (the pulse's only consumer). Frontend:
> `features/home/sub_welcome/lib/sinceLeftBriefing.ts` (158),
> `stores/slices/overview/homeSpineSlice.ts`, `homeSpineWindows.ts`,
> `alertSlice.ts`.
>
> **Measured by executing, not by reading.** Read-only copies of both live
> SQLite files (`personas.db` 347,054,080 B, `personas_data.db` 17,502,208 B,
> copied 2026-08-17 16:37 with their `-wal`/`-shm`; the live files were never
> opened for write; **copies deleted after the run**). Every count below was
> taken through **two independent drivers** — the `sqlite3` CLI and
> `better-sqlite3` (`readonly: true`) — which agree. The 500-row sample cap was
> tested against the install's real `created_at` distribution rather than
> reasoned about. The census candidate and its positive control were run in a
> private scratch registry; the full registry was **not** run.

---

## 0. The headline

**The engine built to answer "what changed while you were away" has produced
zero digests, from zero events, for ten subscribed projects, over 99 days — and
it structurally cannot produce one, because it has two enable gates and neither
can be set in a way that survives.**

Measured on a copy of `personas_data.db`, both drivers agreeing:

| | |
| --- | ---: |
| `engine_project_pulse` rows | **0** |
| `engine_cli_event` rows | **0** |
| `dev_tools_project_subscription` rows | **10** |
| …with `enabled = 1` | **0** |
| …with a non-null `last_pulse_at` | **0** |
| `companion_known_project` rows | **10** |
| subscription rows created | **2026-05-10 → 2026-07-28** (99 days before this composition) |

Two gates stand between a registered project and a digest, and both must be true
at the same moment:

1. **Per-project** — `subscription::list_enabled` (`subscription.rs:46`) reads
   `WHERE s.enabled = 1`, and `push.rs:252` short-circuits on `!sub.enabled`. The
   column is `INTEGER NOT NULL DEFAULT 0`, rows are auto-created at that default,
   and the only writer is the Tauri command `project_tracking_set_subscription`
   (`commands/companion/project_tracking.rs:31`). Its API wrapper
   `projectTrackingSetSubscription` (`api/companion/projectTracking.ts:18`) has
   **zero consumers in `src/`**. So does `projectTrackingListSubscriptions`, and
   so does `projectTrackingGetObsidianVault` — **3 of the 6 wrappers in that file
   have no caller**, and they are exactly the three that would let a user flip the
   gate. The docstrings say the UI exists: *"Disabled projects appear too — the
   editor needs to render them so the user can flip the enable toggle"* (`:5-8`)
   and *"Used by the Dev Tools edit form when the user toggles a watch flag"*
   (`project_tracking.rs:28-29`). There is no such editor and no such form.

2. **Master** — `ProjectTracker.enabled` is
   `Arc::new(AtomicBool::new(false))` (`mod.rs:63`), flipped by
   `set_enabled` (`:89`) from `project_tracking_set_master_enabled`, wired to a
   real toggle in `SetupPanel.tsx:68-85`. It is **never persisted and never
   hydrated**: `app_settings` holds no `project_tracking` key (queried on the
   copy: zero rows matching `%track%` or `%pulse%`), and nothing reads a stored
   value at boot. `SetupPanel` hydrates the switch from
   `projectTrackingIsMasterEnabled()` on mount — which reads the same in-memory
   `false` — so the UI faithfully shows OFF, every launch, and the user's last
   answer is simply gone.

So: **the durable gate has no writer, and the writable gate has no durability.**
Turning the master toggle on fires `projectTrackingRunNow()` as a first-run
backfill (`SetupPanel.tsx:77`), which calls `run_tick`, which calls
`list_enabled`, which returns zero rows — for the same reason the hourly loop
does. The scheduler has been ticking every 3,600 seconds (`scheduler.rs:38`)
since May, short-circuiting at `:61` on a flag nobody could leave set.

Everything downstream is correspondingly untested by any execution: the Sonnet
consolidator, its prompt builder, its envelope parser, the deliberate
stamp-the-watermark-before-the-await at `push.rs:301-315`, the `pulse-updated`
Tauri event, the episodic append, and the one consumer at
`companion/prompt.rs:1978` that would inject the digest into Athena's chat
context. Approximately 1,800 lines of finished, careful, commented Rust with a
**zero-row** production history.

**And the app's other digest — the one that works — counts from a sample and
does not say so.** `useSinceLeftBriefing` (`sinceLeftBriefing.ts`) is a good
design: a pure delta function, an anchor frozen at first render before the
heartbeat advances it, a quiet first run. Its runs line is computed by filtering
`homeRunsSample`, which is `listAllExecutions(RUNS_SAMPLE_LIMIT)` with
`RUNS_SAMPLE_LIMIT = 500` (`homeSpineSlice.ts:47,109`). Replayed against this
install's real 2,188 execution timestamps: the **shortest interval containing 501
runs is 53.4 hours**. An absence of **2.23 days** is enough for "4 runs since you
left" to become a number bounded by the fetch, and the worst seven-day window
holds **1,158** runs against a ceiling of 500 — a briefing that would say "500"
where the truth is 1,158, with no "+more" and no cap disclosure.

---

## 2. The one way (compact)

**Anchor the delta on a durable mark, compute it from a count the source
computed, and make the digest's own liveness observable — because a digest that
never runs and a period in which nothing happened are the same silence.**

Concretely, six clauses:

**(a) One gate, and it is durable.** If a subsystem can be turned on, the answer
lives in the same store as the data it governs, is read at boot, and is the
*only* gate. Two gates means the product of two failure modes and a state
(`master ON`, `per-project OFF`) that renders as "nothing happened". If you need
a process-lifetime mirror of the answer for a hot loop, hydrate it from the
durable copy at startup and treat the atomic as a cache, never as the record.

**(b) Ship the writer with the reader.** A gate whose only writer is a command
with no UI is a gate stuck at its default forever. Before merging the engine,
grep your own API wrappers for consumers; a wrapper with zero callers is the
feature's most reliable liveness test and costs one command to run.

**(c) Ask the source for the count.** A "since X" figure must come from a query
the source evaluated (`COUNT(*) WHERE created_at > ?`), not from filtering an
array you happen to be holding. If you must filter a held array, the array's
fetch limit is your ceiling and the pixel must say so — *"500+ runs"*, not
*"500 runs"*. This is
[`aggregate-count-display`](./aggregate-count-display.md)'s prescription and it
binds hardest here, because a delta's whole job is to be a count.

**(d) Advance the watermark from observed data, not from the clock.** Take the
maximum timestamp among the rows you actually consumed. A clock read after an
await skips everything created during it; a clock read *before* the await (the
weaker correct form) merely repeats work. Four of this repo's six watermarks
already do the durable thing — see
[`sync-reconciliation-and-conflicts`](./sync-reconciliation-and-conflicts.md).

**(e) Separate what accumulates from what is replaced.** A digest is usually two
things with different update semantics: counters that add up over a period, and
prose that supersedes. Store them so a reader can tell which is which, and never
let a per-tick number be read as a per-period one.

**(f) Make silence falsifiable.** Persist the digest's own last-run mark, and
give the surface a way to say *"no digest yet"* distinct from *"nothing
happened"*. Without it — and this is the case above — 99 days of total
inactivity is indistinguishable from a quiet week, from inside the product and
from inside its database.

---

## 7. Deviations

### D1 — Two enable gates, and their intersection is empty by construction

Covered in §0 with the numbers. The structural statement: the durable gate
(`dev_tools_project_subscription.enabled`, `DEFAULT 0`) has **no writer reachable
by a user**, and the writable gate (`ProjectTracker.enabled`, an `AtomicBool`)
has **no durability**. Both are required (`scheduler.rs:61` and
`subscription.rs:46`), so the conjunction is unreachable across a restart and, in
practice, unreachable at all.

Neither half is a mistake in isolation. The atomic is deliberate and documented
— *"This avoids the lifecycle complexity of replacing an `Option<Arc<...>>` at
runtime"* (`mod.rs:46-50`) — and it is the right shape for a hot-loop read. What
is missing is the sentence that says where the durable copy lives. There isn't
one.

**Note, not applied.** Persisting the master flag and hydrating it at boot would
start an LLM-calling background loop on a live install. That is exactly the
runbook's "anything whose first run changes what the app does while the operator
is watching".

### D2 — Three of six API wrappers have no consumer, and they are the three that matter

Measured over `src/`, excluding the wrapper file itself:

| wrapper | consumers |
| --- | ---: |
| `projectTrackingListSubscriptions` | **0** |
| `projectTrackingSetSubscription` | **0** |
| `projectTrackingGetObsidianVault` | **0** |
| `projectTrackingSetMasterEnabled` | 1 (`SetupPanel.tsx`) |
| `projectTrackingIsMasterEnabled` | 1 (`SetupPanel.tsx`) |
| `projectTrackingRunNow` | 1 (`SetupPanel.tsx`) |

All six Tauri commands are registered (`lib.rs:2996-3001`), all six are
`require_auth_sync`-guarded, all six work. The three with no consumer are the
per-project editor's whole surface — the enable toggle, the watch flags, and the
Obsidian vault path whose watcher (`watchers/obsidian.rs`, 177 lines) is gated on
it.

This is the leaf's cheapest available liveness test and nothing runs it. A
wrapper with zero importers is not a lint finding; it is a feature reporting that
its user interface was never built.

### D3 — `TickSnapshot.project_name` is computed at both call sites and read at neither

`TickSnapshot` (`consolidator.rs:65-70`) declares `pub project_name: String`.
Both constructors compute it from the subscription's path basename —
`push.rs:293-299` and `scheduler.rs:173-179`, six identical lines each. Then
`run_for_project` ignores the field and re-queries:

```rust
let project_name = lookup_project_name(pool, &sub.project_id)?;   // :129
let prompt = build_prompt(&project_name, prior.as_ref(), &snapshot);
```

`git grep project_name` across the whole module confirms **no read** of
`snapshot.project_name`. Twelve lines of duplicated derivation feeding a dead
`pub` field.

It is not merely dead — it is a **second, disagreeing answer** to "what is this
project called". `lookup_project_name` reads `companion_known_project.name`; the
basename derivation reads the last path segment; and the pulse's only consumer
(`companion/prompt.rs:1980-1985`) uses the **basename** form again. So a project
whose registered `name` differs from its directory name would be labelled one way
in the prompt the model sees and the other way in the block injected into chat,
from the same row.

**Applied? No — reported.** Deleting a `pub` field is a public-surface change in
a crate the batch does not own, and the campaign's rule is to note rather than
edit outside a leaf's own certainty.

### D4 — The delta counts what it is holding, and the cap bites after 2.23 days

`sinceLeftBriefing.ts:59-69`:

```ts
if (input.runs) {
  let runs = 0, failed = 0;
  for (const r of input.runs) {
    const ts = Date.parse(r.created_at);
    if (Number.isNaN(ts) || ts <= lastSeen) continue;
    runs++; if (r.status === 'failed') failed++;
  }
  if (runs > 0) lines.push({ kind: 'runs', count: runs, failed });
}
```

`input.runs` is `homeRunsSample`, filled by
`listAllExecutions(RUNS_SAMPLE_LIMIT)` with the limit at
`homeSpineSlice.ts:47` = **500**. The count is therefore
`min(true delta, 500 − runs newer than the sample's own window)`, and the
briefing renders it as a plain number.

Replayed against the install's real distribution (2,188 rows, both drivers
agreeing):

| | |
| --- | ---: |
| shortest interval containing 501 runs | **53.4 h = 2.23 days** |
| max runs in any 24 h window | **317** |
| max runs in any 7-day window | **1,158** |
| 24 h windows exceeding 500 | **0 of 2,188** |

So the daily case is safe on this install and the multi-day case is not: a
long-weekend absence under-reports, and a week's absence would render **500**
where the truth is **1,158**. The alerts line has the same shape via
`alertHistory` (a bounded history fetch) — untestable here, because
`fired_alerts` holds **0 rows**, which is itself worth recording: the briefing's
second of three lines has never had a value to show.

The fix is (c): a `count_executions_since(ts)` door beside the list door, or —
minimally and honestly — `"500+"` on the pixel. This is a *distinct* instance of
[`aggregate-count-display`](./aggregate-count-display.md)'s condition, not one it
already lists; its D1–D10 do not name this file.

### D5 — The anchor is durable, the digest's own liveness is not

`sinceLeftBriefing.ts` gets the hard part right: the anchor is read once with
`useState(() => readLastSeen())` (`:115`) **before** the heartbeat effect
advances the stored value, so the displayed delta is against the previous
session's end rather than against now. That ordering is the single most common
bug in this situation and this file does not have it.

What it does not have is any record that a briefing was *produced*. `visible` is
`!dismissed && !firstRun && lines.length > 0` (`:156`); a session that showed
nothing and a session where the hook never mounted are the same. Combined with
D1 — where 99 days of a whole subsystem's silence is likewise unrecorded — this
is the leaf's recurring shape: **the absence of a digest is the same observation
as a digest of nothing.**

`writeLastSeen` also advances on a 60-second heartbeat while the Home surface is
mounted (`:133-135`) *and* on dismiss (`:152`). That is correct for "the user has
seen up to here" and worth naming, because the tempting simplification — advance
only on unmount — loses the mark when the process dies, which on a desktop shell
is the common exit.

### D6 — The watermark is a clock read, deliberately, and the comment is the best artifact in the module

`push.rs:301-315`:

```rust
// Stamp the watermark BEFORE the await, not after.
//
// `run_for_project` performs an LLM consolidation, so it can take many
// seconds. Reading the clock afterwards advanced the watermark past
// everything created *during* that call — events that were never in
// `events`, and that the next tick will therefore never look at. Not a
// delay: a permanent skip, sized by however long the model took.
//
// This is the weaker of the two correct forms. The durable fix is to
// advance from OBSERVED DATA — the max timestamp among the events actually
// consumed — which is what four of the six watermarks in this repo already
// do, and which cannot skip a row by construction. …
let consumed_through = chrono::Utc::now();
```

Listed as a deviation because clause (d) is not satisfied, and listed *with its
comment* because the comment already contains the analysis, the alternative, the
population count, and the reason the durable form is blocked (`TickSnapshot`
does not carry event timestamps). The finding belongs to
[`sync-reconciliation-and-conflicts`](./sync-reconciliation-and-conflicts.md)
(*"the best-documented safe advance in all six repos and a wall-clock advance sit
110 lines apart in one Personas file"*) and is cited, not re-derived.

One thing has moved. That path cites **`push.rs:306`**; the statement is at
**`:315`** today, because the fourteen-line comment above it — which names that
very document — was inserted afterwards. A citation displaced by the edit it
caused. §12.

### D7 — The digest's counters accumulate and its prose replaces, in one row, undistinguished

`pulse::upsert_today` takes `commit_count_delta`, `run_count_delta`,
`note_count_delta`, `tokens_in_delta`, `tokens_out_delta` (`consolidator.rs:156-168`)
— per-tick increments summed into a day row — while `narrative_md`,
`directions_json` and `tensions_json` are **replaced** by the model's latest
envelope. Both live in `engine_project_pulse` with no marker of which is which.

A reader of the row (there is one: `companion/prompt.rs:1978` via
`load_today`) sees "12 commits, 4 runs" beside a narrative that describes only
the *last* tick's new signals merged into the prior narrative. The numbers are
the day; the prose is the increment. Clause (e).

The same confusion is written into episodic memory as a claim: the episode body
at `consolidator.rs:197-204` says *"pulse refreshed ({commits} commits, {runs}
runs)"* using the **per-tick** counts, and appends it under `DEFAULT_SESSION_ID`
— one global session, so every project's per-tick line lands in the same stream
that the chat-history retrieval path reads back as "what happened".

And the two token figures in that row are estimates typed as measurements —
`prompt.len() / 4` and the envelope's character count / 4 (`:149-154`), stored in
columns named `tokens_in` / `tokens_out` beside `commit_count` and `run_count`.
The code says so honestly in a comment (*"cost-tracking, not billing —
order-of-magnitude is enough"*); the schema does not.

### D8 — Cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"The push endpoint's debounce is broken."** False.
  `check_and_record_debounce` (`push.rs:211-228`) is correct, poison-tolerant
  (`Err(p) => p.into_inner()`), and per-project at 300 s.
- **"The consolidator re-feeds an already-consolidated window."** False, and it
  *was* true: `push.rs:256-266` documents the fix from a fixed 24 h window to the
  subscription watermark, and names the symptom it caused (*"the day's
  commit/run/note/token counters inflated monotonically with each push"*).
- **"`sinceLeftBriefing` advances its anchor before reading it."** False. `:115`
  freezes the anchor in a `useState` initialiser, ahead of the effect at `:132`.
  This is the bug the situation is famous for and this file does not have it.
- **"The pulse consumer has no cap disclosure."** False.
  `companion/prompt.rs:2014-2018` emits *"…and N more tracked project(s) — ask for
  them by name."* after a cap of 5 — the disclosure that
  [`entity-picker`](./entity-picker.md) found 0 of 3 siblings writing for
  pickers. Personas writes it here.
- **"The scheduler leaks work across app instances."** False.
  `scheduler.rs:66-70` checks `is_engine_leader` after the enable gate, with the
  ordering rationale in a comment.

---

## 9. The missing gate

**This path declines to add a census rule, with numbers.** The condition it would
have gated — *a subsystem's enable answer is held only in process memory, so the
user's answer dies with the process while the durable rows it governs keep saying
no* — was measured, and the pattern cannot separate it from three legitimate
neighbours.

### 9.1 Rules checked first

`settings-bool-by-string-compare` (15 files / 18,
[`app-settings-store`](./app-settings-store.md)) — a stored setting turned back
into a bool by comparing raw TEXT; adjacent, opposite direction (it is about a
setting that *is* durable). `process-global-suppression-ledger` (8 / 12,
[`alert-dedupe-and-cooldown`](./alert-dedupe-and-cooldown.md)) — alarm state in
process memory; the same *shape*, a different subject, and its pattern requires a
`OnceLock<Mutex<HashMap<…>>>`, which no site here has.
`discarded-sync-watermark-write` (4 / 11) — owns D6's family.
`module-scope-install-latch` (13 / 13) — the TypeScript one-way latch.
`absent-entity-count-as-zero` (30 / 40) — closest to D4, but keys on a map lookup
defaulted to 0, which D4 is not: the briefing's count is a loop, not a lookup.
None covers the condition.

### 9.2 The candidate, measured twice, refused

**First form** — anchored on `#[tauri::command]` reaching a `.store(<param>,
Ordering::…)` within 900 characters. Result: **0 files, 0 matches**, over 950
Rust files. Structurally zero, and the reason is worth keeping: the setters are
plain `pub fn`s that the commands *call* (`stale.rs:135`
`set_auto_hibernate`, `mod.rs:89` `set_enabled`), so the attribute is never in
the same window as the store. An anchor chosen from the mental model rather than
from the tree — doctrine's *"derive the word list from the tree… or the same
guess distorts both ends of the measurement."*

**Second form** — a `pub fn set_*` whose body stores a **non-literal** value into
an atomic. The literal/non-literal split is the real discriminator, and it is a
good one: a literal (`ARMED.store(true, …)`) is the process describing its own
state; an identifier is *somebody else's answer* arriving from outside. Run in a
private scratch registry (full registry not run):

```
preference-stored-only-in-process-memory                     4 files /  6 matches
preference-stored-only-in-process-memory-positive-control   28 files / 52 matches
walked 950 files, floor 900
```

The control — a `pub fn set_*` that reaches a durable write (`settings::set`,
`set_app_setting`, `UPDATE`, `INSERT`) — returns **52 matches in 28 files**, a
~9× separation. By separation alone this looked shippable.

**Hand-verification of all six killed it.**

| site | verdict |
| --- | --- |
| `engine/project_tracking/mod.rs:89` `set_enabled(on)` | **TRUE** — the earning case; no durable copy anywhere |
| `core/src/redact.rs:43` `set_enabled(value)` | **TRUE, differently** — its doc says *"called from the settings load path"*, and `git grep` finds its only two callers are **inside its own `#[cfg(test)]` module** (`:222`, `:226`). A hydration path that does not exist. |
| `commands/fleet/stale.rs:135` `set_auto_hibernate` | **FALSE** |
| `commands/fleet/stale.rs:155` `set_live_slots` | **FALSE** |
| `commands/fleet/stale.rs:180` `set_state_cutoffs` | **FALSE** |
| `engine/background.rs:216` `set_active(active)` | **FALSE** — runtime activity state, not a stored answer |

**Precision 2 of 6 = 33%**, below every refusal the doctrine records (22%, 44%,
≤71%).

**And the reason for the three fleet false positives is the interesting part.**
Those settings *are* durable — on the other side of the IPC boundary.
`stores/slices/system/fleetSlice.ts:226-228` holds them in the persisted system
store and **re-pushes all three on every refresh**:

```ts
fleetApi.setAutoHibernate(get().fleetAutoHibernate, get().fleetAutoHibernateMinutes)…
fleetApi.setStateCutoffs(get().fleetStaleMinutes * 60, get().fleetFrozenMinutes * 60)…
fleetApi.setLiveSlots(get().fleetLiveSlotsEnabled ? get().fleetMaxLiveSessions : 0)…
```

The Rust atomic is a **cache of a value persisted in TypeScript**. Whether a
given `.store(param, …)` is a defect turns entirely on whether some frontend
slice happens to re-push it — a fact on the far side of a serialization boundary,
in another language, that no Rust-side pattern can see. This is doctrine's fifth
"where types cannot reach" (*a value that crosses a serialization boundary*)
restated for a **census signal**: the signal is not short a term, and no
refinement recovers it, because the discriminating evidence is not in the scanned
files.

Two of the four false positives could be excluded by path with real reasons. That
would leave the excludes doing four-sixths of the discriminating, which is the
definition of a pattern that does not discriminate. Refused.

### 9.3 What would work instead — and it is a checker, not a ratchet

The census ratchets a count of something **present**. Every finding above is an
absence: a gate with no writer, a subsystem with no rows, a digest with no
liveness record. So the honest §9 is a decline plus a specification, in the
tradition of `check-csp-hosts.mjs`.

**`scripts/check-durable-toggles.mjs`**

- **Signal (this stack's manifestation).** For each `#[tauri::command]` whose
  name matches `/_set_.*_enabled$|_set_master_/`, resolve the function it
  delegates to and assert that **either** the same module reaches a durable write
  (`settings::set` / `set_app_setting` / an `UPDATE`), **or** a declared
  frontend-owned mirror exists — a named entry in a small committed manifest
  saying *which* persisted store re-pushes it, with the `file:line` of the
  re-push. The three `fleet` cases would each carry one manifest line pointing at
  `fleetSlice.ts:226-228`; `project_tracking` would have nothing to point at, and
  that is the finding.
- **Condition it is a proxy for (what travels):** *the answer to a user-facing
  on/off question has no owner that survives a restart.*
- **How it fails loudly when its own precondition is absent.** **Exit 2** if the
  scan resolves fewer than 3 enable-shaped commands, or if any manifest entry's
  cited `file:line` no longer contains a call to that command's wrapper. Without
  the second check, the manifest becomes a permanent excuse the moment the
  frontend re-push is deleted — which is exactly how a gate turns into a green
  no-op.
- **Why a manifest and not inference.** Because the durable copy is genuinely
  allowed to live in the frontend, and the only thing wrong today is that nobody
  wrote down *which* toggles rely on that and which do not. The value is the
  forced declaration, not the automation.

A second, near-free assertion belongs beside it and needs no script: **a test
that `dev_tools_project_subscription` has at least one path from a rendered
control to `enabled = 1`.** Today there is none, and no test fails.

**No fenced census rule is published by this document.** The decline is the §9.

---

## 12. Corrections to the brief

**1. The brief pointed at the mechanism and the mechanism turns out to be
unreachable — which is the finding, not a detour.** It asked for *"the
consolidator/pulse machinery (`project_tracking/push.rs` — watermark stamped
BEFORE the await, deliberately; `engine_cli_event`), digests of what changed per
session/day… measure a real digest against its source rows."* **There is no real
digest to measure.** `engine_project_pulse` and `engine_cli_event` both hold
**0 rows** across 10 subscribed projects and 99 days, and §0 traces why to two
gates whose intersection is empty. The brief's instruction was right and its
premise — that a digest exists — was not, and the reason is the document.

**2. The watermark clause was already published, and its citation has drifted
because of the edit that published it.**
[`sync-reconciliation-and-conflicts`](./sync-reconciliation-and-conflicts.md)
cites `project_tracking/push.rs:306` for the wall-clock advance and calls it
*"the sharpest single fact in the sweep."* The statement is at **`:315`** today:
the fourteen-line comment above it (`:301-314`), which names that document by
filename, was inserted afterwards and pushed the line down by nine. Correction
owed to that path, not applied here — the campaign's rule is to correct a claim
in the document that carries it, and `push.rs`'s watermark is that document's
leaf, not this one's.

**3. The batch's most useful shared measurement was negative, and it belongs
here.** The census candidate for this leaf died on a fact that is invisible from
Rust: three of its six matches are settings whose durable copy lives in a
**persisted TypeScript store that re-pushes them on refresh**
(`fleetSlice.ts:226-228`). A Rust-side pattern cannot see that, cannot be
refined to see it, and would report those three as defects forever. Recorded in
§9.2 as a serialization-boundary limit on a *census signal* — the corpus has the
same limit recorded for types five times and, as far as this composer can find,
not once for a pattern.

**4. The spine's `convergence: converged` fails, and it fails as a silence.**
Cohort established first: `personas-web` is a port and a downstream reader of
this repo's tables, `vibeman` predates it — leaving `brainiac`, `personas-cloud`,
`ascent` as the independent three. **None has a "what changed while you were
away" digest.** The `lastSeen` / `last_visit` grep hits across all five resolve to
documentation, Prisma migrations for badge impressions, and a Sentry skill file —
zero implementations. Personas has **two**, one of which (`useSinceLeftBriefing`)
is better than anything in the fleet at the part the fleet has not attempted.
Reported as a silence, per doctrine, and not promoted: nobody solving a problem
three times is evidence the problem is unattempted, not that this repo's answer
is right. **Fourteen `convergence` labels tested by the corpus, fourteen that
measurement did not support.**

**5. The spine's `sides: "client"` is contradicted — and, unusually, it is
inverted rather than incomplete.** The headline defect, all of D1, D2, D3, D6 and
D7, the census candidate, its control and its floor are **server-side Rust**. The
frontend's contribution is one 158-line hook (D4, D5) which is the *best-built*
artifact in the leaf. A composer scoped by `sides: "client"` would have found the
good code and missed a subsystem that has never run. That makes **8 leaves
contradicting `sides: "client"` against 2 upholding it**, and this one joins the
seventh in the specific mode the doctrine singles out: *sometimes `"client"` is
incomplete; sometimes it is simply inverted — say which.* This one is inverted.

**6. A note the brief did not ask for and the next composer will want.**
`useSinceLeftBriefing` is the exemplar this leaf would otherwise lack, and its
anchor-freezing (`:115`) is the non-obvious half. If any future work touches it,
the `useState(() => readLastSeen())` initialiser is load-bearing and looks like a
stylistic choice.
