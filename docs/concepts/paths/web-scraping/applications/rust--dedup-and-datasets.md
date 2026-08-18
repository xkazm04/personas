---
layer: application
subject: web-scraping
technique: dedup-and-datasets
stack: rust
---

# Rust application: change-detected upsert into scraper datasets

**Where:** `src-tauri/engine/src/scraper.rs` — `upsert_record` (`:195-241`),
`run_extract` (`:245-290`), `ChangeKind` (`:146-160`), `query_dataset`
(`:338+`), dataset rollups via `dataset_summaries`; key selection in the
editor at `EditorSteps.tsx:171-178` ("Key field — dedupe records by this field
instead of the URL"). Storage is the `scraper_records` table keyed
`(dataset, key)`.

## The technique, realized

- **Identity before append.** Every record lands through one door,
  `upsert_record(pool, dataset, key, data)`, keyed by a declared `key_field`
  extracted from the record, falling back to the source URL
  (`run_extract`, `:267-271`). The URL fallback is the technique's
  "canonicalized item address" tier: correct for one-entity-per-page
  configs, which is this scraper's primary shape.
- **The reconciliation vocabulary is explicit.** `ChangeKind::New / Changed /
  Unchanged` — compared by a content hash (`content_hash`, SHA-256 over the
  serialized record) against the stored `content_hash`.
- **"Still there" is information.** The `Unchanged` arm is not a no-op: it
  updates `last_seen` (`:213-219`), so every record carries
  `first_seen / last_seen / updated_at` and staleness is queryable even
  though nothing consumes it yet.
- **Counts carry their predicate.** `ExtractSummary` reports
  `scanned / new / changed / unchanged / errors` per run (`:174-185`), and
  `config_run` stamps that same predicate-carrying breakdown into
  `last_status` ("ok — 3 new, 1 changed, 40 unchanged, 0 error(s)",
  `:578-587`). Records returned to the UI are annotated `_key` + `_change`.

## Where the application falls short of the technique (deviations)

- **No absence processing at all.** The four-outcome table stops at three:
  a key present in the dataset but missing from the harvest is simply not
  visited. No stale marking, no tombstone, no "newly absent" count — the
  dataset never learns an entity left the source. The mitigating grace:
  because absence is never processed, a collapsed harvest also cannot
  mass-tombstone the dataset; the technique's quarantine rule is satisfied
  vacuously. Adding absence handling *without first adding harvest-health
  gating* (shape-change detection) would invert that safety — the ordering
  constraint the technique states explicitly.
- **Silent per-record key fallback.** If `key_field` is declared but the
  field misses on one record, `.and_then(...).unwrap_or_else(|| url.clone())`
  silently re-keys that record to the URL (`:267-271`) — one entity can
  exist under two identities after a partial extraction, with no warning
  emitted. The technique wants key-member fields to be required rules, or at
  minimum a loud fallback.
- **Whole-record hash as the change predicate.** `content_hash` covers every
  extracted field, so any volatile field (a view counter, a relative
  timestamp) marks the record `Changed` on every run; there is no declared
  compared-fields subset. With `all: true` css rules, array ordering also
  feeds the hash.
- **Intra-harvest duplicates are order-dependent.** Two URLs yielding the
  same key upsert sequentially — first becomes `New`, second `Changed` —
  with no declared first-wins/last-wins/conflict policy.
- **No history.** `Changed` overwrites `data` in place; `query_dataset`'s
  `changed_only` filter (updated_at > first_seen) is the only trace that a
  change ever happened. Fine for the "act on diffs" use case (the run
  signal on the persona event bus, `:608+`), thin for audit.

## Transplant note

The one-door upsert with a three-valued (ideally four-valued) `ChangeKind`
return is the transplantable core — it makes "act only on diffs" a caller-side
`match` instead of a diffing layer. Carry the deviations list as the checklist
of what to add before trusting the dataset as a source of truth rather than a
change feed.
