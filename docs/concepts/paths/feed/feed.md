---
layer: golden-path
subject: feed
status: forged
techniques:
  - reverse-chronology-semantics
  - live-prepend
  - event-clustering
  - read-position-and-unseen
  - feed-retention
  - pagination@table
evidence:
  - src/api/pipeline/teamChannel.ts                                        # ChannelCursor {at,id}: composite exclusive keyset cursor + per-kind LIMIT pushdown so one chatty source cannot starve a page
  - src-tauri/src/commands/teams/team_channel.rs                           # the server fan-out: four sources, per-source limits, namespaced-id tiebreakers, mirrored re-rank
  - src/features/fleet/monitor/channels/useLensFeed.ts                     # client comparator copied from the server rank (documented why) + mergeHorizon so an under-paged source cannot hole the timeline
  - src/features/fleet/monitor/channels/conversationModel.ts               # consecutive-run clustering by causal parent; cluster keyed by oldest member, anchored at newest; the flat Stream deliberately unclustered beside it
  - src/features/overview/sub_activity/components/GlobalExecutionList.tsx  # the loading-v2 reference feed: ghost-under-chrome, id-guarded row reveal (polling never replays), per-context scroll restore
  - src/features/overview/sub_events/components/EventLogList.tsx           # detached end-reached load-older trigger + the honest "N+" total when the server has more
  - src/stores/slices/pipeline/channelSlice.ts                             # per-team last-seen watermark persisted; countUnread DERIVED by comparison (predicate excludes the reader's own posts); mergeHorizon; id-dedupe at both merge doors
  - src/features/home/sub_welcome/lib/sinceLeftBriefing.ts                 # last-seen anchor persisted and frozen at entry; the since-you-left delta derived by comparison, never a maintained counter
  - src-tauri/src/engine/background/                                     # the named reaper: settings-driven retention_days + min-keep-per-entity floor, terminal rows only
counter_evidence:
  - src/features/fleet/monitor/channels/mergedFeed.tsx  # same items, same directory as useLensFeed — tiebreaker dropped; on a 45%-tied key the window cut falls to team iteration order
deviations:
  - w12-feed   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w7-chat-transcript   # jump-to-latest pill carries no unseen count; no per-thread reading-position restoration — the registered form of this subject's read-position gap
---

# Feed

A feed is **time's surface**. The user's job is not comparison — it is
*catching up*: "what happened since I last looked". Many occurrences, ordered
by when they happened, newest first, consumed top-down until the reader hits
territory they have already seen. Every structural decision in this subject
falls out of that job: the ordering is fixed, the unit is the occurrence, the
window is anchored to rows rather than positions, and the surface must know —
better than the reader does — where "already seen" begins.

That framing separates a feed from its neighbors, and the boundaries matter
because feeds are the surface most often built as something else wearing the
wrong contract:

- **A [table](../table/table.md)** when the job is comparison across uniform
  attributes and ordering is a *choice* the user makes (sort by size, by
  owner, by status). A feed's order is not a choice — reverse chronology is
  the semantics, not a default sort. Table's own boundary prose says it from
  the other side: a one-column table is a list wearing borrowed chrome, and a
  ranking, a feed, a queue should drop the chrome. If your "feed" grows sort
  headers, it was a table all along; if your "table" is only ever sorted by
  time descending and read for novelty, it is a feed and should shed the
  machinery.
- **A triage queue** ([triage-queues](../triage-queues/triage-queues.md))
  when each item demands a disposition — approve, dismiss, assign, resolve.
  Feed items are *read*; queue items are *worked*. The tell is completion
  semantics: a queue drains toward empty and empty is success; a feed never
  drains, and empty means nothing happened.
- **A transcript** ([chat-transcript](../chat-transcript/chat-transcript.md))
  when the stream is a conversation — alternating authorship, turns with
  lifecycles, growth at the *bottom* because the newest turn continues a
  reading flow rather than interrupting one. The two surfaces are geometric
  mirrors of each other and share a scroll ethic (below), but a transcript
  is a document being written; a feed is a ledger being observed.
- **An audit record** ([audit-logging](../audit-logging/audit-logging.md))
  when the reader is an investigator who needs completeness, filters, and
  provenance more than recency. A feed may be *fed by* the audit stream, but
  it is a readable digest of it, not the record itself — which is exactly why
  a feed may cluster, elide, and expire while the record beneath it may not.

## The occurrence is the unit

A feed row represents **something that happened** — an event, at a moment,
involving an actor and usually an object. Three properties follow, and each
carries structural weight:

- **Occurrences are immutable.** What happened, happened. Feed rows are
  appended, never edited in place to say something different; a correction is
  a *new* occurrence. (Presentation may evolve — clustering, read state — but
  the underlying fact does not.) This is what makes a feed cacheable,
  resumable, and honest.
- **Identity is minted at creation.** Every occurrence carries a stable
  unique id from the system of record. Feeds subject their rows to the full
  gauntlet of reuse — prepend, merge-on-reconnect, cluster membership,
  read-position anchoring — and every one of those operations corrupts under
  positional or timestamp-only identity. Two occurrences in the same
  millisecond are routine, not edge-case.
- **The occurrence carries two times, and the feed must know which it
  orders by.** *Event time* (when it happened) and *arrival time* (when this
  store learned of it) diverge under retries, batching, offline producers,
  and cross-machine clocks. The
  [reverse-chronology-semantics](techniques/reverse-chronology-semantics.md)
  technique owns this decision and its consequences for late arrivals.

## Order is fixed — and total

Reverse chronology is the feed's contract with the reader: scrolling down is
travelling back in time, monotonically. The surface offers no sort controls,
and it does not reorder rows the reader has already seen — a row observed at
one position stays at that position relative to its neighbors. To keep that
promise the order must be *total and deterministic*: timestamp descending,
tied broken by identity, so that two renders, two pages, or two machines
produce the same sequence. An ambiguous order shows up as rows that swap
places across a refresh — motion with no meaning, in the one surface whose
entire semantics is order.

## The window is anchored to rows, not positions

A feed is unbounded at both ends while the reader holds a small window onto
it. **Offset pagination is structurally wrong here** — not slow, wrong: a
feed's defining behavior is insertion at the top while the reader browses,
and every insertion shifts every offset, so "next page" under offset repeats
or skips rows at exactly the rate the feed is alive. The window must be
anchored by **keyset cursor** — the composite (timestamp, identity) tuple of
the last delivered row — so that arrivals above the window cannot move it.
The full cursor discipline (tuple comparison, opacity, seeding a new consumer
at head vs origin) is owned by the shared
[pagination](../table/techniques/pagination.md) technique under Table; the
feed inherits it wholesale and adds one demand of its own: the *same* cursor
mechanics run in both directions — older-than for history at the bottom,
newer-than for catch-up at the top — and the newer-than direction is the one
offset can never fake.

## A feed is usually a union — and the union has its own rules

Real feeds rarely have one producer. An activity stream merges runs, events,
messages, and system occurrences from separate stores into one chronology,
and the merge is where feeds quietly break. Four rules, each one earned by a
measured failure:

- **The ordering key is a contract stated at both ends.** The server ranks
  the union by (timestamp, identity); every client that re-sorts — and
  merging pages from several sources forces the client to re-sort — must
  use the *identical* comparator, ideally with a comment saying it is a
  copy. The two ends do not disagree loudly; they disagree only at ties and
  only at page boundaries, the least observable failure a surface can have.
- **Identity must be comparable across sources.** Rows from different
  stores can collide on raw ids; namespace them (a per-source prefix) so
  the union's tiebreaker lives in one key space.
- **Per-source window budgets.** A union paged with one shared limit lets
  its chattiest source starve every other out of the page — the quiet
  source's rows are not late, they are *never fetched*. Each source gets
  its own window; the merge re-ranks the combined result.
- **A merge horizon.** When sources page at different depths, rows below
  the shallowest source's page end must not render — a gap in the *middle*
  of the timeline (source A's page ends at noon, source B's rows from the
  morning show anyway) reads as "nothing happened at noon", which is false.
  Clamp the visible union at the least-loaded source's horizon; a shorter
  honest feed beats a longer holed one.

## Live arrivals respect the reader

A live feed grows at the top — the exact place the reader starts. That
geometry creates the subject's signature tension: the newest content and the
reading position compete for the same pixels.

The resolution is a contract, the mirror image of the transcript's
pin-to-tail ethic
([transcript-scroll](../chat-transcript/techniques/transcript-scroll.md)):

- **At the top, follow.** A reader parked at the head is asking for live;
  new occurrences appear in place.
- **Scrolled away, never yank.** The moment the reader scrolls down they
  have declared "I am reading"; arrivals accumulate *out of view* and are
  announced by an affordance — "N new", jump-to-latest — that the reader
  invokes on their own schedule. Seizing the viewport, or inserting content
  that pushes the text under their eyes, breaks the surface's core promise.
