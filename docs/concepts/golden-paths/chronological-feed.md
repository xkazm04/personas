# Golden path — Chronological feed

> Situation node: `product-surfaces/lists-and-tables/chronological-feed` (recurrence 9, risk medium) ·
> [situation spine](../situation-spine.md)
> Composed 2026-08-17 at `de274d14d`. Sweep: **4,801 `.ts`/`.tsx`** walked by a brace/paren-matched
> `.sort()` comparator extractor (structural) and again by a flat regex (the census-rule shape);
> **963 `.rs`** walked twice for SQL ordering keys — once through
> `scripts/census/lib/instruments/extractRustStrings.mjs` and once by a bespoke raw scanner;
> seventeen feeds and their Rust/SQL producers read in full; a census-runner validation of one
> published rule + its positive control; and **the ordering keys replayed against the
> 2026-08-17 purge backup** (`%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`,
> copied read-only, queried by two independent implementations, deleted after).
> Dimensions: **function · performance · resilience · ui**.
> **Settles:** what a feed is ordered *by* when its items come from more than one place — who
> mints that key, whether it is unique, whether the client's sort agrees with the server's, and
> where the day separators fall.

---

## §0 — The headline

**Every raw timestamp column in this database is totally ordered. The one ordering key with a
45% collision rate is one the application manufactured at read time — and it manufactured it in
order to make four sources comparable, which is exactly what this leaf is about.**

Replayed against the purge backup, two independent implementations agreeing on every cell (a
SQL `GROUP BY … HAVING COUNT(*)>1` and a JS `Map` over the raw column values):

| population | rows | rows tied on the ordering key | worst tie | tie rate | fractional seconds? |
|---|---:|---:|---:|---:|---|
| `persona_executions.created_at` (global) | 2,188 | 2 | 2 | **0.1%** | 400/400 |
| `persona_executions.created_at` per persona | 2,188 | 0 | 1 | **0.0%** | 400/400 |
| `persona_memories.created_at` per persona | 6,535 | 0 | 1 | **0.0%** | 400/400 |
| `persona_events.created_at` | 4,972 | 0 | 1 | **0.0%** | 400/400 |
| `credential_audit_log.created_at` | 9,830 | 10 | 2 | **0.1%** | 400/400 |
| `provider_audit_log.created_at` | 4,001 | 0 | 1 | **0.0%** | 400/400 |
| `persona_healing_issues.created_at` | 205 | 0 | 1 | 0.0% | 205/205 |
| `team_memories.created_at` | 347 | 0 | 1 | 0.0% | 347/347 |
| `persona_manual_reviews.created_at` | 194 | 0 | 1 | 0.0% | 194/194 |
| **`team_channel_messages.created_at`** | **1,491** | **674** | **7** | **45.2%** | **0/400** |

And the mechanism, measured directly:

| table | tied on the **raw** column | tied on the **second-truncated** key the channel read computes |
|---|---:|---:|
| `persona_events` | **0 (0.0%)** | **3,583 (72.1%)** |
| `team_memories` | 0 (0.0%) | 153 (44.1%) |
| `team_channel_messages` | 674 (45.2%) | 674 (45.2%) |

`src-tauri/src/commands/teams/team_channel.rs` selects
`strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) AS at` at `:164`, `:230`, `:295` and
`:356`, and the field's own doc comment (`:40-41`) says *"Normalized RFC3339 UTC (second
resolution) — sortable everywhere."* That normalization is **correct and necessary** — four
tables with four different timestamp conventions cannot otherwise be merged into one ranking —
and it takes an event stream from zero collisions to **72% collisions** as a side effect.

The module knows this and handles it completely: every one of the four source queries orders
`… ORDER BY at DESC, e.id DESC`; every cursor predicate is composite
(`at < ?2 OR (at = ?2 AND ('tae-' || e.id) < ?4)`, `:174-176`) with the ids **namespaced per
source** (`'tae-'`, `'pe-'`) so four tables' ids live in one comparable key space; the
in-process merge repeats the rank with a comment saying it must (`:405-407`); and the header
comment at `:118-120` records the bug this replaced — *"dropped (or duplicated) by the old
timestamp-only `at < ?` cursor."*

**Fifteen lines of concept away, a second consumer of the same items sorts them without the
tiebreaker.** `useLensFeed.ts:67` has it, with the reason written down:

```ts
// Same comparator the server ranks by — (at, id) desc. The merge must sort
// identically or paging would interleave wrongly.
flat.sort((a, b) => b.item.at.localeCompare(a.item.at) || b.item.id.localeCompare(a.item.id));
```

`mergedFeed.tsx:42`, same directory, same `TaggedItem[]`, same `at`, does not:

```ts
flat.sort((a, b) => b.item.at.localeCompare(a.item.at));
```

`Array.prototype.sort` is stable, so for the 45% of items sharing a second the surviving order
is the **input** order — which `:34-40` builds by iterating `teams`. The overlay then cuts at
`LIVE_FEED_WINDOW = 600` (`types.ts:39`, applied at `:46`). So the live overlay's ranking within
a tied second is *the order the user's teams happen to be listed in*, and a window boundary
landing inside a 7-way tie keeps or drops items by team order rather than by time.

**That is the whole leaf in one directory: the same author, the same data, the same day —
one file carries the tiebreaker and documents why, the adjacent file does not.** The
prescription is not "add a tiebreaker"; it is that **the ordering key of a merged feed is a
contract, and both ends must state it.**

---

## §0.1 — Corrections to the brief

