# Golden path — Schedule calendar

> Situation node: `backend-runtime` › `scheduling-and-triggers` › `schedule-calendar` ·
> [situation spine](../situation-spine.md) · recurrence **3** · risk **high** ·
> sides: **client** (**upheld** — see [§12.1](#121--sides-client-holds-and-the-mechanism-is-worth-naming)) ·
> convergence: **converged** (tested — **fails**, see [§10](#10-convergence)) ·
> dimensions: **ui · function · performance · resilience**
> Composed 2026-08-17 against `master` @ `52b0a6ba8`.
>
> **Sweep size.** All **21** files / **4,524** lines of `src/features/schedules/` read in full.
> All **4,801** `.ts`/`.tsx` under `src/` walked **four** times — twice for the day-bucket census
> rule and its positive control (once by the census engine, once by an independent line-scanner),
> once for the neighbouring `host-locale-date-render` site set, once for the
> `getHours/getDate/getDay/getMonth/getFullYear` accessor population. Server side:
> `src-tauri/src/commands/tools/triggers.rs:1585-1660` (`list_recent_schedule_runs`),
> `src-tauri/core/src/scheduler.rs` in full, `src-tauri/src/engine/background.rs:1840-2900`.
>
> **Measured by execution, not by reading.** `bucketByDay`
> (`ScheduleRowHistoryPanel.tsx:157-186`) was extracted **verbatim** and replayed against a
> read-only copy of the **2026-08-17 purge backup**
> (`%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`, 347,054,080 B) at three
> host offsets — `Europe/Prague` (the operator's machine, UTC+2), `UTC`, and `Asia/Tokyo` (UTC+9).
> `get_due` was replayed verbatim. **Row counts below are historical as of 2026-08-17 and are not
> reproducible against the live database**, which the operator purged the same day (all 351
> triggers, all 78 personas, all 2,188 executions). The copy was deleted.
>
> **`cargo` was not run.** Every Rust claim is static or replayed in SQL.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five walked. Effective independent cohort: **4**
> (`brainiac`'s hits are all compiled `.next-build` bundles).
>
> **Settles:** which zone a fire time is drawn in, what a past slot is allowed to assert, what the
> grid does while its data is in flight, and where the week starts.

---

## 0. The headline

**Replayed verbatim against the operator's own executions on the operator's own machine, the
schedules feature's day-strip plots 36 of 46 runs under the wrong day and drops 4 of 50 entirely.
Run the identical code on a UTC host and it is exact: 0 mis-plotted, 0 dropped.**

`bucketByDay` (`ScheduleRowHistoryPanel.tsx:157-186`) builds its buckets from **host-local
midnight** and keys them by **UTC date**:

```ts
const start = new Date();
start.setHours(0, 0, 0, 0);                       // :161  host midnight
…
  dateKey:   d.toISOString().slice(0, 10),        // :165  UTC date of that instant
  dateLabel: d.toLocaleDateString(undefined, …),  // :166  host-local date of that instant
…
const key = new Date(tsRaw).toISOString().slice(0, 10);  // :176  UTC date of the run
```

On any host east of Greenwich, `dateKey` and `dateLabel` describe **different days** — the bucket
keyed `2026-06-15` is labelled *"Jun 16"* — and a run matches a bucket only when its UTC date equals
the *previous* label's day. Measured on `Europe/Prague` against the busiest persona's 50 runs:

| host | buckets mis-labelled | runs plotted under a label that is not their local day | runs dropped |
|---|---|---|---|
| `UTC` | 0 of 14 | **0 of 50** | **0** |
| `Europe/Prague` (UTC+2) | **14 of 14** | **36 of 46** | **4 of 50** |
| `Asia/Tokyo` (UTC+9) | **14 of 14** | **36 of 46** | **4 of 50** |

Ground truth (local calendar days) is `Jun 12 = 6, Jun 13 = 17, Jun 14 = 12, Jun 15 = 11,
Jun 16 = 4`. The panel draws `Jun 13 = 15, Jun 14 = 9, Jun 15 = 11, Jun 16 = 11`, nothing at all for
Jun 12, and a total of 46 where there are 50. The dropped four are the most recent day's runs after
02:00 local — their UTC key names a day no bucket claims.

**This is the doctrine's "reproduces on one machine and not another", relocated to the viewer.** It
is invisible in CI, invisible on a UTC server, and wrong for every user east of Greenwich, in
proportion to their offset.

**The second headline is that the calendar draws a schedule's fires in a zone the schedule does not
use, and labels them with a third one.** Every event is placed by `ev.time.getHours()` and
`dayKey(ev.time)` — the **viewer's** zone (`calendarHelpers.ts:113-117,153-155`). The schedule's own
`agent.timezone` is passed to the backend to *compute* the fire times
(`useCronPreview.ts:107`) and is then never shown. The chip beside the cron expression
(`ScheduleRow.tsx:157`) renders `tzLabel`, derived from `useThemeStore(s => s.timezone)` — the
**app-wide display preference**. So a cron authored `0 9 * * *` in `America/New_York`, viewed from
Prague with the display setting on UTC, appears in the 13:00 row under a chip reading "UTC", and the
string "America/New_York" appears nowhere on the screen. Three zones, one row, none of them named.

Across the whole client, **`timeZone:` is passed to a formatter in 3 files of 4,801.**

---

## Principle (stack-free head)

A schedule calendar is a **claim about two different things at once**: where a fire *will* land, and
what happened when one *did*. They fail differently and must be built differently.

1. **The projection is the engine's to compute, never the client's.** Recurrence semantics — step
   syntax, zone resolution, DST, deterministic spread — live in exactly one implementation, and it
   is the one that fires. A client that re-derives them draws a schedule that does not exist.
2. **A grid cell is a claim about a zone.** Placing a moment in a row or a column requires choosing
   whose midnight and whose hour. The only defensible choice is the **entity's own** zone, and
   whichever you choose you must **name it on screen**, because the user cannot infer it from a
   number.
3. **A past cell may only assert what a record supports.** Bind each past slot to a real run within
   a tolerance; a slot with no run is *unknown*, never a success. "We don't know" is a first-class
   outcome and must be drawn as one.
4. **Say what you cannot see.** A history window bounded by the backend is a hole in the picture; a
   calendar that silently renders that hole as "unknown" has converted a missing query into a
   claimed fact about the world.
5. **The grid is permanent chrome.** A fetch changes what is *in* the cells, never whether the
   cells exist. Rows already drawn survive a refetch; a first load shows a ghost under the grid, not
   a spinner and not an empty grid.
6. **The week starts where the reader's locale says it starts.** A hardcoded Sunday is a hardcoded
   language.
7. **Two fires at the same minute is a fact about the schedule, not about the render.** Compute
   overlap over the unfiltered set so a display filter cannot make a real conflict disappear.

---

## 1. Trigger

- "show me everything that's scheduled this week"
- "which agents collide at 9am?"
- "did last Tuesday's run actually happen?"
- "put the fires on a calendar"
- "why does the calendar say 15:00 when I set it to 9?"
- **The test:** if you are about to place a timestamp into a row, a column, a bucket, or a
  `YYYY-MM-DD` key — you are here, whether the surface is called a calendar, a timeline, a heatmap,
  a sparkline or a day strip.

---

## 2. The one way

**Ask the engine for the fire times, place them in the entity's zone, name that zone on screen,
assert nothing about a past slot you cannot bind to a record, and keep the grid mounted while the
data moves.** Concretely: (a) fetch projections through `cron_fire_times_in_range`, seeded with the
trigger id so the deterministic `H`-token spread matches what will actually fire — never parse a
cron expression in the client; (b) for interval cadences, walk from the engine's own anchor
(`next_trigger_at`), not from the window start, and return nothing when there is no anchor rather
than inventing a phase; (c) **derive every bucket key and every cell coordinate through a formatter
that names a zone** (`Intl.DateTimeFormat(locale, { timeZone })`), and use one zone consistently
for keys, labels and headers — the failure in §0 is not that the wrong zone was chosen but that
*two* were, fifteen lines apart; (d) render the zone next to the times, taken from the entity, not
from a display preference; (e) bind past slots to real runs with a tolerance capped at half the gap
to the neighbouring slot, and leave unmatched slots visibly *unknown*; (f) when the history query is
bounded, draw the boundary — a calendar that reaches past its own data must say so rather than
render the gap as unknown outcomes; (g) render the toolbar, the day headers and the empty grid
unconditionally, and let the loading flag decide only what fills the cells; (h) compute conflicts
over the unfiltered event set so a legend toggle cannot hide one.

**Where projection and history disagree, prefer showing less.** A drawn cell is a claim; an absent
cell is an invitation to look.

---

## 3. Mandated primitives

| primitive | path | what it gives you |
|---|---|---|
| `cronFireTimesInRange(expr, tz, start, end, max, seed)` | `src/api/pipeline/triggers.ts` → `commands/tools/triggers.rs` | engine-computed fire times: real step semantics, real zone resolution, real DST, and the same `seed_hash(trigger.id)` spread the scheduler uses |
| `useCalendarEvents(entries, start, end)` | `src/features/schedules/libs/useCronPreview.ts:56` | the whole orchestration — per-entry projection, run-history fetch, past/future split, stale-response discard via a request-id ref, and an effect keyed on a **value signature** rather than array identity |
| `generateIntervalFireTimes(secs, anchorIso, start, end, max)` | `…/useCronPreview.ts:226` | interval projection anchored on `next_trigger_at`, mirroring `next_interval_at`. Returns `[]` when the anchor is null — it will not invent a phase |
| `matchPastSlotsToRuns(slotTimes, runs, baseToleranceMs)` | `src/features/schedules/libs/calendarHelpers.ts:334` | per-slot binding to real runs; tolerance capped at half the neighbour gap; each run binds at most one slot; unmatched stays `past-unknown` |
| `classifyRunOutcome(status)` | `…/calendarHelpers.ts:308` | terminal-only mapping — `queued`/`running` resolve to `past-unknown`, not to a guess |
| `detectConflicts(events)` | `…/calendarHelpers.ts:206` | O(n) sweep over chained 5-minute windows, each event finalized once |
| `display/Tooltip` · `display/AbsoluteTime` · `display/RelativeTime` | `src/features/shared/components/display/` | the sanctioned hover text and moment renderers |
| `layout/RouteChunkSkeleton` · `UnifiedTable`'s `isLoading` | `src/features/shared/components/` | the sanctioned loading shapes ([`overview-loading`](../../design/overview-loading.md)) |

**Do NOT build:** a client-side cron parser. One existed and was deleted on 2026-05-01 for drifting
from the engine (it accepted `*/100 * * * *`, which the engine rejects); the two comment blocks
recording that decision (`calendarHelpers.ts:80-91`, `useCronPreview.ts:12-21`) are the strongest
"do not rebuild this" markers in the feature and should be left in place.

---

## 4. Steps

1. **Pick the window** (`getWeekRange` / `getMonthRange`, `calendarHelpers.ts:61,70`) and pad the
   month grid to whole weeks.
2. **Project per entry.** Cron → `cronFireTimesInRange(expr, agent.timezone ?? undefined, start,
   end, 500, agent.trigger_id)`. Interval → `generateIntervalFireTimes(secs, agent.next_trigger_at,
   …)`. Paused entries contribute nothing.
3. **Split at `now`** into `future` (projected) and `pastCron` (nominal slots awaiting proof).
4. **Fetch history only when the window reaches into the past**, bounded to the command's cap, and
   discard stale responses by request id (`useCronPreview.ts:139-162`).
5. **Bind, do not assume.** `matchPastSlotsToRuns` per trigger; unmatched → `past-unknown`. For
   interval triggers, contribute the *real runs* as past events rather than a fabricated nominal
   walk — their past cadence cannot be reconstructed after downtime drift.
6. **Compute conflicts over the unfiltered set**, then apply legend filters to what is drawn
   (`ScheduleCalendar.tsx:66-75`). This ordering is the whole reason a toggle cannot lie.
7. **Place each event by the schedule's zone**, and label the axis with it. *(This is the step the
   repo does not take — §7 D1.)*
8. **Render the toolbar, the headers and the grid unconditionally**; let `loading` decide only
   whether a ghost sits under the cells. *(§7 D3.)*
9. **And then stop.** Clicking a cell routes: a bound past run opens its execution; a projected or
   unknown slot opens the trigger (`ScheduleCalendar.tsx:105-113`). The calendar does not own
   detail rendering.

---

## 5. Anti-patterns

**Two definitions of "a day" in one function.** `bucketByDay` uses host midnight for the axis and
UTC dates for the keys. Neither choice is indefensible; *holding both* is. The tell is a
`setHours(0,0,0,0)` and a `toISOString().slice(0,10)` in the same scope.

**Labelling a time with a zone it was not computed in.** `ScheduleRow.tsx:157` renders the
app-display-preference zone under a condition that tests for a cron expression. The user reads it as
"this cron runs in this zone".

**Deriving a bucket from `Date` field accessors.** `getHours()`, `getDate()`, `getDay()`,
`getMonth()`, `getFullYear()` all answer *in the host's zone*, silently. `dayKey`
(`calendarHelpers.ts:153`) is three of them concatenated. There is no argument to forget and no
`undefined` to notice — the zone is simply not in the expression.

**Discarding a hook's `loading`.** `useCalendarEvents` computes and returns it; the one call site
destructures `{ events: allEvents }` and drops it. The flag exists, is correct, and reaches nothing.

**Rendering a bounded query's hole as a fact.** Past slots older than the history window are
`past-unknown` — the same pixel that means "the engine skipped this" also means "we did not ask".

**A hardcoded first day of week.** `getWeekRange` subtracts `anchor.getDay()` (0 = Sunday) and
`weekdayShort(i)` offsets from 2000-01-02, a Sunday. Correct for `en-US`; wrong for most of the 14
shipped locales.

**Naming a colour map "agent" and keying it by trigger.** `colorMap` is keyed on
`agent.trigger_id` with the palette index taken from the entry's position in the array
(`ScheduleCalendar.tsx:44-50`), under a comment reading *"assign stable colors to agents"*. Two
schedules of one persona get two colours, and every colour moves when the list reorders.

---

## 6. Evidence

**The one site to copy: `src/features/schedules/libs/calendarHelpers.ts:283-365`** — the past-slot ↔
run binding. It is the best-reasoned block in the feature and the reasoning is in the file:

> The calendar used to colour every past projected slot green/red from the trigger's OVERALL
> health, so a slot the engine SKIPPED … rendered as a confident past-success. It was asserting
> history it didn't have.

and, on the tolerance:

> The per-slot tolerance is capped at half the gap to the nearest neighbouring slot, so a fast
> (sub-3-min) schedule can't have a single run satisfy two slots. Backfilled runs stamp their
> `created_at` at backfill time (far from any nominal slot) so they simply don't match — the
> genuinely-missed slots then correctly read as unknown rather than borrowing the backfill's
> outcome.

That second sentence is the interaction with [`backfill-window-replay`](./backfill-window-replay.md)
reasoned about **in advance**, and it is unit-tested
(`libs/__tests__/matchPastSlotsToRuns.test.ts`). Copy the shape: a tolerance derived from the data's
own spacing, a consumed-run set so binding is one-to-one, and an explicit third outcome.

Also exemplary:

- `calendarHelpers.ts:80-91` and `useCronPreview.ts:12-21` — two deletion records that name the
  drift, the ADR and the reason a seedless preview hook was removed rather than "aligned": *"Keeping
  a seedless preview hook around only invited a future consumer to render a lie, so it's gone."*
- `useCronPreview.ts:66-82` — the effect keyed on a **value signature** instead of the `entries`
  array identity, with the measurement in the comment (a 30 s poll produced a new array and refired
  every IPC). Repeated deliberately for `useConflictPreview` at `:284-295`, with a note that having
  the raw array in the dep list *"defeated sig's whole purpose"*.
- `calendarHelpers.ts:223-273` — the conflict sweep rewritten from O(k²) to O(n) with the old
  behaviour (and its inflated badge counts) recorded in the comment.
- `ScheduleCalendar.tsx:66-75` — conflicts computed over `allEvents`, filters applied after, with
  the reason stated: *"toggling 'Projected' off shouldn't make a conflict between a projected and a
  past run disappear."*
- `ScheduleRow.tsx:124-129` — `content-visibility:auto` + `contain-intrinsic-size` on an
  unvirtualized growing list, with the perf-walk reference.
- `calendarHelpers.ts:173-189` — `formatHour` / `weekdayShort` derive their strings from `Intl`
  rather than an English name table. Half-right: the *names* are locale-derived, the *week start* is
  not (§7 D5).

---

## 7. Deviations

### D1 (P0) — the calendar renders every schedule in the viewer's zone, and names a third one

The grid coordinate comes from `ev.time.getHours()` (`calendarHelpers.ts:116`) and
`dayKey(ev.time)` = `getFullYear()-getMonth()-getDate()` (`:153-155`). `Date` field accessors answer
in the host's zone. The schedule's authored zone reaches `cronFireTimesInRange`
(`useCronPreview.ts:107,355`) — which is correct, the *instants* are right — and then reaches
nothing that renders. `agent.timezone` appears in exactly **4 places** in the whole feature: two IPC
arguments, the effect signature, and `FrequencyEditor.tsx:43`'s initial state.

The chip that looks like the answer is not: `ScheduleRow.tsx:97-100,157` renders
`useThemeStore(s => s.timezone)` — the app-wide display preference — beside the cron expression,
gated on `agent.cron_expression`. `FrequencyEditor.tsx:47-51` gets this exactly right for its own
preview (`scheduleTz ?? themeTimezone ?? local`, with `timeZone: previewDisplayTz` passed to the
formatter at `:213`) — so **the correct precedence is already written, once, in the editor, and does
not reach the row or the calendar.** This is the doctrine's *transfer, not ignorance*: the same
codebase answers the question 200 lines away.

**Fix:** thread the schedule's zone into the placement (§9's type proposal) and render it on the
axis. Deferred — it changes what a live surface shows.

### D2 (P0) — one function, two definitions of a calendar day

`ScheduleRowHistoryPanel.tsx:157-186`, replayed and quantified in §0: axis from host midnight
(`:161`), keys in UTC (`:165`, `:176`), labels back in host-local (`:166`). On the operator's own
machine, **36 of 46 plotted runs sit under the wrong label and 4 of 50 vanish**; on UTC it is exact.

The identical split-brain exists in a shared library: `src/lib/types/timeRange.ts:33-40` builds a
calendar-month range with `new Date(year, month - 1, 1)` (host-local construction) and serialises it
with `toISOString().slice(0, 10)` (UTC), so on any positive offset a "calendar month" range starts
on the last day of the previous month. Two independent instances, one shared helper — this is a
pattern, not a slip.

**Fix:** one zone for construction, keying and labelling, chosen explicitly. Deferred (changes what
a live chart shows).

### D3 (P1) — the calendar has a loading state and does not use it

`useCalendarEvents` returns `{ events, loading }` (`useCronPreview.ts:25-28`) and maintains
`loading` correctly, including keeping the previous `events` while a refetch is in flight
(`:91`, `setResult(prev => ({ ...prev, loading: true }))`). `ScheduleCalendar.tsx:60` destructures
`{ events: allEvents }` and drops it.

Measured against [`overview-loading`](../../design/overview-loading.md)'s five laws: **law 1 (a
fetch never hides rendered rows) holds — by accident**, because the hook preserves `prev.events`.
**Law 2 fails**: a first load renders the full grid with zero events, which is pixel-identical to
"you have no schedules this week". There is no ghost, no delayed skeleton, and — correctly — no
spinner. The cost is not a flash; it is that the empty state and the loading state are the same
picture, and the calendar's fetch is up to *N* IPC round trips of 500 fire times each.

**Fix:** `const { events: allEvents, loading } = …` and a ghost under the grid gated on
`loading && allEvents.length === 0`. Small, but it changes a live surface — deferred.

### D4 (P1) — every past cell in this database is "unknown", and the calendar cannot say why

`list_recent_schedule_runs` (`commands/tools/triggers.rs:1588`) requires
`JOIN persona_triggers t ON t.id = e.trigger_id`. **`persona_executions.trigger_id` is NULL on all
2,188 rows** in the backup, so the command returns **0 rows for the entire recorded history** and
every past slot resolves to `past-unknown`. That is the *honest* rendering — the code is behaving
exactly as designed — and it is indistinguishable from the two other reasons a cell is unknown:

1. the engine genuinely skipped the slot (rate limit, active window, budget, app closed);
2. the slot is **older than the query's reach** — `hours.clamp(1, 168)` and `LIMIT 200`, so a month
   view's past portion beyond 7 days can never be verified, and 200 rows are shared across *all*
   triggers.

The legend offers "Unverified" as a filter and nothing explains it. **A bounded query rendered as an
outcome is a missing measurement wearing a fact's clothes.**

**Fix:** draw the verifiable horizon — dim or hatch the region older than the history window — and
distinguish "no record" from "not queried". Deferred (changes what a live surface shows).

### D5 (P2) — the week starts on Sunday in all 14 locales

`getWeekRange` (`calendarHelpers.ts:61-66`) computes `start = anchor - anchor.getDay()` days;
`weekdayShort(i)` (`:187-189`) offsets from 2000-01-02, a Sunday; `MonthView.tsx:33-37` renders
`weekdayShort(0..6)` in that order. The *names* localise; the *order* does not. Of the 14 shipped
locales, Sunday-first is conventional for a minority. The platform answer
(`new Intl.Locale(lang).weekInfo?.firstDay`) is available in this runtime.

### D6 (P2) — three hardcoded English strings in a file that otherwise translates

`ScheduleCalendar.tsx:144` `Today`, `:218` `Week`, `:230` `Month` — plain JSX text in a component
whose entire legend goes through `t.schedules.*`. Plus `MonthView.tsx:83`
``title={`${dayConflictCount} overlapping executions`}`` — hardcoded English delivered through the
native `title` attribute, which is also a `native-title-tooltip` condition
([`tooltip`](./tooltip.md), baseline 566 files / 1,099 matches — this site is in that baseline).

`ScheduleCalendar.tsx:117-118` — the header label's two `toLocaleDateString(undefined, …)` calls —
is already carried by `host-locale-date-render`
([`timestamp-display`](./timestamp-display.md), 3 matches at those two lines, confirmed by running
that rule).

### D7 (P3) — the colour map is per trigger, indexed by array position, and called "per agent"

`ScheduleCalendar.tsx:44-50`: `entries.forEach((e, i) => map.set(e.agent.trigger_id,
agentColor(e.agent, i)))`, under a comment promising stable per-agent colours.
`agentColor` (`calendarHelpers.ts:164`) falls back to `PALETTE[index % 8]` when the persona has no
colour. Two consequences: a persona with two schedules gets two colours in a legend that reads as
per-persona; and because the index is the position in `entries`, any reorder (a health change, a
new schedule, a sort) repaints the whole calendar.

### D8 (P3) — the month cell caps at 3 events and the week cell caps at nothing

`MonthView.tsx:44-46` caps a day cell at `MAX_VISIBLE = 3` with a `+N more` affordance — correct,
and the disclosure the doctrine's [`entity-picker`](./entity-picker.md) asks for. `WeekView`'s hour
cells have no equivalent. With `cronFireTimesInRange` capped at 500 per entry and no ceiling on the
entry count, a dense hour renders every block. The measured population is small (32 schedules, all
daily/weekly cron), so this is a latent bound, not a live one.

### D9 (P3) — the conflict badge counts events, not conflicts

`detectConflicts` increments `byHourCell` / `byDayCell` **once per event in a conflicting group**
(`calendarHelpers.ts:236-246`), so a cell where three schedules collide reports `3`. The badge's
tooltip says *"3 overlapping executions"*, which is true; `totalConflicts =
byHourCell.size + byDayCell.size` (`ScheduleCalendar.tsx:77`) then counts *cells*, and gates the
"Overlap" legend toggle on it. Two different quantities under one name; the visible number is
correct and the gate is coarse.

---

## 8. Gaps

**Gap 1 — the runtime can compute a zoned instant but not a zoned `Date`.** `Intl.DateTimeFormat`
with `timeZone` can *format* a moment in any zone; JavaScript has no `Date` whose field accessors
answer in a chosen zone. So "place this instant in Tokyo's 9 a.m. row" requires either
`formatToParts` per event or a date library, and neither is present in this feature. **This is the
real reason the whole client is host-zone-bound and why the fix is a helper rather than a rename.**
`Temporal` would close it and is not in the runtime.

**Gap 2 — a fleet calendar has no single correct zone.** Even with the helper, thirty schedules in
seven zones cannot all be drawn truthfully on one grid: either the grid is in one zone and each
event carries its own label, or the grid follows the selected schedule. The doctrine's rule stands —
name the zone — but §2's clause (c) genuinely under-determines the multi-entity case.

**Gap 3 — history is capped in two dimensions and neither is per-trigger.**
`hours.clamp(1, 168)` bounds *reach*; `LIMIT 200` bounds *volume* across all schedules. A month view
therefore cannot verify its own past, and a fleet with many schedules exhausts the 200 within hours.
`matchPastSlotsToRuns` is correct given what it is handed; nothing upstream can hand it a month.

**Gap 4 — the census cannot express the defect that made §0.** `bucketByDay`'s bug is that *two*
zone-free expressions in one scope disagree with each other. A per-site matcher sees two matches; it
cannot see that they contradict. §9's rule ratchets the **population of zone-free day boundaries**,
which is the condition upstream of the contradiction — it would have flagged both lines, and a human
reading the pair finds the bug. That is the honest claim, and it is weaker than "this gate catches
the §0 defect".

---

## 9. The missing gate

### The rule

**Signal.** A calendar day derived from a `Date` with **no zone named** — two spellings that are
invisible to each other: `.setHours(0,0,0,0)` (the host's midnight) and
`.toISOString().slice(0,10)` (UTC's midnight). Both answer "which day is this?" and neither takes an
argument that could have been the right one, which is precisely why the mistake is silent.

**Mechanism.** A census rule (`scripts/census/rules.json`), ratcheting. Not ESLint: the condition is
lexical, not structural, and there is no autofix — the correct replacement depends on *which* zone
the surface owns, which a rule cannot know.

**Fails loudly when its own precondition is absent** through the census engine's own contract: a
walk below `floor: 4000` files fails; a rule matching zero files fails; a silent drop fails.

**Allowlist.** None. Four of the eighteen matches are document/filename stamps
(`MediaStudioPage.tsx:131`, `compileReport.ts:110`, `passportExport.ts:25`,
`harness/executor.ts:280`) rather than user-facing calendar days; they are **carried in the baseline
rather than excluded**, following `host-locale-date-render`'s precedent — four path exemptions for
four lines create four stale-exclude failure modes worth more than they save.

```json
{
  "id": "zoneless-day-bucket",
  "goldenPath": "docs/concepts/golden-paths/schedule-calendar.md",
  "title": "A calendar day is derived from a Date with no zone named, so the boundary between two days is decided by the viewer's machine (or by UTC) rather than by the entity the day belongs to",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\.setHours\\(\\s*0\\s*,\\s*0\\s*,\\s*0\\s*,\\s*0\\s*\\)|\\.toISOString\\(\\)\\s*\\.\\s*slice\\(\\s*0\\s*,\\s*10\\s*\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "TWO spellings of 'which calendar day is this instant on', neither of which takes a zone: `.setHours(0,0,0,0)` snaps to the HOST machine's midnight, `.toISOString().slice(0,10)` snaps to UTC's. They are invisible to each other and this repo uses both, three lines apart, inside one function. PROXY FOR the stack-free condition: a day boundary — the thing that decides which bucket a moment falls in, which column it is drawn in, and which label it is filed under — is chosen by the machine the code runs on rather than by the entity whose day it is. There is no argument to forget and no `undefined` to notice: the zone is simply absent from the expression, which is why this is invisible to `host-locale-date-render` (site overlap measured: 0 of 18; file overlap 4 of 15) — that rule gates the LOCALE argument of a formatting call, this one gates the ZONE of a bucketing computation, and `LimitsSettings.tsx:77` is simultaneously compliant here (`timeZone: 'UTC'`) and violating there (locale `undefined`), which is the cleanest available proof that the two concerns are orthogonal. MEASURED 2026-08-17 at 52b0a6ba8 over 4,801 src .ts/.tsx: 18 matches in 15 files, hand-verified 14/18 on the strict condition (a calendar day a user reads or filters by) and 18/18 on the literal one; the 4 are document/filename stamps (MediaStudioPage.tsx:131, compileReport.ts:110, passportExport.ts:25, harness/executor.ts:280) carried in the baseline rather than excluded. THE CONSEQUENCE IS MEASURED, NOT ARGUED: `bucketByDay` (ScheduleRowHistoryPanel.tsx:157-186) holds BOTH spellings and was replayed verbatim against the operator's 50 real executions at three host offsets — UTC: 0 of 50 mis-plotted, 0 dropped; Europe/Prague (UTC+2) and Asia/Tokyo (UTC+9): 36 of 46 plotted under a label that is not their local calendar day, 4 of 50 dropped entirely because their UTC key names a day no bucket claims. Identical code, identical data, correct on the machine a CI job runs on. src/lib/types/timeRange.ts:33 holds the same split-brain in a shared helper (host-local `new Date(y, m-1, 1)` serialised through UTC `toISOString().slice(0,10)`, so a calendar-month range starts a day early on any positive offset). PRECONDITION (must be re-derived per repo): this repo spells a day boundary as a Date mutation or an ISO prefix, and has an entity-owned zone available to use instead (persona_triggers.config.timezone). A repo whose entities have no zone has no fix to route to. LEGAL FIX: derive the key through a formatter that names a zone — `new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)` yields YYYY-MM-DD in the chosen zone — and use ONE zone for keys, labels and axis. NOT LEGAL: swapping one spelling for the other; that is what produced the defect.",
    "$measured": "2026-08-17 @ 52b0a6ba8 — 4,801 src .ts/.tsx walked. Two independent implementations agreed exactly on 15 files / 18 matches: the census engine, and a bespoke line-scanner that reports file:line:column for every match (the scanner also independently reproduced the neighbouring host-locale-date-render set at 70 sites / 54 files versus its registry baseline of 67/53 — the 3-site gap is exactly the three comment-only lines in KnowledgeAtelier.tsx that `ignoreCommentLines` drops, confirmed by running that rule with --verbose; the disagreement resolved to a known engine feature rather than a matcher bug). The `.toISOString().split('T')[0]` alternative spelling was measured and OMITTED: 0 files, 0 matches — adding a zero-recall alternative buys nothing and risks a future false positive. Positive control returns 3 files / 3 matches. Re-extracted from this document and re-run: identical."
  },
  "baseline": { "files": 15, "matches": 18 },
  "floor": 4000
}
```

### The positive control

The same anchor — a `Date` projected into a calendar — pointed at the **compliant** form: the zone
is named. It returns **3 files / 3 matches** against the violation's 18, a **6:1 ratio in favour of
the disease** across the whole client, which is the finding as much as the baseline is.

```json
{
  "id": "zoneless-day-bucket-positive-control",
  "goldenPath": "docs/concepts/golden-paths/schedule-calendar.md",
  "title": "positive control — a Date projected into a calendar with its zone named",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "timeZone\\s*:",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "The compliant half of the same anchor: an explicit IANA zone handed to a date/time projection. Measured 2026-08-17 at 52b0a6ba8 over the same 4,801 files: 3 matches in 3 files, precision 3/3, every one opened — FrequencyEditor.tsx:213 (`toLocaleString(undefined, { timeZone: previewDisplayTz })`, where previewDisplayTz is the SCHEDULE's zone falling back to the app preference falling back to local: the correct precedence, written once, in the editor only), LimitsSettings.tsx:77 (`timeZone: 'UTC'`, correct for a billing month), triggerArmState.ts:72 (the arm-state evaluator resolving a trigger's active window). Against 18 zone-free day boundaries that is 6:1 in favour of the disease. The control also demonstrates the orthogonality this rule claims: LimitsSettings.tsx:77 is compliant HERE and violating for host-locale-date-render, because `timeZone` and `locale` are two independent arguments to the same call and this repo previously gated only one of them."
  },
  "floor": 4000
}
```

### Overlap, measured at the site level against the final patterns

| existing rule | its baseline | site overlap with `zoneless-day-bucket` | file overlap |
|---|---|---|---|
| `host-locale-date-render` (`timestamp-display`) | 53 files / 67 matches | **0 of 18** | 4 of 15 (`conversationModel.ts`, `ExecutionHeatmap.tsx`, `ScheduleRowHistoryPanel.tsx`, `calendarHelpers.ts`) |
| `native-title-tooltip` (`tooltip`) | 566 / 1,099 | 0 (different signal, D6 site already baselined there) | n/a |
| `hand-rolled-spinner` (`inline-busy-state`) | 180 / 246 | 0 — this feature renders no `animate-spin` | n/a |
| `absent-entity-count-as-zero` (`aggregate-count-display`) | 29 / 39 | 0 — `conflictsByDayCell.get(k) ?? 0` is not a `count`-named container and the accumulator tail excludes the `byHourCell` idiom | n/a |

**File overlap 27%, site overlap 0%.** This is exactly the case the doctrine warns about measuring
at the wrong granularity: four files hold both conditions, and not one line holds both.

### And what outranks the gate

Per *prefer a type over a gate*, held against the seven qualifications: the durable fix is a
**helper that withholds the zone-free path** —

```ts
export function dayKeyIn(instant: Date, timeZone: string): string   // 'YYYY-MM-DD'
export function hourIn(instant: Date, timeZone: string): number     // 0..23
```

— implemented over `Intl.DateTimeFormat(..., { timeZone })`, with `timeZone` **required** and no
default. Q5 (withholding beats requiring) is satisfied in the strong form: the caller is never
handed a bucketing function that *can* omit the zone. Q2 is the reason a `type Zone = string`
newtype is not enough on its own — requiredness is not closedness, and the value that must be
constrained here is presence, which requiredness *does* encode. Q3 holds only if the helper is
adopted: 18 construction sites exist today and the census baseline is the ratchet that drives them
down. **Propose the helper as the fix and the rule as the ratchet that holds the line until it
lands** — which is exactly the composition the contract prescribes.

Not applied: adding the helper is safe, but migrating 18 call sites changes what live surfaces show.
Recorded in [`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md) (**#61**).

---

## 10. Convergence

**Cohort: 4 independent of 5 present.** `brainiac`'s every hit on every probe lands in
`console/.next-build/**` — compiled Next.js output, not source — so it contributes nothing here and
is excluded rather than counted.

**The spine label `convergence: converged` — tested, and it FAILS, in two directions at once.**
This is the fourteenth `converged` leaf tested and the fourteenth to fail; its mode is one the
ledger has seen before and worth recording again because both halves appear on one leaf.

**Half 1 — the fleet converged on the *disease*, 4 of 4.** The zone-free day boundary is not local
taste; it is universal:

| repo | `.setHours(0,0,0,0)` | `.toISOString()` day prefix | explicit `timeZone:` |
|---|---|---|---|
| `personas` | 5 files | 11 files | **3 files of 4,801** |
| `personas-web` | 1 | 5 | 2 |
| `vibeman` | 7 | 17 | **0** |
| `ascent` | 0 | 21 | 1 |
| `personas-cloud` | 0 | 0 | 0 (48 files, no UI) |

Four codebases, three languages of framework, ~60 zone-free day boundaries between them, and
**six** files across the whole fleet that name a zone. Per the doctrine: *perfect agreement on an
omission is evidence that the situation is universal and evidence AGAINST an answer existing to
adopt.* An oracle that counts agreement would read this as the strongest possible confirmation of
current practice. It is the opposite. **The prescription in §2(c) is therefore the composer's
judgment against the fleet, not a practice harvested from it** — which the operator's settled
framing explicitly authorises.

**Half 2 — the calendar surface itself is a silence, 4 of 4 (and Personas is ahead).** The
week/month-grid vocabulary (`getWeekRange`, `getMonthRange`, `buildMonthGrid`, `startOfWeek`,
`weekStartsOn`) appears in `vibeman` twice (a reflector filter bar and a weekly API — not a grid)
and **zero times** in `personas-web`, `ascent` and `personas-cloud`, despite `ascent` running 36
files' worth of cron. So the label's *direction* is also wrong: there is nothing in the fleet to
converge with, and the one calendar in the cohort is this one. Reported as silence, per the
doctrine, and not promoted.

**What the fleet does have, and Personas is ahead of it, is the honest-past discipline.** No sibling
binds a projected slot to a real record before colouring it, because no sibling draws projected
slots. `matchPastSlotsToRuns` — the tolerance capped at half the neighbour gap, the one-to-one run
consumption, the explicit third outcome, and the *pre-reasoned* interaction with backfilled runs —
has no counterpart anywhere in the cohort. Stated as self-comparison: this is the piece a later path
should copy rather than reinvent.

---

## 12. Corrections

### 12.1 — `sides: "client"` holds, and the mechanism is worth naming

Only the third upholding of this value in the ledger, and it upholds for the same structural reason
as the two before it (`bulk-selection-actions`, `long-list-rendering`): **the server never sees the
grid.** The engine's contribution to this leaf is two IPC commands that answer questions
(`cron_fire_times_in_range`, `list_recent_schedule_runs`) and are, in the sweep's judgment,
*correct* — the fire times are computed in the schedule's real zone with the real seed, and the
history query is honestly bounded. Every defect in §7 is a rendering decision: which cell, which
label, which zone, what to draw while waiting.

D4 is the one that tests the boundary, since its root is a server-side cap and a NULL column — but
the *deviation* is that the client renders a bounded query as an outcome, which is a client choice
about how to draw an absence. `"client"` is right.

The neighbouring leaf in the same batch, [`backfill-window-replay`](./backfill-window-replay.md),
carries the same label and is **inverted** (§12.1 there). Same subdomain, same day, same sweep:
one holds, one inverts. The field is not noise and it is not reliable.

### 12.2 — corrections to the brief

- **"find the surface under `src/features/triggers/**`"** — it is **`src/features/schedules/`**
  (21 files, 4,524 lines). `src/features/triggers/` owns trigger authoring and the arm-state
  evaluator; the calendar, the week/month views, the timeline, the row, the history panel and all
  the helpers live in `schedules/`. Both leaves in this batch needed both trees.
- **"the trigger/event-chaining canvas at `src/features/teams/sub_canvas/` was deleted today; do
  not cite it, and if a published path cites it, record a §12 correction naming file and section."**
  Confirmed deleted — the directory does not exist at `52b0a6ba8`. **No path in this document cites
  it**, and nothing in the schedules feature imports from it. I did not sweep all 194 published
  documents for stale citations; that is an orchestrator-side audit, and it is worth running, since
  `node-canvas` is in the corpus by name.
- **"apply `docs/design/overview-loading.md`'s five laws"** — done, and the result is more
  interesting than "it violates them": **law 1 holds by accident** (the hook preserves `prev.events`
  across a refetch, so a fetch cannot hide drawn rows) while **law 2 fails** (no ghost; the loading
  state and the empty state are the same picture). The flag needed to fix it already exists and is
  already correct — the call site drops it (D3). A brief that expected a spinner-versus-ghost
  finding would have missed that the defect is one destructured identifier.
- **"a calendar is also a timezone-rendering surface, and the doctrine's rule that a check cannot
  distinguish an absence from a deliberate identity applies directly to `local`."** It applies, but
  **not to the calendar** — and the distinction matters. `"local"` is a *stored config value*
  problem, owned by [`scheduled-trigger-firing`](./scheduled-trigger-firing.md) and
  [`trigger-wiring-surface`](./trigger-wiring-surface.md), and its writer
  (`ChronologyAdoptionView.tsx:270`) was fixed on 2026-08-15. The calendar's zone defect is
  structurally different and worse: it is not that a *bad* zone was stored, it is that **a
  perfectly good zone is stored, used correctly to compute the instant, and then discarded before
  the instant is drawn.** No value is wrong anywhere; the information simply stops travelling. A
  check that looked for absent-or-sentinel zone values would score zero on it.
- **"fix-as-you-touch `TriggerRow.tsx`'s four `title=` badges if and only if you touch that file."**
  I did not touch it. `src/features/triggers/sub_triggers/TriggerRow.tsx` was read (lines 40-46, for
  `getTriggerArmState`'s new `unschedulable` state) but not edited, so the conversion is not owed by
  this composer and the `native-title-tooltip` baseline is untouched. The equivalent condition
  *inside my scope* is `MonthView.tsx:83` (§7 D6) — one native `title` carrying hardcoded English —
  and it is likewise recorded, not converted, because it changes a live surface.

### 12.3 — correction to this document's own measurement

My bespoke scanner reported `host-locale-date-render` at **70 sites / 54 files** against the
registry's baseline of **67 / 53**. Two implementations, one disagreement, and per the doctrine the
disagreement is where the work is. Resolution: the registry rule sets `ignoreCommentLines: true`,
and running it with `--verbose` prints *"3 match(es) ignored on comment-only lines"* at
`KnowledgeAtelier.tsx:41,340,470` — prose *about* the migration, not a violation of it. My scanner
had no comment handling. **The neighbour's number is right and mine was.** Recorded rather than
silently reconciled, because a 3-site gap that resolves to an engine feature looks exactly like a
3-site gap that resolves to a matcher bug, and only running the other rule tells them apart.

### 12.4 — what I could not measure

The calendar's zone behaviour was established by reading, not by execution: rendering
`ScheduleCalendar` under two host offsets would need a DOM harness this sweep did not build, and
the app must not be started a second time. The §0 replay covers `bucketByDay` — a sibling surface in
the same feature with the same defect class — and is not a substitute for driving the calendar
itself. The claim that `ev.time.getHours()` answers in the host's zone is a language guarantee, not
an inference; the claim that this *matters here* rests on 9 of the operator's 32 schedule triggers
having carried an explicit `timezone` value at all, which is itself measured. A live-app L2 pass
against the calendar remains owed.
