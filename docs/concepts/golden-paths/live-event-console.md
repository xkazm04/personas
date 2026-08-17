# Golden path — Live event console

> Situation node: `product-surfaces/monitoring-surfaces/live-event-console` ·
> [situation spine](../situation-spine.md) · recurrence **3** · risk **MEDIUM** ·
> sides: **client** (**upheld**, and for a structural reason — see [§12.1](#121--sidesclient-upheld-the-third-time-and-the-mechanism-is-worth-naming)) ·
> convergence: **converged** (**not tested against the siblings** — but see [§12.2](#122--convergence-converged-untested-across-repos-and-confirmed-inside-this-one) for a stronger result) ·
> dimensions: **ui · performance · resilience**
> Composed 2026-08-17 against `master` @ `6c97502d3`. **Mode-2 short form** — spine header, §0,
> §2, §7, §9, §12. The quality core is unchanged: two implementations of every count, a positive
> control, hand verification, re-extraction from the finished document.
>
> **Sweep size.** Both live event consoles read end to end — `sub_events/components/EventLogList.tsx` (487
> lines) + `libs/useEventLog.ts` (413) + `stores/slices/overview/eventSlice.ts` (69), and
> `triggers/sub_live_stream/LiveStreamTab.tsx` (471) — plus the transport
> (`hooks/realtime/createSingletonListener.ts`, `useEventBusListener.ts`), the CDC producer
> (`db/src/cdc.rs:200-400`), the status vocabulary (`lib/design/eventTokens.ts`), and the DDL.
> `src/**/*.{ts,tsx}` (**4,829** files) walked **four** times — twice by the census engine
> (rule + positive control) and twice by two independently written scanners. **All 11 sites in
> the census baseline and all 55 in its positive control were opened by hand.**
>
> **Measured by execution.** A read-only **copy** of the operator's live `personas.db` (347 MB),
> taken 2026-08-17 with the app running; the live file was never opened for write and **the copy
> was deleted at the end of composition**. Replayed against it: every one of the console's seven
> hardcoded status-filter options as its own `COUNT(*)`; the sliced-slug vs `source_id`
> resolution the persona column depends on; the millisecond truncation the client's sort performs
> on `created_at`; and the header's skipped-rate query at its own 7-day window.
>
> **Primed, then verified.** Three claims arrived with the brief from `audit-trail-view` and
> `domain-event-publication`. **All three verified exactly** — and one of them is in a different
> table than anyone would guess (§12.3).

---

## 0 The headline: this app has two live event consoles, and the flagship one stops being live the moment you filter it

`src/features/triggers/sub_live_stream/LiveStreamTab.tsx` and
`src/features/overview/sub_events/components/EventLogList.tsx` both subscribe to the same Tauri `event-bus`
channel through the same singleton listener, and render the same `PersonaEvent` rows. One of them
is a textbook live console. The other is the one in the Overview navigation.

| | **Triggers → Live Stream** | **Overview → Events** |
| --- | --- | --- |
| ingest | rAF-batched: events accumulate in a ref and commit in **one** `setEvents` per animation frame (`LiveStreamTab.tsx:68-104`) | one `pushRecentEvent` per event, one store `set` per event (`eventSlice.ts:33-68`) |
| pause | **yes** — `isPaused` + a replay queue + a queued-count badge, draining oldest-first on resume (`:147-171`) | **none** |
| window | 200, with the id index evicted in the same pass (`:96-101`) | 200 for the live buffer — and `olderEvents` accumulates **without bound** (`useEventLog.ts:306`) |
| throughput meter | events/min over a rolling 60 s window with a **hard 10,000-entry FIFO cap** against sustained bursts (`:21,:137-141`) | none |
| listener readiness | `const attached = useEventBusListener(…)` — the boolean is consumed | the boolean is discarded |
| **live while filtered?** | **yes** — filters run client-side over the live buffer (`:222-231`) | **no** |

That last row is the finding. `useEventLog.ts:215-224`:

```ts
const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || selectedPersonaId || searchText.trim();
let base: PersonaEvent[];
if (hasFilters) { … base = serverResults; }
else { base = recentEvents; }
```

The bus writes `recentEvents` (`:117-125`). `serverResults` is written **only** by
`executeSearch`, which runs on a filter change and on the manual refresh button. So the instant
any filter is active — a status, a type, a persona, or one character of search text — the console
detaches from the stream. New events keep arriving, keep landing in `recentEvents`, and keep
being invisible, with no badge, no counter and no indication that the view has frozen. **Filtering
is what you do during an incident**, and it is the action that turns the live console into a
snapshot.

Then there is what the filter can actually select. `EventLogList.tsx:62-70` hardcodes seven
status options. Replayed against the 4,972 rows in `persona_events`:

```
  option "all"          4972
  option "completed"       0   <-- selects NOTHING
  option "failed"          0   <-- selects NOTHING
  option "pending"         0   <-- selects NOTHING
  option "processed"       0   <-- selects NOTHING   (and not a member of the union at all)
  option "processing"      0   <-- selects NOTHING
  option "skipped"        31
```

The column holds exactly two values: **`delivered` — 4,941 rows, 99.4 % — and `skipped`, 31.**
`delivered` **is not offered**. So **5 of the 6 real options select zero rows, and 4,941 of 4,972
rows are unreachable through any filter setting except "all".**

`processed` is not a typo for a status the system uses somewhere else. It comes from a *third*
vocabulary. There are three event-status vocabularies in this app and no two agree:

| declaration | members |
| --- | --- |
| `PersonaEventStatus` / `EVENT_STATUS_COLORS` (`lib/design/eventTokens.ts:111-120`) | `pending processing delivered completed failed skipped dead_letter discarded` (**8**) |
| `en.json → status_tokens.event` — the i18n label catalog, translated into 14 locales | `pending processing processed failed retrying` (**5**) |
| `EventLogList.tsx:62-70` — the filter | `completed failed pending processed processing skipped` (**6**) |

The union and the label catalog share **three** members. The catalog carries two the union does
not have (`processed`, `retrying`) and is missing five it does — including `delivered`. Which
means the console's other status defect cannot be fixed the obvious way: `EventLogList.tsx:251`
renders `{event.status}` as a **raw machine token**, and routing it through
`tokenLabel(t, 'event', status)` would fall through to the same raw token for 4,941 of 4,972
rows, because **the label catalog has no name for the status 99.4 % of this install's events
carry.**

None of this is a dead feature. Events are flowing: the newest row is dated **2026-08-17**, the
day of composition. There are **31 events in the last 30 days**, all of them `dev_tools.context_scan_*`,
all `skipped` — so the header's dead-trigger chip (`:289-302`) currently reads **31 skipped of 31
total, a 100 % skip rate**, which is true, alarming, and entirely an artifact of the 7-day window
it uses.

---

## 2 The one way (compact)

**A live console is a bounded ring the producer pushes into, a filter that runs over that ring,
and a pause that buffers rather than drops — in that order, and the filter never leaves the
ring.** Concretely: (a) one subscription, batched at the **frame** — accumulate arrivals in a ref
and commit once per `requestAnimationFrame`, because a burst of 200 events must cost one render,
not 200; (b) the buffer is a **bounded ring with an id index maintained in the same pass** as the
eviction, so an id that scrolls off the tail cannot leak into the "already seen" set; (c)
**filter in memory over the ring** — a server-filtered result set is a *snapshot*, and swapping
the render source from the live buffer to a snapshot silently ends the stream; if the filter must
be server-side (the corpus is larger than the ring), keep rendering the live buffer **and** merge
arrivals that match the active filter, and say on the pixel which mode you are in; (d) **pause
buffers, never drops** — a pause queue, a visible queued count, and a drain in arrival order on
resume, so "pause" means "hold" and not "lose"; (e) derive every filter's option list **from the
vocabulary's declaration**, never as literals — a hand-written mirror cannot be checked for
coverage, and an option the column never holds is indistinguishable from a filter that works; (f)
one closed status vocabulary with one label per member, and the label catalog's key set asserted
equal to the union's — a status the catalog cannot name will render as a machine token no matter
which helper you route it through; (g) sort with an explicit tiebreaker on a monotonic key, and
know what your parser's precision is — see §7 D7, where the client's own `Date.parse` manufactures
the ties the database does not have.

The pattern in (a)–(d) is not hypothetical here: it is
`src/features/triggers/sub_live_stream/LiveStreamTab.tsx:38-171`, in this repo, today.

---

## 7 Deviations

### D1 — two live event consoles; the good one is not the one in the navigation · read

`LiveStreamTab.tsx` implements the whole of §2 (a)–(d), with the reasoning written down:

- `:56-63` — *"under high CDC throughput (50-200 evt/s), running setEvents per-event runs N
  prev→next array transforms inside React's frame"*.
- `:96-101` — the 200-cap that **deletes the evicted ids from `eventIdIndex` in the same loop**.
- `:137-141` — the hard `STREAM_TIMESTAMP_CAP = 10_000` FIFO on the events/min buffer, because
  *"the time-window trim alone can still let the array grow unboundedly"*.
- `:106-125` — the mount backfill's dependency-array fix, whose comment records the bug it
  removed: keying on `personas` re-ran it on every roster mutation and *"replaced the buffer with
  the fresh top-100, discarding up-to-200 already-buffered live events"*.
- `:147-171` — `handleResume`, draining the pause queue oldest-first.

`EventLogList` has none of it. This is the shape [`entity-picker`](./entity-picker.md) named —
**a solved problem that did not cross a component boundary**. The prescription is therefore
*transfer*, not invention: extract `LiveStreamTab`'s ingest into a shared hook and give the
Overview console the same one.

### D2 — the Overview console stops streaming under any filter, silently · read

`useEventLog.ts:215-224`. The bus feeds `recentEvents`; the render feeds from `serverResults`
whenever `hasFilters`. `serverResults` is set only in `executeSearch` (`:160-164`) and on manual
refresh (`:322`). There is no bus write into it, no merge, and no disclosure.

The same predicate is spelled **four** times in the module, with three different expressions:
`isServerSearch` (`:80-82`), `hasFilters` inside `executeSearch` (`:151`), `hasFilters` in the
debounce effect (`:179`), and `hasFilters` in `filteredEvents` (`:216`). They currently agree.
Nothing makes them.

### D3 — five of six filter options select zero rows; 99.4 % of the table is unreachable · executed

`EventLogList.tsx:62-70`, replayed per option against 4,972 rows: `completed` 0, `failed` 0,
`pending` 0, `processed` 0, `processing` 0, `skipped` 31. The column's real vocabulary is
`delivered` (4,941) and `skipped` (31). `delivered` is not an option.

`processed` is not in `PersonaEventStatus` at all, so it is a filter value the type system
already had the information to reject — and could not, because the list is string literals.

### D4 — three event-status vocabularies, and the label catalog cannot name the majority status · executed

The table in §0. `status_tokens.event` (the 14-locale label catalog) is
`pending processing processed failed retrying`; the union is
`pending processing delivered completed failed skipped dead_letter discarded`. Intersection:
**3**. Catalog-only: `processed`, `retrying`. Union-only: `delivered`, `completed`, `skipped`,
`dead_letter`, `discarded`.

The consequence is that D5 has no cheap fix. It also explains a detail in the *other* console:
`LiveStreamTab.tsx:31-35` resolves four of its five labels through i18n and hardcodes the fifth
as `'Skipped'` — because there is no key for it.

Extends [`status-and-severity-badges`](./status-and-severity-badges.md), which measured 66 closed
vocabularies at the schema with 0 at complete label coverage. This is one of the 66, with the
gap quantified against live rows.

### D5 — the status cell renders a raw machine token, for every row · cited, verified, extended

`EventLogList.tsx:251` — `{event.status}`, inside a coloured pill, with no `tokenLabel`, no
`t.`, no mapping. **4,972 of 4,972 rows** render the literal string `delivered` or `skipped`, in
all 14 languages. This is `audit-trail-view` D2's finding, re-verified. What is new is D4: the
canonical fix (`tokenLabel(t, 'event', status)`) would change nothing for 99.4 % of them.

### D6 — two `LoadingSpinner` call sites, both rendering nothing, one of them replacing an icon · read

`feedback/LoadingSpinner` renders `null` — a compatibility shim emitting only an `sr-only`
`role="status"` when given a `label`. Both call sites in this console give it no label:

- `:248-250` — `{event.status === 'processing' ? <LoadingSpinner size="xs" /> : <StatusIcon …/>}`.
  This is verbatim the anti-pattern `.claude/CLAUDE.md` names (*"makes the icon vanish and puts
  nothing in its place"*): a `processing` row renders a coloured pill with a hole where every
  other row has a glyph. `EVENT_STATUS_ICONS.processing` is `Loader2` and exists
  (`eventTokens.ts:136`), with a docstring saying to render it with `animate-spin` at the call
  site — the correct answer, two lines away, unused.
- `:343` — `{isSearching && <LoadingSpinner size="xs" />}`, the search-in-flight indicator, which
  renders nothing at all. The search has no visible busy state.

### D7 — the sort has no tiebreaker, and the client manufactures the ties itself · executed

`useEventLog.ts:236-246` builds `tsMap` from `new Date(e.created_at).getTime()` and sorts on it
with no secondary key. Measured against the live table:

- distinct `created_at` values shared by more than one row: **0 of 4,972**. The column is written
  at nanosecond precision (`2026-08-17T01:00:18.286580800+00:00`) and is genuinely unique.
- collisions **after `Date.parse` truncates to milliseconds**: **219 timestamps covering 442 rows
  — 8.9 % of the table.**

So the instability is not in the data. The client's own parse creates it, and then sorts on the
result with `Array.prototype.sort`, whose stability guarantees nothing about a comparator that
returns 0 for rows the database can order exactly.

This **sharpens** [`audit-trail-view`](./audit-trail-view.md) D7 ("141 history reads order by a
clock with no tiebreaker") rather than repeating it: there the tie is in the SQL, here the SQL is
correct and the tie is created client-side by a precision loss. The two need different fixes —
`ORDER BY created_at DESC, id DESC` on one side, and carrying `id` into the comparator on the
other.

### D8 — the sidebar's Events badge counts a status that has never existed · executed

`eventSlice.ts:28` sets `pendingEventCount` to `events.filter(e => e.status === "pending").length`
and `:35-68` maintains it incrementally with a carefully-reasoned delta (including decrementing
when a pending row is trimmed off the tail — a real correctness detail, and there is a dedicated
test file for it). The count drives a purple badge on the Overview → Events sidebar item
(`SidebarLevel2.tsx:104`) and a screen-reader announcement (`Sidebar.tsx:181`).

Rows with `status = 'pending'`, ever: **0 of 4,972.** The badge cannot appear. `useEventLog`
returns `pendingEventCount` (`:398`) and `EventLogList` does not destructure it (`:77-92`), so
the console itself does not show it either.

### D9 — the live buffer is bounded and the pagination buffer is not · read

`pushRecentEvent(evt, 200)` caps `recentEvents` at 200 (`useEventLog.ts:123`). `loadOlder`
appends 50 rows per page into `olderEvents` with **no cap** (`:306`), and `filteredEvents`
(`:226-246`) dedupe-merges base + `olderEvents` and re-sorts the whole thing **on every render
that touches any of eight dependencies** — including `searchText`, which changes per keystroke.
`onEndReached` is wired to infinite scroll (`:461`), so the ceiling is how long the user scrolls.
Already inside [`long-list-rendering`](./long-list-rendering.md)'s citation set; recorded here
because the *sort* over the growing merge is this console's own cost, not the table primitive's.

### D10 — the persona column slices a slug that resolves zero times · cited, verified

`EventLogList.tsx:199-201` takes `source_type.slice('persona:'.length)` and looks it up as a
persona **id**; `event.source_id` is used only when `source_type` is exactly `'persona'`.
Replayed: **4,166** rows are persona-scoped; the sliced slug resolves to a persona id **0**
times; `source_id` resolves **4,166 of 4,166**. The values being sliced are display-name slugs
(`persona:T:_Dev_Clone`), which is `domain-event-publication` D6's finding — *"`source_type` is a
routing dimension holding a mutable display name."* `audit-trail-view` D2 measured the same
0-of-4,166. Verified, not re-derived.

### D11 — the dead-trigger chip's window makes a 100 % rate out of 31 rows · executed

`getEventSkippedStats` feeds a chip reading *"N skipped"* with a tooltip giving `skipped / total`
and a percentage (`:289-302`). Over the last **7 days**: 31 skipped of 31 total — **100 %**.
All time: 31 of 4,972 — **0.6 %**. Both are true. The chip renders the first and the reader
infers the second, because nothing on the pixel says which window it is.

### D12 — cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **The console genuinely is live.** `db/src/cdc.rs:376-395` re-fetches and emits the full row on
  **INSERT and UPDATE**, with a comment recording the bug that earned the UPDATE arm (a status
  change fell through to the lightweight `{action,table,rowid}` notification, *"which the
  live-stream UI rejects (it has no event_type) — so the row froze on its first-seen status"*).
  The frontend's matching rejection is `useEventLog.ts:122`. Both halves correct.
- **`createSingletonListener` is well built** — one Tauri subscription fanned out to N
  subscribers, per-frame coalescing, an early-arrival buffer with a **counted** drop path and a
  once-per-session warning. Not a deviation.
- **`executeSearch`'s abort guard is correct** (`:129-132,:162,:166`), and the debounce correctly
  applies 300 ms to text and 0 ms to dropdowns (`:193`) — the exact split
  [`filtering-and-search`](./filtering-and-search.md) prescribes.
- **`loadOlder`'s cursor is correct**: it picks the chronologically oldest row by parsed epoch
  rather than by string compare, and its comment names the mixed RFC3339/SQLite-naive shapes it
  is defending against (`:260-272`). Measured: **4,972 of 4,972** rows are RFC3339 today, so the
  defence is currently unexercised — but it is right, and it is the same `Date.parse` that
  causes D7 two functions later.
- **`UnifiedTable` is used correctly** — `isLoading` + `data` + `rowHeight` + `groupBy` +
  `scrollRestoreKey` + `rowReveal`, i.e. the whole loading-v2 contract from props. The rich empty
  state is correctly gated on the fetch having settled (`:276`).

---

## 9 The missing gate

Most of §7 is not gateable. D1 and D2 are comparisons between two components; D4 is an
allowlist-covers-a-set condition, which the census "cannot assert" by construction; D8 and D11
are facts about live rows. What *is* countable is the mechanism upstream of D3 and D4 — the
moment a closed vocabulary gets retyped as literals — and that is what this path ships.

### The signal, and the condition it is a proxy for

**Condition (stack-free):** a filter, tab strip or picker enumerates the members of a closed
vocabulary as its own hand-written list, so nothing checks that the list **covers** the
vocabulary or that its members **exist in** it. Both failures are silent and neither is visible
from the filter: an option nobody can select looks exactly like a filter that works, and a value
nobody can filter for looks exactly like a value that never occurs.

**Proxy in this stack:** an object literal of the form `{ value: '<token>', label: … }` where
`<token>` is a member of one of this repo's status vocabularies, **followed within 400
characters by a second such entry**. Two entries are required so the match is a *vocabulary
mirror* rather than any single option; a lookahead carries the second so the match does not
consume it and the count stays per-entry.

**The word list is derived from the tree, never invented** — three declarations, unioned:
`EVENT_STATUS_COLORS`'s keys (`src/lib/design/eventTokens.ts:111-120`, the `PersonaEventStatus`
union), `en.json → status_tokens.event`, and `en.json → status_tokens.execution`. Fourteen
tokens. This matters: the doctrine records a candidate gate that scored 4/4 precision while its
positive control returned 0 true positives, because its vocabulary came from imagination.

### Measurement

Two structurally independent implementations. **(1)** the census regex below. **(2)** a scanner
that finds bracketed array literals, extracts every `value: '…'` inside one, and reports arrays
holding ≥2 vocabulary members. They agree on **3 files** and cross-check exactly on the count:
implementation 2 reports arrays with 6, 5 and 3 vocabulary entries; implementation 1's
"entry followed by another" semantics predicts 5 + 4 + 2 = **11**, which is what it returns.

**All 3 sites opened by hand — precision 3/3:**

| site | mirror |
| --- | --- |
| `sub_events/components/EventLogList.tsx:62` | 6 event statuses; offers `processed` (not a union member), omits `delivered` (99.4 % of rows) |
| `triggers/sub_live_stream/LiveStreamTab.tsx:29` | 5 event statuses, the same list minus `processed`; also omits `delivered`; labels 4 through i18n and hardcodes `'Skipped'` because the catalog has no key |
| `sub_activity/components/GlobalExecutionList.tsx:61` | 3 execution statuses (`completed`, `failed`, `running`) against a 6-member `status_tokens.execution` — misses `queued`, `cancelled`, `error` |

Two independently hand-written mirrors of the **same** vocabulary, drifting from each other and
from the union in different directions, is the condition in its purest form.

**Positive control**: the compliant idiom in the same repo — an option list **derived** by
`.map(` over a declared collection, `{ value: <expr>, label: <expr> }` with a non-literal value.
**55 matches across 40 files.** This is a *concept* control, not a strict partition: the derived
lists are over other domains, because there is no site anywhere that derives a *status* filter
from a status declaration. That absence is itself the finding, and it is why the control is
stated as 55/40 rather than as a percentage of one population.

**Site-level overlap against every committed rule that can reach these three files: 0 of 11.**
Five rules share a file (`typo-token-overpainted`, `hand-rolled-disabled-state`,
`native-title-tooltip`, `looping-framer-animation`, `live-region-born-with-its-message`); none
shares a site. `frozen-ui-copy-constant` does not fire here — its pattern requires a space inside
the string and these labels are single words, which is worth knowing because it means the
untranslated `label: 'Completed'` beside each of these values is currently counted by nothing.

**Fail-loud**, all five exercised against a scratch fixture tree: a rise fails; a silent drop
fails; corrupting the token list to nonsense produces the *structural* "matched zero files
anywhere" failure rather than a clean report; emptying the control's population fails
structurally; a floor above the walk count fails. **Correct end state is not zero** — a filter
list must exist; it must be *derived*, and at that point the rule's matches fall to zero and it
should be **deleted** rather than baselined at zero.

### The rule

```json
{
  "id": "handwritten-status-filter-mirror",
  "goldenPath": "docs/concepts/golden-paths/live-event-console.md",
  "title": "A filter enumerates a closed status vocabulary as its own string literals, so nothing checks that it covers the vocabulary or that its members exist in it",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\{\\s*value\\s*:\\s*['\"](?:cancelled|completed|dead_letter|delivered|discarded|error|failed|pending|processed|processing|queued|retrying|running|skipped)['\"]\\s*,\\s*label\\s*:(?=[\\s\\S]{0,400}?\\{\\s*value\\s*:\\s*['\"](?:cancelled|completed|dead_letter|delivered|discarded|error|failed|pending|processed|processing|queued|retrying|running|skipped)['\"]\\s*,\\s*label\\s*:)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A `{ value: '<status token>', label: … }` option entry followed within 400 characters by a second one — i.e. a hand-written mirror of a closed status vocabulary, not a single option. PROXY FOR the stack-free condition: an authoring surface retypes the members of a closed vocabulary as literals, so nothing checks COVERAGE (an option missing for a value the column holds) or MEMBERSHIP (an option for a value the column can never hold). Both failures are invisible from the filter: an option nobody can select looks exactly like a filter that works. THE SECOND ENTRY IS CARRIED IN A LOOKAHEAD so the match does not consume it; a consuming form pairs entries up (1-2, 3-4) and reports half the count on odd-length lists. THE WORD LIST IS DERIVED FROM THE TREE, never invented — the union of three declarations: EVENT_STATUS_COLORS's keys (src/lib/design/eventTokens.ts:111-120, i.e. the PersonaEventStatus union, 8), en.json status_tokens.event (5) and status_tokens.execution (6), deduped to 14. The doctrine records a candidate gate that scored 4/4 precision while its control returned 0 true positives because its vocabulary came from imagination; this one comes from the files. MEASURED 2026-08-17 at 6c97502d3 by two structurally independent implementations — this regex, and a scanner that finds bracketed array literals and counts vocabulary members inside each — which agree on 3 files and cross-check exactly on the count: the array scanner reports arrays holding 6, 5 and 3 vocabulary entries, and the entry-followed-by-another semantics predicts 5+4+2 = 11, which is what this pattern returns. ALL 3 SITES OPENED BY HAND, precision 3/3: EventLogList.tsx:62 (6 event statuses; offers `processed`, which is not a member of PersonaEventStatus at all, and OMITS `delivered`), LiveStreamTab.tsx:29 (the same vocabulary, hand-written a second time, minus `processed`, also omitting `delivered`, and hardcoding 'Skipped' because status_tokens.event has no key for it), GlobalExecutionList.tsx:61 (3 of the 6 status_tokens.execution members, missing queued/cancelled/error). LIVE CONSEQUENCE, executed against a read-only copy of the operator's personas.db: persona_events holds 4,972 rows whose status column contains exactly `delivered` (4,941 = 99.4%) and `skipped` (31). FIVE of EventLogList's six real options select ZERO rows, and 4,941 of 4,972 rows are unreachable through any setting except 'all'. SITE-LEVEL OVERLAP against every committed rule that can reach these three files: 5 rules share a FILE, ZERO share a SITE. Note that frozen-ui-copy-constant does NOT fire on `label: 'Completed'` — its pattern requires a space inside the string — so the untranslated label beside each of these values is currently counted by nothing. LEGAL FIX: derive the option list from the vocabulary's declaration — `(Object.keys(EVENT_STATUS_COLORS) as PersonaEventStatus[]).map(s => ({ value: s, label: tokenLabel(t,'event',s) }))` — which makes coverage automatic and membership a compile error; the repo already does exactly this shape at 55 sites in 40 files for other domains (see the positive control), and at zero sites for a status. THAT ZERO IS THE FINDING. CORRECT END STATE IS ZERO MATCHES, at which point DELETE this rule rather than baselining it at zero. PRECONDITION (re-derive per repo, do NOT port): the token list is specific to this repo's status vocabularies, and the `{value,label}` shape is specific to its option convention. A repo whose filters take a bare string[] or an enum-keyed record carries no `value:` literal and scores ZERO while the condition is present at full scale."
  },
  "exclude": [
    {
      "path": "**/__tests__/**",
      "reason": "test fixtures construct status option lists to exercise filter behaviour; they are not authoring surfaces and mirror nothing a user can select"
    }
  ],
  "baseline": { "files": 3, "matches": 11 },
  "floor": 3000
}
```

```json
{
  "id": "handwritten-status-filter-mirror-positive-control",
  "goldenPath": "docs/concepts/golden-paths/live-event-console.md",
  "title": "CONTROL: the compliant idiom — an option list DERIVED from a declared collection rather than typed as literals",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\.map\\(\\s*\\(?\\s*[A-Za-z_$][\\w$]*\\s*\\)?\\s*=>\\s*\\(?\\s*\\{\\s*value\\s*:\\s*(?!['\"])[^,}]{1,60},\\s*label\\s*:",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "The same `{ value, label }` option shape, produced inside a `.map(` over a declared collection with a NON-LITERAL value — the form the gate above routes callers to. 55 matches across 40 files. This is a CONCEPT control, not a strict partition: every one of the 55 derives an option list over some OTHER domain (personas, models, projects, connectors), because there is no site anywhere in the tree that derives a STATUS filter from a status declaration — that absence is the gate's finding, which is why the control is reported as 55/40 rather than as a share of one population. If this control ever returns zero, the repo has stopped deriving option lists at all and the gate above is measuring a convention that no longer exists; the runner fails structurally rather than reporting a clean codebase. Carries no baseline, per the doctrine's control contract."
  },
  "exclude": [
    {
      "path": "**/__tests__/**",
      "reason": "same population boundary as the gate it controls — both must scan identical file sets or the comparison is between different denominators"
    }
  ],
  "floor": 3000
}
```

### What the gate cannot reach, and the instruments that would

- **D4 (the label catalog cannot name the majority status)** — a **set-equality test**, not a
  ratchet: assert `Object.keys(en.status_tokens.event)` equals the `PersonaEventStatus` union's
  members, sorted, with `toEqual`. The repo already has one of these
  (`src/i18n/__tests__/chainStopReasons.parity.test.ts`); it covers one vocabulary of 66.
  Containment is not enough — the failure here is bidirectional (`processed`/`retrying` on one
  side, `delivered`/`completed`/`skipped`/`dead_letter`/`discarded` on the other).
- **D2 (a live surface stops being live under filter)** — a **test over the live path**: mount
  the console, apply a filter, push an event through the bus mock, assert it renders. It is one
  assertion and it fails today.
- **D1** is not a gate at all. It is an extraction: one shared ingest hook, two consumers.

---

## 12 Corrections

### 12.1 — `sides: "client"` upheld, the third time, and the mechanism is worth naming

Twelve deviations. **Eleven are client-side**, including all four of the largest (D1, D2, D3, D7).
The only server-side contribution is D10's `source_type` slug, which is another path's finding,
and D12's CDC producer — which is *correct*.

This matters because the label has just been contradicted twice in this same batch
(`alert-rule-editor` §12.1, `anomaly-marker` §12.1). The difference is structural and matches the
two prior upholdings (`bulk-selection-actions`, `long-list-rendering`): **the server never sees
the DOM — and it also never sees the buffer.** Batching, pausing, windowing and "is this view
still attached to the stream" are properties of a rendering process, and no backend change can
express any of them. When the leaf's subject is the *client's own memory of a stream*, the label
holds.

Ledger after this batch: `sides: "client"` — **9 contradicted, 3 upheld**, and all three
upholdings share one mechanism.

### 12.2 — `convergence: converged`: untested across repos, and confirmed *inside* one

The sibling oracle was **not run** — this is a Mode-2 batch of three leaves sharing one
measurement pass, and the cross-repo sweep was the item cut. Per doctrine, an unrun sweep is not
evidence in either direction and is recorded as owed, not reported as a silence.

But a different and stronger result did come out of this leaf, and it is the first of its kind in
the corpus: **the convergence is intra-repo, and it is a drift.** Two components in this codebase
independently arrived at the same live-console architecture — same singleton bus listener, same
200-row window, same `{value,label}` status filter — and then diverged on every property that
matters (D1's table), including hand-writing the *same* status vocabulary twice with two
different sets of mistakes (§9). The oracle's usual question is "did another repo reinvent this?"
The answer here is "this repo did, and the copies have already drifted", which is evidence for
the prescription and against the idea that agreement is durable. Worth adding to the oracle's
repertoire: **check whether the repo already answered the question somewhere else before asking
the fleet** — the same check [`entity-picker`](./entity-picker.md) earned from the other side.

### 12.3 — the brief's three primed leads: all three verified, one in a surprising place

- *"`EventLogList.tsx` slices a slug out of `source_type` that resolves 0 of 4,166 times while
  `source_id` resolves 4,166/4,166"* — **verified exactly**, both halves, by two independent
  `EXISTS` subqueries. D10.
- *"all 4,972 event rows render a raw status token"* — **verified exactly**, and **extended**:
  the reason the canonical fix does not work is D4, which the neighbour could not have seen
  because it was measuring trails, not vocabularies.
- *"39 listeners exist on an event that has never been published"* — **verified**, and the
  location is worth recording. `trigger_fired` has **0 rows** in `persona_events` and **0 rows**
  in `persona_event_subscriptions` — the table one would check first. The 39 are
  `persona_triggers` rows whose `config` JSON names `trigger_fired`
  (`SELECT COUNT(*) FROM persona_triggers WHERE config LIKE '%trigger_fired%'` → **39**, of 189
  `event_listener` triggers). A sweep of the subscriptions table alone would have reported the
  claim as false. Owned by [`domain-event-publication`](./domain-event-publication.md) D3; the
  table correction is offered upward.

### 12.4 — a correction to this leaf's own first measurement

The first pass reported D7 as "the sort has no tiebreaker" and looked for duplicate `created_at`
values in the table, expecting to find them the way `audit-trail-view` D7 does. It found
**zero of 4,972** — `created_at` is written at nanosecond precision and is genuinely unique — and
the finding was nearly discarded as cleared. Re-running the comparison **at the precision the
client actually sorts on** (`Date.parse`, milliseconds) returns **219 colliding timestamps
covering 442 rows, 8.9 %**.

The generalisable form: **when you check whether an ordering key is unique, check it at the
precision of the code that reads it, not at the precision of the column.** A key that is unique
in storage and ambiguous after parsing is a defect the database can never show you, and the first
measurement was clean, plausible, and pointed the wrong way.

### 12.5 — what was not done

- **No fix was applied**, per the campaign's no-destructive-applies rule. D6 in particular is a
  two-line change that alters what a live surface shows; it belongs in
  [`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md) with D2 and D3.
- **The `LiveStreamTab` pause path was read, not exercised.** Its `isPaused` is read from state
  inside a callback handed to `useEventBusListener`, and whether the singleton re-registers the
  callback per render (making the read fresh) or holds the first one (making pause a no-op) was
  **not** determined — `createSingletonListener` maintains a `Set<Subscriber>` and the
  registration effect's dependency array was not traced to the end. Recorded as an untested
  hypothesis rather than reported as a defect. It is the one thing that would demote D1's
  exemplar, and it deserves a real test, not a reading.
- **§1, §3, §4, §5, §6 and §8 are omitted** by the short-form tier. Nothing measured was dropped
  to fit; what is missing is prose, not evidence.