**1. "A feed ordered by a client-generated timestamp interleaves wrongly the moment two sources
write" — upheld, and it is the one lead that survived intact.** Twelve sites mint a feed item's
ordering key from `new Date()`; nine of them enter a list ranked alongside server-timestamped
rows. It is this document's §9 rule.

**2. "A feed ordered by `rowid`/insertion order is stable but lies about time" — not found.**
Swept all 963 `.rs`: **zero** feed-serving query orders by `rowid` or by insertion order alone.
Three reads use `rowid` *as a tiebreaker* after a clock column (`dev_mode.rs:344`,
`cycle_report.rs:265,317`), which is the compliant form, not the hazard. The brief's dichotomy
has only one live side here. Reported as a cleared claim.

**3. "Whether any of them paginate on a non-unique sort key … measurable from the SQL alone" —
measurable, measured, and the answer is four sites, one of which is a test fixture.** Both
implementations found the same set. `ORDER BY <clock column>` + `OFFSET`, with no unique second
key:

| site | verdict |
|---|---|
| `db/src/repos/communication/messages.rs:60` — `persona_messages ORDER BY created_at DESC LIMIT ?1 OFFSET ?2` | **true** |
| `db/src/repos/execution/executions.rs:253` — `list_items_by_persona_id … ORDER BY created_at DESC LIMIT ?2 OFFSET ?3` | **true** |
| `db/src/repos/execution/executions.rs:1983` — `cleanup_old_executions … ORDER BY created_at DESC LIMIT 1 OFFSET ?2` | **true, but not a feed** — it picks the Nth-most-recent `created_at` as a *retention threshold*, so a boundary tie makes the sweep keep N−1 or N+k rows. Different consequence, different leaf. |
| `db/src/query_builder.rs:432` | **false positive** — inside a brace-matched `#[cfg(test)]` block; it is the builder's own `assert_eq!` on its emitted SQL. |

**But the hazard is 0.0–0.1% live on those tables** (table above), because their writers use
nanosecond `to_rfc3339()`. So the honest finding is: *the offset-paging defect is real, is
correctly identified from the SQL, and is currently latent* — while the 45%-collision key that
actually reorders under the user is one the read layer created. **The brief pointed at the SQL
and the answer was at the projection.**

**4. The brief's framing "establish which this repo does per feed — there is more than one" is
right and undersells it: there are at least seventeen**, and they disagree not only on the
tiebreaker but on the *type* of the comparison — `localeCompare` on a string, `Date.parse`
subtraction, epoch-ms subtraction, and two comparators that can never return `0`.

---

## §1 — Principle (stack-free head)

> **P1 — physics.** *A merged feed's ordering key must be total.* If two items from different
> sources can carry the same key, the feed has no defined order and both the render order and
> any page boundary become artifacts of iteration order. Warrant: this is a property of the key,
> not of the code; it does not depend on language, database or framework. Independently
> rediscovered inside this repo by two modules and, per §11, elsewhere in the cohort.
>
> **P2 — physics.** *Normalizing a key for comparability destroys resolution, and the loss must
> be paid for at the same layer.* Whoever truncates, rounds, or coerces the ordering key owns
> adding the tiebreaker — because after the projection, no consumer can tell a real tie from a
> manufactured one. Warrant: measured — 0% → 72% collisions from one `strftime`.
>
> **P3 — physics.** *Every consumer of a merged ranking must rank identically.* A server that
> pages on `(t, id)` and a client that re-sorts on `t` alone do not disagree loudly; they
> disagree only at ties and only at page boundaries, which is the hardest possible failure to
> observe.
>
> **P4 — physics.** *An item's position in time must be established by whoever can observe the
> time consistently for all items.* A key minted on the rendering device for one item, ranked
> against keys minted elsewhere for the others, compares two clocks. Warrant: independent of
> clock skew — even a perfect client clock reads a different instant than the one the server
> recorded for the sibling row.
>
> **P5 — physics.** *A day separator's boundary and its label must be computed in the same time
> zone.* Warrant: arithmetic. A boundary in UTC with a label in local time places the separator
> `offset` hours from midnight and files the first `offset` hours of each local day under the
> previous day's header.
>
> **P6 — local calibration (house convention).** *Cap a live overlay's window and let the
> durable history live in a separately paged cache.* Warrant: this is a product decision about
> what an overlay is for, not a correctness property.

---

## §2 — The one way

**Decide the ordering key once, make it total, and write it down where both ends can see it.**
Concretely: rank on `(timestamp, id)` — never on the timestamp alone — and if the sources are
heterogeneous, namespace the ids so they compare in one key space (`'pe-' || e.id`). Do the
merge and the cap **server-side** where it can page: give each source its own `LIMIT` so a
chatty source cannot starve a quiet one, page with a **keyset cursor whose predicate mirrors the
sort exactly** (`t < ?c OR (t = ?c AND id < ?cid)`) rather than `OFFSET`, and re-rank the union
with the identical comparator. Then, on the client, **re-use that comparator verbatim** and say
so in a comment — a merged feed's client sort exists only to interleave already-ranked pages,
so any divergence from the server's rank is a bug by construction. Never mint an item's ordering
key with `new Date()`: an optimistic row must either carry the key the server will assign
(echoed back on confirm) or be rendered **outside** the ranked list until it has one. Bucket by
day with the shared `timeGroupKey` helper, which computes local-midnight boundaries — do not
re-derive day buckets from an ISO string prefix. And when the key must be normalized so that
different sources can be compared at all, **treat that normalization as the moment the
tiebreaker becomes mandatory**, because it is the moment ties start being manufactured.

---

## §3 — Mandated primitives

