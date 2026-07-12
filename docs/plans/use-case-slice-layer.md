# Use-Case Slice Layer — the behavioral unit between contexts and KPIs

> Direction 1 of [`docs/features/plugins/dev tools/context-design.md`](../features/plugins/dev%20tools/context-design.md) §9.
> Status: **P1–P5 shipped** (877e3d35d schema + KPI scope; 18eca5671 scan + UI +
> telemetry join; 23e703038 backfill correctness). Backend live-verified against
> the running app; the UI surface and the LLM scan are not (see "Open").

## Problem

A **context** is a code-ownership partition (5–15 files, each file in exactly one
context). A **KPI** is an outcome. Outcomes rarely respect that partition —
"checkout conversion" spans a UI context, an API context and a data context.
Forcing a KPI onto one context yields either an arbitrary anchor or a retreat to
group/project scope, which blunts goal-derivation targeting. Meanwhile the KPI
plan's original worry stands: finer scope multiplies proposals and matrix rows.

## Shape

A **use case** is a *slice through* contexts, not a subdivision of one.

```
dev_projects
 └── dev_context_groups
     └── dev_contexts ──────┐   (code-ownership partition; scan-owned)
                            │
        dev_use_case_contexts  (N:M — the slice)
                            │
 └── dev_use_cases ─────────┘   (behavioral unit; human/scan-curated)
      └── dev_kpis.use_case_id  (narrowest KPI scope)
```

- `dev_use_cases.slug` is the **telemetry join key** — it matches the use-case
  name the LLM Overview already folds pinpoints by (`foldByUseCase`), so
  observed calls/tokens/cost per use case need zero new instrumentation.
- `primary_context_id` is a render/placement convenience so the Factory matrix
  keeps its group → context row model.
- Cardinality is held by curation, not by structure: 5–15 *key* use cases per
  project, scan-proposed but triage-gated (`status='proposed'`), pinnable.

## KPI scope precedence (narrowest wins)

| Scope | Columns set | Derivation candidate contexts |
| --- | --- | --- |
| Use case | `use_case_id` | the use case's context set (junction) |
| Context | `context_id` | that one context |
| Group | `context_group_id` | the group's contexts |
| Project | none | all |

## The rescan-survival invariant (the load-bearing detail)

`clear_project_context_map` deletes unpinned contexts on a **full re-scan**, and
`PRAGMA foreign_keys = ON` is set. So any FK to `dev_contexts` is destroyed on
every full re-scan:

- a naive `dev_use_case_contexts` junction would cascade-delete every slice;
- **`dev_kpis.context_id` already silently `SET NULL`s today** — a pre-existing
  data-loss bug for context-scoped KPIs.

Fix: **snapshot before, reconcile after, keyed by context name.** Contexts are
re-emitted under stable kebab names across scans, so the name is the natural
key. `snapshot_context_links()` runs before the scan spawns; after the scan
persists and prunes, `reconcile_context_links()` re-resolves names → new ids and
restores the junction, `primary_context_id`, and `dev_kpis.context_id`. A
context that genuinely disappeared drops its link honestly and is reported.

Delta scans never delete contexts, so reconciliation is an idempotent no-op
there.

## Provenance of use cases

1. **Scan** (`dev_tools_scan_use_cases`) — a headless Claude pass over the
   context map proposing key, *measurable* use cases with their context sets.
   Lands `status='proposed'` into the same accept/reject discipline as KPI
   proposals. **The primary path**, because naming a behavior is a judgement.
2. **Backfill** (deterministic, no LLM) — promotes only `business_feature`
   labels covering **≥2 contexts**; primary = the context with the most files.
3. **User** — created by hand.

### The backfill's ≥2 rule was forced by real data

The original design assumed `business_feature` was a ready-made seed. Measured
against the live 263-context map before shipping:

| | |
|---|---|
| distinct `business_feature` labels | 184 |
| labels covering exactly **one** context | **179** |
| labels literally equal to the context's kebab name | 89 / 193 |
| labels spanning ≥2 contexts **within one project** | **0** |
| use cases an unfiltered backfill would create for `personas` | **49** |

So an unfiltered backfill mints one use case per context — the exact degenerate
model this layer exists to prevent — and floods the triage queue. The ≥2 filter
makes the primitive correct by construction: it can only ever create a true
slice, it is a harmless no-op on maps like this one, and the UI states plainly
that nothing was created and points at Scan.

## Phases

| P | Scope | Status |
| --- | --- | --- |
| P1 | Schema (2 tables + `dev_kpis.use_case_id`), models, repo CRUD, snapshot/reconcile, backfill, commands, bindings, `context-map.json` export | ✅ |
| P2 | KPI scope end-to-end: create/update, proposal-scan prompt + resolution, derivation candidate filter, Factory placement | ✅ |
| P3 | `dev_tools_scan_use_cases` — LLM proposal scan + review queue | ✅ |
| P4 | UI: use-case rail on the Context Map (slice highlight), KPI scope picker, i18n ×14 | ✅ |
| P5 | Telemetry join (LLM Overview marks call sites mapped to a declared use case) | ✅ |

## Verified

**Unit**
- `reconcile_restores_slice_and_kpi_scope_across_a_full_rescan` — simulates the
  real destruction path (`clear_project_context_map` → recreate under new ids)
  and asserts the slice, the primary anchor and `dev_kpis.context_id` all come
  back, that the vanished context's link drops exactly once, and that a second
  run is a no-op.
- `backfill_promotes_only_multi_context_features_and_is_idempotent` +
  `backfill_creates_nothing_when_every_label_names_one_context`.
- Rust `slugify_use_case` and TS `slugifyUseCase` pin the same normalization
  table in their own suites — if they drift, the telemetry join silently stops
  matching.

**Live** (running app, real 65-KPI / 263-context database)
- The migration applied cleanly on startup; `dev_use_cases`,
  `dev_use_case_contexts` and `dev_kpis.use_case_id` exist, `integrity_check` ok,
  all 65 KPIs preserved.
- Drove the real IPC path via the test-automation harness:
  `dev_tools_create_use_case` (camelCase → snake_case args, the `contextIds`
  array, slug derivation, junction write), `dev_tools_list_use_cases`,
  `dev_tools_list_use_cases_for_context` (reverse lookup), and
  `dev_tools_delete_use_case` (junction cascade). Probe row removed; both tables
  back to empty.

## Open

- **Not live-verified:** the Context Map UI surface and the LLM use-case scan —
  the running app's bundled frontend predates them and `use_case_scan.rs` landed
  after its binary was built. Needs one `tauri dev` pass.
- **Scoped codebase measurement** (a use case's context set gives a
  codebase-kind KPI a file scope instead of a whole-repo command) is designed
  but not built — the natural next slice, and what makes use-case KPIs cheaper
  to measure than project-wide ones.
- **Cost rollup per use case** on the use-case chip (the LLM Overview join
  currently proves the match; it does not yet surface tokens/$ on the Context
  Map surface).
- `propose_kpi_auto_inner` (Athena's conversational KPI path) still passes
  `use_case_id: None`; wire it when Athena learns to name a use case.
- The Factory matrix anchors a use-case KPI on its primary context row. A
  dedicated use-case row per group is the better long-term render.
