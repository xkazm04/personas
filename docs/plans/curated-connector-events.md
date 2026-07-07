# Curated Connector-API-Change Events

**Status:** implementing (2026-07-07) · session opus-4-8[1m] · branch `worktree-curated-connector-events`

A monthly, dev-side pipeline that watches the **public API docs** of every
Personas connector, detects when a doc changes, and ships those changes to users
as **curated global events** they can subscribe to in the Events → Marketplace
tab (e.g. *"ElevenLabs API updates"*). The whole path is **local-first**: detected
changes are code-generated into the release binary and delivered to subscribers
with no cloud dependency.

## Two repos, three stages

```
 ┌───────────────────────── DETECTION (dev machine) ──────────────────────────┐
 │  pumper repo  ·  crates/apps/connector-api-watch                            │
 │  monthly cron → for each connector with a public docs_url:                 │
 │    tiered fetch (http→browser) → HTML→Markdown → hash                       │
 │    Datasets change-detection (ChangeKind::Changed) → real change            │
 │    Claude engine diffs old vs new docs → { summary, tags[] }                │
 │  emits data/artifacts/connector-api-watch/<job>/changes.json                │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                       │  (dev copies changes.json into personas)
 ┌────────────────────────── DISTRIBUTION (dev, personas repo) ───────────────┐
 │  scripts/events/generate-connector-events.mjs                              │
 │   1. emits scripts/events/connector-docs.manifest.json  (the watch list —  │
 │      copied into pumper/catalog/connector-docs.json)                        │
 │   2. merges pumper changes.json into the durable ledger                     │
 │      scripts/events/connector-events.ledger.json  (catalog + firings)       │
 │   3. code-generates src-tauri/src/db/builtin_shared_events.rs               │
 │  dev reviews the ledger + .rs diff, commits → ships in the next release     │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                       │  (app upgrade seeds the baked data)
 ┌────────────────────────── CONSUMPTION (shipped app) ───────────────────────┐
 │  startup: seed shared_event_catalog (one feed/connector) + shared_event_    │
 │           firings (the detected changes) from builtin_shared_events.rs      │
 │  Marketplace: user subscribes to "ElevenLabs API updates"                   │
 │  shared_event_local_relay_tick: for each enabled sub, deliver baked firings │
 │           with seq > last_cursor onto the bus as `shared:<slug>` (offline)  │
 │  → routes into the user's triggers/chains exactly like any other event      │
 └─────────────────────────────────────────────────────────────────────────────┘
```

## Design decisions (confirmed with user 2026-07-07)

1. **Claude-summarized diffs** — each change carries a human-readable "what
   changed" summary + structured tags (`new_endpoint`, `deprecation`,
   `auth_change`, `param_change`, `breaking`, …), not just a hash flip.
2. **One feed per connector** — each public-docs connector is its own
   subscribable catalog entry (`connector.<name>.api`), matching the
   "subscribe to ElevenLabs API updated" example.
3. **Fully-local baked firings** — no cloud. Detected changes are generated into
   `builtin_shared_events.rs` and shipped in the release. The existing cloud
   relay (`shared_event_relay.rs`) is left untouched as a secondary path.

## Reused vs new

Reuses the existing marketplace substrate: `shared_event_catalog` /
`shared_event_subscriptions` tables, the `SharedEventCatalogEntry` /
`SharedEventSubscription` models + bindings, `SharedEventsTab` / `CatalogCard` /
`SubscriptionList` UI, the `shared:<slug>` bus event type, and the dedup-by-
`source_id` guarantee in `events::exists_by_source_id`.

New:
- **pumper**: `crates/apps/connector-api-watch` + catalog wiring.
- **personas seed**: `shared_event_firings` table; generated
  `db/builtin_shared_events.rs`; startup seed in `db/mod.rs`.
- **personas relay**: `engine/shared_event_local_relay.rs` — delivers baked
  firings to subscribers, cursor = monotonic firing `seq` (so historical
  firings never backfill-flood a new subscriber; only future-release firings
  fire).
- **personas bridge**: `scripts/events/generate-connector-events.mjs` +
  `connector-events.ledger.json` (durable source of truth) +
  `connector-docs.manifest.json` (the watch list).

## Cursor semantics (why `seq`, not timestamp)

A firing's detection time is *before* the release that ships it, so a timestamp
cursor set at subscribe-time is ambiguous. Instead each firing has a monotonic
integer `seq` (ledger order). On subscribe, `last_cursor` is set to the current
MAX(seq) for that slug → the subscriber gets only firings added in **future**
releases, delivered exactly once (seq strictly greater than cursor; dedup by
`source_id` is the backstop). No historical flood, no missed future change.

## Files

See the active-runs ledger entry `curated-connector-events` for the full path
list across both repos.