| Use | What it gives you |
|---|---|
| `src-tauri/src/commands/teams/team_channel.rs` — `read_channel` | The reference **server-side** fan-out: per-source `LIMIT`, composite keyset cursor, namespaced ids, mirrored in-process re-rank. Copy its shape, not its SQL. |
| `db/src/repos/orchestration/team_assignments.rs:392` | The reference **keyset cursor**: `WHERE (created_at > ?2 OR (created_at = ?2 AND id > ?3)) ORDER BY e.created_at ASC, e.id ASC LIMIT ?4`. |
| `db/src/repos/communication/manual_reviews.rs:632-676` — `list_page` | The reference **paged queue**: composite cursor, `fetch = limit + 1` for `has_more`, contract documented at `:625-631`. |
| `db/src/repos/communication/events.rs:427-468` — `get_recent_after` | The reference **forward** cursor (`created_at > ?1 OR (created_at = ?1 AND id > ?2)`). |
| `features/fleet/monitor/channels/useLensFeed.ts:67` | The reference **client** comparator — and the comment explaining why it must match the server. |
| `features/shared/components/display/grouping.ts` — `timeGroupKey` / `timeGroupLabels` / `buildGroupRows` | The shared day/relative bucketer. Local-midnight boundaries (`:34-39`), `older` fallback for unparseable input, consecutive-run header insertion documented at `:90-98`. |
| `features/shared/components/display/UnifiedTable` — `groupBy` + `rowHeight` + `onEndReached` + `scrollRestoreKey` + `rowReveal` | The rendering half. `EventLogList.tsx:441-462` is the only site in the tree using the whole contract at once. |
| `features/shared/components/display/RevealItem` + `useRevealTracker` | Row entrance for non-table feeds, id-guarded so polling never replays the animation. |

---

## §4 — Steps

1. **Enumerate the sources and say how many there are out loud.** Seventeen feeds were found;
   the largest is five (`ActivityTab.tsx:47-53`).
2. **Pick the ordering key and check that it is total over the *union*.** Per-source uniqueness
   is not enough. Two tables can both be unique and still collide with each other.
3. **If the key needs normalizing for comparability, normalize it — and add the tiebreaker in
   the same edit.** P2. Namespace the ids if the sources are different tables.
4. **Do the merge server-side where a cursor exists.** Per-source `LIMIT`, composite cursor,
   mirrored re-rank. Client-side merges cannot page correctly, because a client cannot bound
   what it has not fetched.
5. **On the client, copy the server comparator verbatim** and comment that it is a copy.
6. **Handle the optimistic item explicitly.** Either echo the server key on confirm or render it
   outside the ranking. Never `new Date().toISOString()` into the ranked list.
7. **Bucket with `timeGroupKey`.** Then *stop* — `UnifiedTable`'s `groupBy` inserts sticky
   headers on key transitions over the already-sorted data, and pairing it with a matching sort
   is the whole feature.
8. **Make the group key and the sort key the same expression.** If you sort on
   `started_at || created_at`, bucket on `started_at || created_at`.
9. **Give the list `rowHeight` and `onEndReached`** — see [`long-list-rendering.md`](./long-list-rendering.md);
   `EventLogList.tsx:441-462` is the exemplar.

---

## §5 — Anti-patterns

| Anti-pattern | The failure mode |
|---|---|
| **Sorting a merged feed on the timestamp alone** | Ties resolve to iteration order. Stable sort makes it *deterministic per render* and *different per input order*, which is the worst combination: it reproduces on your machine and not on the user's. |
| **Truncating the key for comparability without adding a tiebreaker** | Manufactures ties. 0% → 72% measured. |
| **A client re-sort that differs from the server's rank** | Pages interleave wrongly; nothing errors. |
| **`OFFSET` paging on a non-unique sort key** | A row shared with the page boundary is delivered twice or never. Latent here at 0.0–0.1%, catastrophic on a second-resolution key. |
| **A timestamp-only cursor under a composite `ORDER BY`** | The read is correctly ordered and the *cursor* still straddles ties. `events.rs:1319` (`until` → `where_lte("created_at")`) under `order_by_multiple([("created_at","DESC"),("id","DESC")])` at `:1335` is this exact shape, and it is the Event Log's "load older" path. |
| **`new Date().toISOString()` as an item's ordering key** | Compares the renderer's clock against the server's for sibling rows in one list. |
| **Pushing an item into the list *after* the sort** | `useConversation.ts:69-74` appends proposals after `buildConversation` — they are unranked by construction, which the comment acknowledges; the hazard is that the array now looks sorted and is not. |
| **A comparator that can never return `0`** | `(a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)` reports "greater" for equal elements. That is not a consistent total order and the specification does not define the result. |
| **Deriving a day bucket from an ISO prefix** | `at.slice(0, 10)` on a `…Z` string is a **UTC** calendar day. Pairing it with a local-time label is P5's failure. |
| **Sorting client-side to fix a bad server order** | Stable sort preserves whatever arbitrary order the database returned, so it fixes nothing and hides the cause. |

---

## §6 — Evidence

**The one site to copy, server side:** `src-tauri/src/commands/teams/team_channel.rs`
`read_channel` (`:144-410`) — four sources, four independent `LIMIT`s, four composite keyset
predicates, namespaced ids, one mirrored re-rank, and a header comment that names both the bug
it fixed and the starvation bug the independent limits fixed.

**The one site to copy, client side:** `features/fleet/monitor/channels/useLensFeed.ts:54-76` —
the k-way merge, the comparator that mirrors the server, and a `mergeHorizon` that refuses to
show rows past the point where the least-loaded source's page ends (`:70-71`) so an
incompletely-paged source cannot create a hole in the middle of the timeline.

