---
layer: application
subject: feed
technique: reverse-chronology-semantics
stack: rust
---

# Reverse-chronology semantics — the team channel union (Rust + SQLite)

The technique's four decisions, as they land in
`src-tauri/src/commands/teams/team_channel.rs` (`read_channel`, `:144-410`), the
server half of the Fleet Stream / Conversation feed, and in the client that
consumes it.

## Decision 1 — which time: event time, normalized for comparability

Four tables with four timestamp conventions feed one ranking. `read_channel`
projects each to a common second-resolution key:

```sql
strftime('%Y-%m-%dT%H:%M:%SZ', datetime(e.created_at)) AS at   -- :164, :230, :295, :356
```

The `TeamChannelItem.at` doc comment (`:40-41`) states the contract: *"Normalized
RFC3339 UTC (second resolution) — sortable everywhere."* This is the technique's
"whoever normalizes owes the tiebreaker" corollary in its measured form: replayed
against the 2026-08-17 purge backup, `persona_events.created_at` ties at **0.0%
raw** and **72.1%** after this projection; `team_memories` goes 0.0% → 44.1%
(`docs/concepts/golden-paths/chronological-feed.md` §0). The projection is
correct and necessary; it also manufactures the ties the rest of this file
exists to handle.

## Decision 2 — the total order: (at, id) with namespaced ids

Every source query orders on the composite and pages on it:

```sql
AND (strftime(…) < ?2
     OR (strftime(…) = ?2 AND ('tae-' || e.id) < ?4))       -- :174-176
ORDER BY at DESC, e.id DESC LIMIT ?3                         -- :177
```

The `'tae-'` / `'pe-'` prefixes (`:176`, `:244`) put four tables' ids into one
comparable key space so the union's tiebreaker is total. The in-process merge
then re-ranks with the identical comparator and says why:

```rust
// Must mirror the per-query ORDER BY exactly — the composite cursor above
// pages on (at, id), so the merge has to rank on (at, id) too.
items.sort_by(|a, b| b.at.cmp(&a.at).then(b.id.cmp(&a.id)));   // :405-407
```

The header comment at `:115-120` records the defect this replaced — rows
*"dropped (or duplicated) by the old timestamp-only `at < ?` cursor"* — and the
test `omitting_before_id_keeps_legacy_strict_at_paging` (`:721`) pins the
backward-compatible fallback.

**Per-source window budgets** live in the same function: each of the four
queries takes its own `LIMIT ?3` and the union is truncated *after* the re-rank
(`:408`). The test `kind_filter_is_pushed_down_so_a_lens_cannot_be_starved`
(`:738`) guards the starvation case the Golden Path names — previously all four
ran with `LIMIT n` and a chatty `step` layer crowded every `memory` out of the
page.

## The client copies the comparator — and one client does not

`src/features/fleet/monitor/channels/useLensFeed.ts:65-67`:

```ts
// Same comparator the server ranks by — (at, id) desc. The merge must sort
// identically or paging would interleave wrongly.
flat.sort((a, b) => b.item.at.localeCompare(a.item.at) || b.item.id.localeCompare(a.item.id));
```

`mergedFeed.tsx:42`, same directory, same `TaggedItem[]`, same 45%-tied key:

```ts
flat.sort((a, b) => b.item.at.localeCompare(a.item.at));
```

Stable sort resolves the tied second to *input iteration order* — the order the
user's teams happen to be listed in — and `LIVE_FEED_WINDOW = 600` (`:46`) cuts
there. Registered at `golden-path-deferred-fixes.md` §88; the one-line fix is
deferred because it changes what a live overlay shows.

## Merge horizon

`src/stores/slices/pipeline/channelSlice.ts:122-131` (`mergeHorizon`): the
newest of the per-team oldest rows across teams that still have history; rows
below it are held back so a shallowly-paged team cannot surface rows *above* the
reader's position on its next page. `refreshChannel` (`:212-217`) marks a short
first page `exhausted` so a three-row team does not pin the horizon forever.

## Bucketing — where the group key diverges from the sort key

Two live divergences from the technique's bucketing rules, both registered at
deferred-fixes §88:

- `conversationModel.ts:39-41` — `dayKeyOf = at.slice(0, 10)` is the **UTC**
  calendar day; `dayLabel` (`:45-53`) computes **local** midnight. At UTC+2 the
  divider lands at 02:00 local. The repo's own `timeGroupKey`
  (`src/features/shared/components/display/grouping.ts:34-39`) computes local
  boundaries and is used by three other feeds.
- `GlobalExecutionList.tsx:161` returns unsorted by default (deferring to the
  SQL `ORDER BY e.created_at DESC`) while `groupOf` (`:264`) buckets on
  `started_at || created_at`. Rows whose two timestamps straddle a day boundary
  land under the wrong sticky header.

## Renderer-minted keys

The census rule `feed-item-ordered-by-the-renderers-clock`
(`chronological-feed.md` §9; 12 matches / 10 files, hand-verified 9/12) is this
technique's "minted by the authority" section as a gate. Its two most
consequential hits: `hooks/realtime/useRealtimeEvents.ts:244-245` and
`emitDeploymentEvent.ts:52-53` synthesize a full `PersonaEvent` with
`created_at` from `new Date()` and push it into the store the Event Log ranks on
`created_at`, beside rows whose key came from SQLite.

## Where the technique lands in the store, one line each

| Technique clause | Site |
|---|---|
| Event time as the ordering key | `team_channel.rs:164` (`created_at` projected, not an ingestion time) |
| Composite total order | `team_channel.rs:177,245,302,364`; `:407` |
| Namespaced tiebreaker across sources | `team_channel.rs:176,244` |
| Per-source window budget | `team_channel.rs` four independent `LIMIT ?3`; test `:738` |
| Comparator copied to the client | `useLensFeed.ts:67` (compliant) · `mergedFeed.tsx:42` (drops it) |
| Merge horizon | `channelSlice.ts:122-131` |
| Group key = sort key | violated at `GlobalExecutionList.tsx:161/264` |
| Boundary and label in one zone | violated at `conversationModel.ts:39-53`; correct helper at `grouping.ts:34-39` |
| Authority mints the key | census rule `feed-item-ordered-by-the-renderers-clock` |
