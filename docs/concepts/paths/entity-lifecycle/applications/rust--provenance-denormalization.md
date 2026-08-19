---
layer: application
subject: entity-lifecycle
technique: provenance-denormalization
stack: rust
---

# Recipe provenance stamped onto executions

The doctrine is written where it is implemented:
`src-tauri/db/src/repos/execution/executions.rs:11-31` documents
`resolve_recipe_provenance`, which resolves `(source_recipe_id,
source_recipe_version)` from the persona's use-case metadata and copies
both onto the execution row at insert time (`:578-597`). The doc
comment states the technique's two core claims verbatim:

> "Denormalizing rather than joining live is the point: detaching a
> capability deletes the use case, and a live join would then silently
> rewrite the history of every run it produced. Returns `(None, None)`
> for any run with no use case, no persona row, unparseable context, or
> a use case that was not adopted from a recipe. **NULL is the honest
> answer — never a sentinel.**"

Every clause maps onto the technique:

- **Copy at write time.** The provenance is read from the persona's
  `design_context` and stamped into the `INSERT` (`:578-597`); there is
  deliberately no later write path. Once the use case is detached or
  the persona deleted, the window is closed — which is why it is
  captured while open.
- **The honest absence.** Every unresolvable case — no use case, no
  persona row, unparseable context, not recipe-adopted — collapses to
  `(None, None)`, never to a placeholder id. Downstream, the rollup
  query honors the same contract: runs that predate stamping "have a
  NULL `source_recipe_id` and are excluded, not guessed at"
  (`:2048-2064`), and the join to live recipe definitions is a `LEFT
  JOIN` so a deleted recipe degrades the caption, not the count.
- **Best-effort by construction.** "A failure to resolve provenance
  must never fail the execution insert" (`:30-31`) — the historical
  stamp is an observer of the write, not a gate on it.
- **Provenance survives the entity's own lifecycle operations.** The
  retry path copies `source_recipe_id`/`source_recipe_version` from the
  original execution row via subselect (`:1575-1579`), so a retried run
  carries its ancestor's provenance rather than re-resolving against a
  world that may have moved. A regression test pins the stamped pair
  (`:2491-2514`).

## The same posture at the persona boundary

The persona delete relies on the mirrored discipline for events: the
drain-test contract (`src-tauri/src/commands/core/personas.rs:922-925`)
asserts cascade completeness as "memories/events gone, target events
**source-nulled**" — records aimed *at* the deleted persona survive
with the pointer honestly degraded rather than fabricated or cascaded.
And the per-field change history
(`src-tauri/core/src/models/persona_change_log.rs`) shows the sibling
trade for lifecycle records: secret-bearing fields are stored as the
sentinel-free redaction `"(changed)"` — the fact that a change happened
is preserved without retaining the value, and `None` still means "had
no value," keeping the three states distinguishable.