**The one site to copy, for rendering:** `features/overview/sub_events/components/EventLogList.tsx:441-462`
— `groupBy={groupOf}` over `timeGroupKey(created_at)` with the same key the sort uses,
`rowHeight`, `scrollRestoreKey` composed from route + every filter, `rowReveal={{resetKey}}`,
and `onEndReached={hasMoreOlder && !isLoadingOlder ? loadOlder : undefined}`.

---

## §7 — Deviations

Seventeen feeds enumerated. **57 chronological `.sort()` comparators** across 52 files (brace-matched
extractor); **10 carry a tiebreaker, 47 do not** — a 17.5% adoption rate for the compliant form.

> **The two implementations disagreed here and the disagreement is the finding.** The flat
> regex — the shape a census rule would have to use — found **41 of the 57** (72% recall). The
> 16 it missed are all comparators with a *statement body*: a `switch`, an early `if`, a hoisted
> `const ta = …`. Those include `PersonaOverviewFilters.tsx:90`, `useDrive.ts:567`,
> `credentialListTypes.ts:137`, `HealingTimeline.tsx:242` and `ActivityTray.tsx:26`. A
> single-expression regex systematically under-samples exactly the comparators complex enough to
> have gone wrong. Structural extraction is the count that should be cited.

### A — `mergedFeed.tsx:42` drops the tiebreaker its sibling documents

Covered in §0. Same directory, same items, same 45%-collision key.
**Fix:** one `|| b.item.id.localeCompare(a.item.id)`. Deferred (§10) — it changes the live
overlay's ordering.

### B — `events.rs:1319` — a timestamp-only cursor under a composite sort

`search()` orders `(created_at DESC, id DESC)` (`:1335`) and bounds with
`qb.where_lte("created_at", …)` (`:1319`) from the client's `until` (`useEventLog.ts:276-308`).
`persona_events` ties at 0.0% on the raw column, so this is latent — but `<=` on a second that
*does* tie re-delivers every row in that second. The sibling `get_recent_after` (`:427-468`) has
the composite predicate; `search` does not. Same file, same table, both shapes present.

### C — `team_channel.rs`'s cursor predicate is non-sargable

`WHERE strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) < ?2` (`:174-176`, `:242-244`,
`:299-301`, `:361-363`) applies a function to the column, so no index on `created_at` can serve
it — every page is a scan of the team's rows. It is the correct *semantics* (the cursor must be
in the same key space as the sort) with the wrong *shape*; the fix is to keep a stored
normalized column, or to bound on the raw `created_at` as a coarse pre-filter and keep the
truncated comparison as the exact one. Measured cost is currently small (1,491 rows) and it
scales with the busiest table in the union.

### D — Two comparators that cannot return `0`

`plugins/twin/sub_channels/ContactThread.tsx:49` and `.../SentReplies.tsx:47`:
`(a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)`. Equal timestamps report "a is greater",
which violates the comparator contract. The compliant three-way form exists in the tree —
`teams/sub_mastermind/lib/sceneStore.ts:69`,
`(a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)` — so this is
a transcription slip, not a knowledge gap. `twin_communications` holds **0 rows** in the purge
backup, so no user has seen it.

### E — `conversationModel.ts` buckets in UTC and labels in local time

`dayKeyOf(at) = at.slice(0, 10)` (`:39-41`) is the **UTC** calendar day, because `at` is
`…Z`-suffixed by `team_channel.rs`. `dayLabel` (`:45-53`) computes
`new Date(at).setHours(0,0,0,0)` — **local** midnight. At the operator's UTC+2, the separator
therefore lands at **02:00 local**, and every message between 00:00 and 01:59 local is filed
under the *previous* day's header. The repo's own `timeGroupKey` (`grouping.ts:34-39`) computes
local-midnight boundaries correctly and is used by three other feeds; this is a local
re-implementation of a solved problem, which is the doctrine's "the same repo answers the same
question somewhere else" shape.

### F — Twelve items whose ordering key is minted by the renderer

The §9 rule's population. Nine are true feed items (§9). The two that matter most:

- `hooks/realtime/useRealtimeEvents.ts:244-245` (dead code since `sub_realtime/` was removed; file deleted 2026-09-02 in `44b0bc8bd`) and `hooks/realtime/emitDeploymentEvent.ts:52-53` (fixed 2026-09-02 in `c130ca956`: the deploy event now carries no `created_at` and rides at the live end of the feed, unranked)
  each synthesize a full `PersonaEvent` with **both** `processed_at` and `created_at` from
  `new Date()`, and push it into the same `recentEvents` store the Event Log ranks on
  `created_at` (`useEventLog.ts:237-245`) — beside rows whose `created_at` came from SQLite.
- `stores/slices/pipeline/teamSlice.ts:186,252` mint `created_at` for optimistic
  `persona_team_members` / `persona_team_connections` rows, and the roster read is
  `ORDER BY created_at ASC` (`teams.rs:347`) — so an optimistic member's position in the roster
  is decided by the renderer's clock. (See [`member-roster.md`](./member-roster.md).)

### G — `GlobalExecutionList`: the group key and the default order disagree

`GlobalExecutionList.tsx:161` returns unsorted when `startedSort === null` (the default),
deferring to the SQL `ORDER BY e.created_at DESC` (`executions.rs:311`). The day buckets are
computed from `started_at || created_at` (`:264`). For any execution whose `started_at` and
`created_at` fall on different sides of a bucket boundary, a row lands under the wrong sticky
header. Step 8 exists because of this site.

