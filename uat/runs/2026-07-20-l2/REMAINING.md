# Remaining batch items — assessed, deferred with recommendations (2026-07-22)

The approved fix batch had ~12 items. This session landed 9 (see the run's fix
commits); the four below were each assessed per-surface and deferred because none
is a clean mechanical mount — each is either a **feature arc** or a **product-IA
decision** that warrants explicit direction rather than a low-confidence change
shipped deep in a long session.

## 1. `UseCaseExecutionPanel` — port, don't mount (blocker CM-AT-02)
- **State:** the orphaned `sub_lab/use-cases/` cluster is functionally complete —
  `useUseCaseExecution` reads `input_schema`, builds a field form, and calls the
  real `executePersona`. The **live** surface (`sub_use_cases/`) only runs from
  `sample_input` or a saved fixture; there is genuinely no field-level input form,
  confirming the gap (a user cannot type ad-hoc input matching a use case's
  declared schema).
- **Why deferred:** mounting the whole parallel panel into the mature live surface
  would create two run surfaces — the exact UI drift `CLAUDE.md` warns is the #1
  drift source.
- **Recommendation:** port `StructuredField`-per-`input_schema` input entry into the
  live `sub_use_cases` fixture editor (which already has create/update-fixture
  plumbing), then retire the orphaned cluster. ~1 focused change to one surface.

## 2. `TriggerConfig` mount — complete code, needs a placement decision (blocker CM-STA-02)
- **State:** `TriggerConfig` (+`TriggerAddForm`) is a complete, fully-wired
  per-persona trigger manager — real CRUD via `useTriggerOperations`, the full
  create form (NL parser, type pickers, schedule config), list with toggle/delete,
  errors, empty state, i18n. It has **zero importers**; the only live create path
  is `StudioTriggerCommitModal`, which locks the trigger type.
- **Why deferred:** it's ready to mount, but *where* is a product-IA decision with
  doc-sync impact — a new editor tab, a section in the (ungated) Settings tab, or a
  "manage triggers" tab in the Events page. Mounting in an **ungated** editor
  location would also close the Starter blocker (Events is TEAM-gated, so Dani/most
  first-timers can't reach any trigger UI today).
- **Recommendation:** mount in the persona editor's Settings tab (ungated, per-
  persona, closes the Starter blocker). One-line render + a docs-sync pass. Ready
  to execute on a placement decision.

## 3. Version-comparison report — feature arc (FA-AGY-LAB-03)
- **State:** `ExportReportButton` is already mode-parameterized; `abHtmlReport` /
  `evalHtmlReport` generate real "Version Comparison" artifacts (winner badges,
  per-scenario matrix). The blocker is upstream: the **A/B comparison flow itself
  has no UI** (`startAb` has zero callers), so there's no ab-run to export.
- **Why deferred:** producing Lena's billable "v3→v4 improved X by Y" report
  requires first surfacing the whole A/B comparison path (select two versions → run
  against one scenario set → export). That's a feature, not a mount. NOTE: the Δ
  soundness fix already shipped this session makes the *versions-table* comparison
  valid, which partially covers the need.
- **Recommendation:** mount an A/B "Compare versions" action on the versions table
  (`startAb` engine + report generator both already correct), then the export is a
  mode flip.

## 4. `outputAssertions` consumer — feature arc (FA-RRE-03)
- **State:** backend commands + typed API (`outputAssertions.ts`) exist with
  `on_failure: review | heal`. **No UI exists at all** (grep is empty).
- **Why deferred:** this needs a config surface built from scratch (define an
  assertion on a persona/use-case, choose on-failure behaviour) — a feature arc,
  not a wire-up of dormant UI.
- **Recommendation:** a small assertions section in the use-case/capability editor;
  scope it as a standalone feature.

---

**Shipped + verified this session:** Lab ratings/economics (live), Lab Δ soundness
(live 0/4→5/5), Improve real engine (live, grounded v3), review-policy inversion
(unit-tested), long_text renderer, rating-channel wiring, promote-honesty
notification, built-in tool-test honest labeling.