- **Arrivals are batched, not streamed row-by-row into layout.** Bursty
  producers are the norm; the render cadence is throttled and coalesced so
  the feed breathes rather than vibrates — machinery this subject inherits
  from streaming-output's
  [render-throttling](../streaming-output/techniques/render-throttling.md)
  rather than re-deriving.

The [live-prepend](techniques/live-prepend.md) technique owns the scroll
anchoring, the held-arrivals buffer, and reconnect deduplication.

## Clustering is a design duty

Real event streams are bursty and repetitive: one deploy emits forty
status-change events; one sync touches three hundred records. Rendered
one-per-row, the burst buries everything else that happened — the feed
becomes a denial-of-service on the reader's attention by its most verbose
producer. A principal-quality feed therefore **collapses consecutive related
occurrences into one cluster row** ("47 records synced", "build progressed
through 5 stages") with the uncollapsed run reachable by expansion.

The invariant that keeps this honest: **the cluster is a view, never the
storage.** Occurrences are stored atomically; clustering is a derivation
applied at read time, recomputable and revisable, and the count on a cluster
row states what it counted. The
[event-clustering](techniques/event-clustering.md) technique owns the
grouping predicate, cluster identity under live growth, and expansion.

## Read position is durable

"What happened since I last looked" requires the surface to know when the
reader last looked — durably, across sessions and restarts. The standard is
an **anchor, not a counter**: the feed persists the (timestamp, identity)
tuple of the newest occurrence the reader had seen, and *derives* unseen-ness
by comparison — any occurrence newer than the anchor is unseen, and the badge
count is a query, not a maintained number. Maintained counters drift the
first time an increment races a reset; an anchor cannot drift, only lag, and
lag is self-correcting on the next look. What "seen" means — surface opened,
row scrolled into view, explicitly acknowledged — is a per-feed decision that
must be made once and stated, because the reader will calibrate their trust
in the badge against it. The
[read-position-and-unseen](techniques/read-position-and-unseen.md) technique
owns the anchor lifecycle, the derivation, and badge honesty.

## Retention is declared

A feed that never forgets is an archive with a scroll bar — its storage grows
without bound, its history pages slow without bound, and nobody decided
either. Every feed declares its retention at creation: an age bound, a count
bound, or an explicit "this feed is a window; the durable record lives
elsewhere" pointing at the archive that backs it. Retention interacts with
everything above — cursors that point past the horizon, anchors older than
the oldest retained row, clusters truncated mid-run — and each interaction
has a correct answer spelled out in
[feed-retention](techniques/feed-retention.md). The one-sentence version:
truncation is stated, never silently rendered as "nothing happened".

## Loading posture

A feed inherits the universal surface discipline: permanent chrome (title,
filter chips, the unseen affordance) renders unconditionally; the row region
carries the state model — a calm geometry-matched placeholder on first load,
existing rows held on refresh (a fetch never hides rendered occurrences),
empty asserted only after settling, and error distinct from empty. Empty has
a feed-specific meaning worth designing for: "nothing has happened" is
reassurance, not absence — say it that way.

## Accessibility posture

- The feed is a **log**: new arrivals are announced politely and coarsely
  ("3 new events"), never row-by-row — a busy feed at full announcement
  volume is unusable with assistive technology.
- The unseen affordance is a real, focusable control, and invoking it moves
  focus with the viewport so keyboard readers land where they jumped.
- Relative timestamps ("4m ago") carry the absolute time as their accessible
  and hover recourse; a screen-reader user gets the same temporal precision
  a sighted user can hover for.
- Cluster expansion is disclosure semantics: the collapsed row states what
  it holds, the expanded run is reachable in document order.

## The techniques

- [reverse-chronology-semantics](techniques/reverse-chronology-semantics.md)
  — event time vs arrival time, the total order, late arrivals, timestamp
  display honesty.
- [live-prepend](techniques/live-prepend.md) — top-growth geometry, scroll
  anchoring, the held-arrivals buffer, reconnect dedupe.
- [event-clustering](techniques/event-clustering.md) — the grouping
  predicate, cluster identity under growth, view-not-storage, expansion.
- [read-position-and-unseen](techniques/read-position-and-unseen.md) — the
  durable anchor, derived unseen counts, what "seen" means, badge honesty.
- [feed-retention](techniques/feed-retention.md) — declared bounds, the
  reaper, cursors and anchors at the horizon, truncation spelled as
  truncation.
- [pagination](../table/techniques/pagination.md) *(shared, owned by Table)*
  — keyset cursor mechanics; the feed consumes it in both temporal
  directions.