### H — The 47 tiebreaker-less comparators, and why they are not all defects

Most rank a single-source list where the key is already unique (0.0% ties measured on
`persona_memories`, `persona_events`, `persona_executions`-per-persona). Listing them as
violations would be the gate-fires-on-correct-content failure. The ones that are defects are the
ones ranking a **union**: `mergedFeed.tsx:42` (§7-A), `ActivityTab.tsx:108` (five sources),
`useUnifiedInbox.ts:97` (four), `ManualReviewList.tsx:134` (local + cloud),
`overviewHelpers.ts:127` (three, with one source emitting **two rows per record** — `task-created`
and `task-end`, `:92`/`:104` — so two rows of the same task can tie on nothing and interleave
with a scan). **5 of 47.**

### I — `MemoryTimeline.tsx:132` — an index key inside a reordered timeline

`<ManualGroup key={`manual-${i}`} …/>` where `i` indexes an array built by interleaving run
groups with manual groups by timestamp (`:35-53`) and then reversed (`:65`). Inserting a run
group above renumbers every manual group below it.

---

## §8 — Gaps

1. **There is no shared merge helper.** `useLensFeed` and `mergedFeed` are two hand-written k-way
   merges over the *same store slice*, in the same directory, and they differ. A
   `mergeChannels(sources, { key, tiebreak })` would have made §7-A unrepresentable.
2. **`grouping.ts` has no bucket-key/sort-key coupling.** `UnifiedTable`'s `groupBy` accepts any
   function; nothing checks it agrees with the sort. §7-G is downstream of that.
3. **The `TeamChannelItem.at` contract is prose, not a type.** `at: String` with a doc comment.
   A newtype would not reach it — the value crosses a serialization boundary into TypeScript as
   `string` (doctrine, "where types cannot reach", item 5) — but a *branded* TS type on the
   frontend side would at least stop `at` being compared without `id`. See §9-T.
4. **No cursor abstraction.** `manual_reviews.list_page`, `events.get_recent_after`,
   `team_assignments`, and `team_channel` each hand-roll the same composite keyset predicate;
   `events.search` hand-rolled a different, weaker one.
5. **The purge removed the leaf's own reproduction data.** `persona_executions`,
   `persona_memories` and `twin_communications` are all **0 rows** in the live file. Every tie
   measurement in this document is historical as of **2026-08-17** and can only be reproduced
   against the named backup.

---

## §9 — The missing gate

### Published rule — `feed-item-ordered-by-the-renderers-clock`

**Signal.** An object literal assigning a *feed ordering* field from `new Date().toISOString()`.
Proxy for the stack-free condition **P4**: an item's position in a shared timeline is
established by the rendering device rather than by the authority that timestamped its
neighbours.

Validated with the real runner in a private registry (never the full registry): **12 matches in
10 files** over 4,801 walked files, after three excludes. Positive control — the **same** fields
assigned from another record's server timestamp — **46 matches in 27 files**, i.e. the compliant
form outnumbers the violating one 3.8:1 on the same anchor, which is what proves the pattern
discriminates on *provenance* and not on the field name.

**Hand-verified precision: 9/12 (75%). All twelve were opened.**

| verdict | site | why |
|---|---|---|
| TP | `hooks/realtime/useRealtimeEvents.ts:245` (file deleted 2026-09-02, `44b0bc8bd` — it had no importer) | synthetic `PersonaEvent` into the Event Log's ranked store |
| TP | `hooks/realtime/emitDeploymentEvent.ts:53` | same store, same shape |
| TP | `features/fleet/monitor/channels/useConversation.ts:73` | `at:` on a proposal pushed into a conversation ranked on `at` |
| TP | `features/plugins/companion/chat/athenaChatSend.ts:76` | `createdAt` drives the transcript's day separators |
| TP | `stores/slices/agents/executionSlice.ts:471` | `startedAt` on an optimistic run; `GlobalExecutionList` ranks on `started_at \|\| created_at` |
| TP | `stores/slices/pipeline/teamSlice.ts:186` | optimistic roster row; `get_members` is `ORDER BY created_at ASC` |
| TP | `stores/slices/pipeline/teamSlice.ts:252` | same, connections |
| TP | `plugins/obsidian-brain/sub_sync/SyncPanel.tsx:114` | `at:` on a push result rendered at `:293` beside a server-ordered `syncLog` (`:335`) |
| TP | `plugins/obsidian-brain/sub_sync/SyncPanel.tsx:142` | same, pull path |
| FP | `features/overview/sub_memories/libs/memoryActions.ts:123` | `createdAt` on a proposal object; the list is not ranked on it |
| FP | `templates/…/ChronologyAdoptionView.tsx:1108` | a build **session**'s own `createdAt` — container metadata, not an item key |
| FP | `lib/harness/plan-builder.ts:47` | a harness plan object; never rendered in a feed |

All three false positives are the same class — *a container's own `createdAt`* rather than an
item's ordering key — and that limit is stated rather than papered over. The three excludes are
vitest/MCP fixtures where minting a clock is the point of the test; each carries a prose reason,
which the engine enforces.

**How it fails loudly if its own precondition is absent.** The census runner exits non-zero when
the walk sees fewer than `floor` files (4,000 — the tree is 4,801, so a broken root or extension
list cannot read as "clean"), when the rule matches zero files anywhere, when an `exclude` stops
matching, and when the count drops without `--update`. Those are the runner's contract, not this
rule's, which is why this path does not re-derive them.

