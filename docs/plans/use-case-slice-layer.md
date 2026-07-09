# Use-Case Slice Layer — the behavioral unit between contexts and KPIs

> Direction 1 of [`docs/features/plugins/dev tools/context-design.md`](../features/plugins/dev%20tools/context-design.md) §9.
> Status: building. P1 schema/primitive → P2 KPI scope → P3 scan → P4 UI → P5 telemetry + docs.

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

1. **Backfill** (deterministic, no LLM) — distinct `dev_contexts.business_feature`
   values promote to use cases, linked to every context carrying that value;
   primary = the context with the most files. Gives the layer data on day one.
2. **Scan** (`dev_tools_scan_use_cases`) — a headless Claude pass over the
   context map proposing key, *measurable* use cases with their context sets.
   Lands `status='proposed'` into the same accept/reject discipline as KPI
   proposals.
3. **User** — created by hand from the Context Map surface.

## Phases

| P | Scope |
| --- | --- |
| P1 | Schema (2 tables + `dev_kpis.use_case_id`), models, repo CRUD, snapshot/reconcile, backfill, commands, bindings, `context-map.json` export |
| P2 | KPI scope end-to-end: create/update, proposal-scan prompt + resolution, derivation candidate filter, Factory placement |
| P3 | `dev_tools_scan_use_cases` — LLM proposal scan + review queue |
| P4 | UI: use-case rail on the Context Map, KPI scope picker, i18n |
| P5 | Telemetry join (LLM Overview rollup per use case), scoped codebase measurement, docs |