**Which condition the signal is a proxy for, for a repo adopting this path:** *the ordering key
of an item entering a shared timeline is produced by a clock other than the one that produced
its neighbours' keys.* In a repo whose optimistic updates go through a normalizer, a mutation
cache, or a server-echo, the textual proxy scores a structural zero while the condition may be
present at scale — re-derive it against your own idiom.

```json
{
  "id": "feed-item-ordered-by-the-renderers-clock",
  "goldenPath": "docs/concepts/golden-paths/chronological-feed.md",
  "title": "A feed item's ORDERING key is minted from the rendering device's clock, then ranked against sibling items whose keys came from the database",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:created_at|createdAt|started_at|startedAt|occurred_at|occurredAt|at)\\s*:\\s*new Date\\(\\)\\.toISOString\\(\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "An object literal assigns a FEED-ORDERING field (created_at / createdAt / started_at / startedAt / occurred_at / occurredAt / at) from the renderer's own clock. PROXY FOR the stack-free condition (this path's P4): an item's position in a shared timeline is established by the rendering device rather than by the authority that timestamped its neighbours, so the list compares two clocks. MEASURED 2026-08-17 at de274d14d: 12 matches across 10 of 4,801 walked .ts/.tsx files, after three fixture excludes. HAND-VERIFIED PRECISION 9/12 (all twelve opened); the three false positives are one class -- a CONTAINER's own createdAt (memoryActions.ts:123, ChronologyAdoptionView.tsx:1108, plan-builder.ts:47) rather than an item's ordering key. POSITIVE CONTROL (same fields, assigned from another record's server timestamp) returns 46 matches in 27 files, so the compliant form outnumbers the violating one 3.8:1 on the same anchor and the pattern is discriminating on PROVENANCE, not on the field name. WHY IT IS A DEFECT: replayed against the 2026-08-17 purge backup, persona_events.created_at ties at 0.0% over 4,972 rows (nanosecond to_rfc3339 writer), so a client-minted sibling key does not merely tie -- it lands at an arbitrary point in a totally-ordered stream, and useRealtimeEvents.ts:245 / emitDeploymentEvent.ts:53 push exactly such rows into the store useEventLog.ts:237-245 ranks. teamSlice.ts:186 mints created_at for an optimistic persona_team_members row whose server read is 'ORDER BY created_at ASC' (teams.rs:347), so an optimistic member's roster position is decided by the renderer's clock. LEGAL FIX: echo the server-assigned key back on confirm, or render the optimistic item OUTSIDE the ranked list until it has one. DO NOT silence a match by switching to Date.now() or to a monotonic counter -- that changes the type without changing whose clock it is. ZERO OVERLAP with clock-ordered-history-read-without-tiebreak (audit-trail-view.md), which is rooted in src-tauri/.rs and anchors on SQL text; that rule and this one are the two ends of the same key and neither can see the other's half. PRECONDITION (re-derive per repo): this proxy assumes optimistic rows are built as inline object literals in the frontend. A repo whose optimistic updates go through a normalizer, a mutation cache, or a server-echo scores a structural zero here while carrying the condition at scale."
  },
  "exclude": [
    { "path": "src/test/automation/bridge.ts", "reason": "the test-automation harness bridge fabricates fixture rows for the MCP driver; they never enter a rendered feed" },
    { "path": "src/features/plugins/dev-tools/sub_overview/__tests__/overviewHelpers.test.ts", "reason": "vitest fixture minting synthetic activity rows to assert the bucketing helper; a fixture clock is the point of the test" },
    { "path": "src/stores/slices/overview/__tests__/personaHealthSlice.bundle.test.ts", "reason": "vitest fixture; the bundle test mints a synthetic row to assert slice wiring, not ordering" }
  ],
  "baseline": { "files": 10, "matches": 12 },
  "floor": 4000
}
```

### Positive control — the inverted, compliant form

```json
{
  "id": "feed-item-ordered-by-the-renderers-clock-positive-control",
  "goldenPath": "docs/concepts/golden-paths/chronological-feed.md",
  "title": "CONTROL (must not be gated): the same ordering fields taking their value from another record's server-assigned timestamp",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\b(?:created_at|createdAt|started_at|startedAt|occurred_at|occurredAt|at)\\s*:\\s*[A-Za-z_$][\\w$]*\\.(?:created_at|createdAt|started_at|startedAt|occurred_at|occurredAt|at)\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "The COMPLIANT form on the same anchor: a feed-ordering field assigned by COPYING another record's timestamp rather than minting one. 46 matches across 27 files at de274d14d -- 3.8x the violating arm, which is what establishes that the violating pattern keys on provenance rather than on the field name. The four unified-inbox adapters (approvalAdapter.ts:21, healingAdapter.ts:21, messageAdapter.ts:28, outputAdapter.ts:65) are the clearest instance: four sources, four copies of a server column, one ranked list. conversationModel.ts:71,86,102,114 carry the same discipline through a row-clustering transform. Carries no baseline by design -- a ratchet on compliant code fails the build every time adoption improves."
  },
  "floor": 4000
}
```

### Declined — a second rule for the SQL half

The obvious companion (`ORDER BY <clock> … OFFSET` with no unique key) was built and measured:
**4 matches, 3 true.** It is **declined for overlap**, not for precision.
`clock-ordered-history-read-without-tiebreak` (owned by
[`audit-trail-view.md`](./audit-trail-view.md), baseline 78 files / 141 matches, roots
`src-tauri`, ext `.rs`) already matches `ORDER BY <clock column> [ASC|DESC] LIMIT`, which every
one of the four `OFFSET` sites also contains — **100% site overlap**, and its description
already names the table-by-table tie rates and the `team_assignments.rs` exemplar. Adding a
narrower duplicate would ratchet the same lines twice and split ownership of one condition
across two paths. The overlap check was run against the **final** pattern at **site** level, per
the doctrine, not against a draft at file level.

### T — Prefer a type over a gate: how far it reaches here

The clean fix for P1 is to make an untiebroken comparison unspellable — a branded
`FeedKey = { at: string; id: string }` with a single exported `compareFeedKey`. Held against the
qualifications: **Q3** passes (there are 17 construction sites, not one); **Q5/Q6** point at
withholding the *bare string*, not at requiring a second argument. But the doctrine's fifth
"where types cannot reach" applies squarely: `TeamChannelItem.at` crosses a **serialization
boundary** — it is minted in Rust, serialized to JSON, and arrives in TypeScript as `string`. A
Rust newtype protects nothing on the far side, and a TS brand protects nothing on the near side.
So the honest answer is that a type closes the *client* half only, and the server half stays a
convention plus the census rule above. **That split is the finding**, not a failure: it is why
this leaf needs a gate at all, and it is why the gate this path publishes points at the client
half — the half `clock-ordered-history-read-without-tiebreak` structurally cannot see.

---

## §10 — Deferred fixes (no destructive applies)

Every item below changes what a live surface shows or which rows a query returns, so all are
notes:

- `mergedFeed.tsx:42` — add `|| b.item.id.localeCompare(a.item.id)` to match `useLensFeed.ts:67`.
- `events.rs:1319` — make the `until` cursor composite, mirroring `get_recent_after:439`.
- `conversationModel.ts:39-41` — bucket via `timeGroupKey`, or compute the local calendar day;
  boundary and label must share a zone.
- `ContactThread.tsx:49`, `SentReplies.tsx:47` — adopt `sceneStore.ts:69`'s three-way form.
- `GlobalExecutionList.tsx:161` — make the default order explicit and equal to the group key.
- `messages.rs:60`, `executions.rs:253` — add `, id DESC` before considering the keyset move.
- `MemoryTimeline.tsx:132` — key manual groups by their first memory id.

---

## §11 — The convergence oracle

**Cohort established per leaf at the time of measurement**, per the doctrine — lineage checked
before any sibling is counted, since two of the five checkouts contain ports of this repo's code
and a port agreeing with its original is one data point in two coats.

**Cohort for this leaf: 4, and `personas-cloud` is a dependent rather than a peer** — the
doctrine records it as a port of this repo's scheduler that *dropped the compare-and-set*, so
its agreement is worth nothing and its **failures are worth a great deal**. `personas-web` is a
port on the grid leaf but is native on its feed code, so it is counted here.

**Result: P1 is convergent on the mechanism, and the fleet is split on applying it — with the
strongest evidence being three independently-paid costs, not the agreements.**

**Cost and failure first, because the doctrine ranks them highest:**

1. **`brainiac` wrote down what a wrong composite key cost it.**
   `crates/brainiac-store/src/memories.rs:535-540`:
   > *"`DISTINCT ON (m.id)` forces the ORDER BY to lead with `m.id`, which also orders the FINAL
   > result set — so `… ORDER BY m.id, m.created_at DESC LIMIT $2` **returned the N smallest
   > UUIDs** (and the trailing `created_at DESC` was dead…)"*
   That is a shipped bug, diagnosed, fixed and annotated — the composite key was present and in
   the **wrong order**. It is direct evidence for P1's sharper form: a tiebreaker is not a
   decoration appended to a sort, it is part of one ranking whose composition has to be right.
2. **`brainiac`'s own test had to manufacture uniqueness to be assertable.**
   `crates/brainiac-server/tests/promotions_pg.rs:47-49`:
   > *"A backlog that does not fit in a page. Ages are staggered so the queue's
   > `ORDER BY created_at ASC` **is a total order we can actually assert on**."*
   The production query is not total; the fixture is staggered so the test can pretend it is.
   That is the defect acknowledged in writing, in the artifact that exists to catch it.
3. **`personas-cloud` merges two sources with no comparator at all.**
   `packages/orchestrator/src/db.ts:726-736` — `pendingRows` (`ORDER BY created_at`) and
   `retryRows` (`ORDER BY next_retry_at`, a **different column**) are concatenated
   `[...pendingRows, ...retryRows]` and **never re-sorted**. Each source is individually ordered
   and the union is not ordered at all: every pending event outranks every retry event
   regardless of time. Fourteen lines later the same file pages with
   `ORDER BY created_at DESC LIMIT ? OFFSET ?` (`:770`) — non-unique key plus `OFFSET`, the exact
   shape §0.1 found latent here and which is *not* latent there, because the port lost this
   repo's fractional-second writers along with the compare-and-set.
4. **`vibeman` reproduces `mergedFeed.tsx:42` exactly, in a different stack, across two
   databases.** `src/lib/signals/activitySignalService.ts:120-122`:
   ```js
   signals.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
   return signals.slice(0, limit);
   ```
   Merging goal signals from `goals.db` with behavioral signals from `hot-writes.db` — and the
   two `timestamp` values are **not even the same kind of value**: one is a DB-defaulted
   `created_at` (`:39`), the other is caller-supplied and inserted verbatim
   (`behavioral-signal.repository.ts:129,142`). No tiebreaker, then a `.slice()` whose cut
   lands wherever the ties fall. `standupDataCollector.ts:167-180` is the same merge again, with
   client-minted window bounds (`const now = new Date()`, `:136`).
   **An independent reinvention of the *defect*, with a different mechanism, in a different
   language, over two SQLite files instead of four SQL sources.** Per the doctrine that is
   evidence the situation is universal — and it is the best argument in this document that
   §7-A is a class and not a slip.

**Then the agreements, weighted down as the doctrine requires:**

- **`brainiac` is the only sibling that reaches for `(t, id)` as a habit**, and it is native (no
  port lineage — `sqlx`/Postgres, its own design vocabulary). Confirmed by reading:
  `memories.rs:245` `ORDER BY m.created_at, m.id`; `entities.rs:458` `ORDER BY c.created_at, c.id`;
  `console.rs:547,4499,4627`; `http.rs:1226`. **But it is split against itself** — ~10 reads in
  the same crates order on `created_at` alone (`tokens.rs:132`, `projects.rs:48,67`,
  `library/skills.rs:160,181,395`, `documents.rs:693,725`, `mcp.rs:1529`, `http.rs:1382`,
  `publishing.rs:53`, `onboard.rs:101`, `memories.rs:564`). Roughly the same split as Personas'
  42-of-428.
- **`ascent` has the compliant form exactly once** —
  `src/lib/db/scans-recommendations.ts:169-172`,
  `orderBy: [{ createdAt: "desc" }, { id: "desc" }]` — against **~30** Prisma `orderBy` clauses
  on a time column with no second key (`members.ts:257,274`, `invites.ts:65`, `credits.ts:408`,
  `org-insights.ts` ×7, `org-rollup.ts` ×5, `org-signals.ts` ×4, …). And the awareness lives in
  **test** code: `src/lib/db/retention.test.ts:281` sorts
  `(a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)`. **The tiebreaker is a thing
  that repo knows about when it is asserting, and forgets when it is querying** — which is the
  same asymmetry `promotions_pg.rs` shows in `brainiac`, reached independently.
- **`personas-web` — no SQL at all** and its only multi-source merge
  (`useTriageQueue.ts:112-118`) ranks `b.weight - a.weight || (b.startedAt ?? "").localeCompare(a.startedAt ?? "")`
  — a tiebreaker *before* the timestamp and nothing after it, over a mix of static fixtures and
  live rows. Same shape, one layer over.

**Net:** four independent codebases, four independent instances of the condition, **two written
records of a cost paid for it**, and no repo that applies the compliant form consistently.
`personas-web`'s `reviewStore.ts:324,383` also mint `new Date().toISOString()` for
`resolvedAt`/`escalatedAt` — the §9 rule's condition, present in a sibling, on adjacent fields.

Independently of the cohort, this repo contains its **own** controlled comparison, and it is
better evidence than any sibling could be: `useLensFeed.ts:67` and `mergedFeed.tsx:42` consume
the same items from the same store in the same directory, one with the tiebreaker and one
without. That is a within-repo A/B with authorship, data and date held constant — the confound
the oracle cannot escape, escaped by construction.

---

## §12 — Corrections owed

**To this document's brief.** (a) *"A feed ordered by `rowid`/insertion order is stable but lies
about time"* — **not found**; zero of 963 `.rs` files order a feed by `rowid` or insertion order
alone, and the three `rowid` uses are compliant tiebreakers. (b) The brief's sharpest lead —
non-unique pagination, *"measurable from the SQL alone"* — is measurable and was measured, and
the measurement **inverts its own emphasis**: the four `OFFSET` sites sit on keys that tie at
0.0–0.1% in the operator's real data, while the key that ties at **45%** is manufactured by a
read-time `strftime` that no SQL-shaped search would flag as a pagination problem at all.
(c) The brief said "there is more than one feed"; there are at least seventeen, and they
disagree on the comparator's *type*, not only on its tiebreaker.

**To [`audit-trail-view.md`](./audit-trail-view.md)** — an extension to the central claim of the
`clock-ordered-history-read-without-tiebreak` rule description, which currently reads:

> *"The tables written with chrono `to_rfc3339()` (nanosecond) tie at ~0.1%, which is exactly why
> this cannot be decided from the statement: the same clause is safe over one table and
> unordered over another, and **the discriminator is in the writer, not at the read**."*

The first half reproduces exactly here (0.0–0.1% on every nanosecond-written table, confirmed by
two implementations over the same backup). **The bolded half is incomplete, and the counterexample
is a read.** `persona_events.created_at` ties at **0.0%** raw and at **72.1%** once
`team_channel.rs:230` applies `strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at))`;
`team_memories` goes 0.0% → 44.1% the same way. So a *read* can destroy resolution the writer
provided, and it can do so for a good reason — cross-source comparability. The corrected form:
**the discriminator is whichever layer last touched the key's resolution**, which is usually the
writer and is sometimes the read. Two consequences for that rule: its precondition sentence
should say so, and its 141-match population contains at least four lines
(`team_channel.rs:177,245,302,364`) that are **compliant** — they carry `, e.id DESC` — so its
own hand-verified 138/141 production precision is measured against a slightly different question
than "does this read tie".

**To the doctrine, offered upward** — *a normalization is a resolution decision, and resolution
decisions are invisible in both directions.* The doctrine records that a `<child>_count` column
is not necessarily a count of `<child>`, and that a `GROUP BY` omitting the code's scope key
produces a false positive hand-verification cannot find. This is the third member of that
family: **a derived column named for what it means (`at`) tells you nothing about the precision
it kept.** Measuring tie rates on the stored column and reporting them as the feed's tie rates
is wrong by 72 percentage points here, and *the wrong answer is the reassuring one*. When a
query computes its own sort key, measure ties on the computed expression, not on the column.
