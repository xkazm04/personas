# Adoption flow — gallery click → promoted persona

The end-to-end journey of turning a template into a working agent. This
is the hardest thing to reconstruct from code alone because the flow
spans five React components, three Tauri commands, one SQLite table, and
a state machine.

## The six phases

```
  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │ 0. Seeding   │ ──▶ │ 1. Gallery   │ ──▶ │ 2. Wizard    │
  │ (on mount)   │     │ click Adopt  │     │ modal opens  │
  └──────────────┘     └──────────────┘     └──────┬───────┘
                                                    │
                                                    ▼
                                            ┌──────────────┐
                                            │ 3. Question- │
                                            │    naire     │
                                            └──────┬───────┘
                                                    │ submit
                                                    ▼
                                            ┌──────────────┐
                                            │ 4. Matrix +  │
                                            │ build session│
                                            └──────┬───────┘
                                                    │
                                                    ▼
                                            ┌──────────────┐
                                            │ 5. Test →    │
                                            │ Promote      │
                                            └──────────────┘
```

## Phase 0 — Seeding

**Trigger**: `useDesignReviews` hook mounts anywhere in the app (the
Generated tab in particular).

**Path**: `src/hooks/design/template/useDesignReviews.ts` →
`seedCatalogTemplates()`

**Steps**:
1. In dev mode, call `invalidateTemplateCatalog()` to drop the Vite
   glob cache so template JSON edits flow through. (See
   [02-catalog-loading.md](02-catalog-loading.md) for why this is
   necessary.)
2. `getSeedReviews()` loads the verified catalog via
   `getTemplateCatalog()` and maps every entry through
   `templateToReviewInput`, producing a `SeedReviewInput[]` where each
   entry has `design_result = JSON.stringify(payload)`.
3. `batchImportDesignReviews(seeds)` — Tauri IPC → Rust
   `batch_create_reviews` in `src-tauri/src/db/repos/communication/reviews.rs`.
   Uses `ON CONFLICT(test_case_name, test_run_id) DO UPDATE SET
   design_result = excluded.design_result, ...` so every seed pass
   refreshes the row without losing `adoption_count` or
   `last_adopted_at`.
4. `deleteStaleSeedTemplates(SEED_RUN_ID, activeIds)` prunes rows
   whose template was renamed or deleted.
5. `invalidateSWRCache(SWR_KEY)` + refetch so the UI reflects the
   refreshed rows.

**Key constant**: `SEED_RUN_ID = 'seed-category-v1'`. All seed rows
share this `test_run_id` so the upsert conflict-key works correctly.
Never change this without writing a migration.

**Gate**: `seedDoneRef.current` ref guards against running seeding more
than once per component mount. Module-scoped so concurrent consumers
don't race.

**Module-level cache caveat**: `_cached` in `templateCatalog.ts`
survives Vite HMR when only JSON files change. In dev we invalidate it
on every seed call; in production the first-load cache semantics are
correct (bundle is immutable).

## Phase 1 — Gallery click

**Entry**: `src/features/templates/sub_generated/gallery/cards/GeneratedReviewsTab.tsx`
renders `PersonaDesignReview` rows from `useDesignReviews`. Each row is
a card; clicking **Adopt** sets a `pendingAdoption` in the store which
surfaces the `AdoptionWizardModal`.

## Phase 2 — Wizard modal

**Component**: `AdoptionWizardModal.tsx`

- Renders as a `BaseModal` with `portal={true}`,
  `maxWidthClass="max-w-[1750px]"`, `panelClassName="h-[92vh] ..."`.
  Uses `z-[10000]` by default.
- Handles the "Discard adoption progress?" confirmation on close when
  a build session is active (`buildSessionId + phase not in
  SAFE_CLOSE_PHASES`).
- Resets `buildSessionId` on open so stale build state from a previous
  adoption can't trigger the discard confirmation prematurely.
- Wraps `MatrixAdoptionView` with the review and callbacks.

## Phase 3 — Questionnaire

**Component**: `MatrixAdoptionView.tsx` — gate at line ~545:

```tsx
if (!seeded) {
  if (hasAdoptionQuestions && !questionsComplete) {
    return <QuestionnaireFormFocus {...props} />;
  }
  return <LoadingPlaceholder />;
}
```

`seeded` starts false. `questionsComplete` flips true on submit. While
both are false, the component renders the questionnaire inline (NOT as
a nested portal — this avoids the two-stacked-modals problem that
trapped the questionnaire behind the wizard frame in early Wave 4).

### Parsing the design result

```ts
const designResult = JSON.parse(review.design_result);
const adoptionQuestions = designResult.adoption_questions ?? [];
```

`review.design_result` is the raw `payload` object from the template
JSON, stringified by `seedTemplates.ts`. Adoption questions flow
through **unchanged** — all `vault_category` / `option_service_types`
/ `dynamic_source` / `allow_custom` fields survive. The LLM
regeneration path in `template_adopt.rs` is only exercised when a
template ships without pre-curated questions, which none of the
shipped templates do.

### Pre-populating answers

On first render, `adoptionAnswers` is built from three layers merged in
order (later wins):

1. **Template defaults** — `q.default` for every question
2. **Vault auto-detect** — `matchVaultToQuestions(questions,
   credentialServiceTypes)` sets answers for questions with exactly
   one matching credential (see
   [04-adoption-questionnaire.md](04-adoption-questionnaire.md) for
   the matcher semantics)
3. **Restored draft** — if `adoptionDraft` exists in the system store
   and its `reviewId` matches this review, restore the saved answers.
   Used by the "Add credential" redirect flow where the user jumps to
   the catalog to create a credential and resumes afterwards.

Merged answers are set via `setAdoptionAnswers` in a single React
update to avoid transient flicker.

### Dynamic options hook

`useDynamicQuestionOptions(questions, adoptionAnswers)` returns
`{dynamicOptions, retry}`. For every question with a `dynamic_source`,
it fires a `discover_connector_resources` IPC call and exposes
per-question state `{loading, ready, error, items, waitingOnParent}`.
See [05-dynamic-discovery.md](05-dynamic-discovery.md).

### Submit

Clicking **Submit** calls `setQuestionsComplete(true)`. This triggers
two effects:

1. The phase-3 guard flips, so the next render falls through to the
   seed effect.
2. The answers get merged into the build draft as `_adoption_answers`
   and the build phase is patched to `draft_ready` (unless a more
   advanced phase is already active, which would regress).

## Phase 4 — Matrix + build session

**Trigger**: `seedDone.current` ref flips true when
`(questionsComplete || !hasAdoptionQuestions)` and `designResult` is
available.

**Effect**:

```ts
const dimensionData = extractDimensionData(designResult);
// -> {"use-cases": {items: [...]}, "connectors": {...}, "triggers": {...}, ...}

const persona = await createPersona({
  name: designResult.name.slice(0, 60),
  description: review.instruction?.slice(0, 200),
  system_prompt: "You are a helpful AI assistant.",
});

const sessionId = await invokeWithTimeout("create_adoption_session", {
  personaId: persona.id,
  intent: review.instruction || templateName,
  agentIrJson: JSON.stringify(designResult),
  resolvedCellsJson: JSON.stringify(dimensionData),
});

useAgentStore.getState().hydrateBuildSession({
  id: sessionId,
  personaId: persona.id,
  phase: "draft_ready",
  resolvedCells: dimensionData,
  agentIr: designResult,
  ...
});
```

### Cell extraction (`extractDimensionData`)

Walks the design_result to populate the 8 matrix dimensions:

| Dimension | Source field(s) |
|---|---|
| `use-cases` | `use_cases` → falls back to `use_case_flows.map(flow => ...)` |
| `connectors` | `suggested_connectors` (with `service_type`, `purpose`, `has_credential`) |
| `triggers` | `suggested_triggers` (normalized via `TRIGGER_TYPE_ALIASES`) |
| `messages` | `suggested_notification_channels` |
| `human-review` | `protocol_capabilities.filter(type === "manual_review")` |
| `memory` | `protocol_capabilities.filter(type === "agent_memory")` |
| `error-handling` | `structured_prompt.errorHandling` (markdown section parser) |
| `events` | `suggested_event_subscriptions` |

Missing dimensions get reasonable defaults (e.g. `human-review: ["Not
required — fully automated"]`).

### Process activity

`useOverviewStore.processStarted('template_adopt', personaId, ...)`
registers the adoption in the top-right process drawer. Phase
transitions get mirrored via `updateProcessStatus` so the user can
watch adoption progress from anywhere in the app.

### The adoption session vs a normal build session

`create_adoption_session` (Rust) creates a row in `build_sessions` with
the template's pre-resolved cells. This differs from an interactive
build (where the LLM populates cells one at a time) — adoption sessions
arrive pre-populated and go directly to `draft_ready`. The test phase
then runs against the already-known-good template output.

## Phase 5 — Test → Promote

Once `seeded === true` and the Focus variant exits (questionsComplete),
`MatrixAdoptionView` falls through to rendering `PersonaMatrix` with
full `useMatrixBuild` + `useMatrixLifecycle` hooks attached.

### Auto-test

```ts
// MatrixAdoptionView.tsx ~line 366
const autoTestedRef = useRef<string | null>(null);
useEffect(() => {
  if (build.pendingQuestions?.length > 0) autoTestedRef.current = null;
}, [build.pendingQuestions]);
useEffect(() => {
  if (buildPhase !== 'draft_ready') return;
  if (autoTestedRef.current === personaId) return;
  if (hasAdoptionQuestions && !questionsComplete) return;
  if (build.pendingQuestions?.length > 0) return;
  if (build.buildError) return;
  autoTestedRef.current = personaId;
  lifecycle.handleStartTest();
}, [...]);
```

The ref guard resets whenever new pending questions appear — multi-round
support for templates that surface runtime project probes (see
`HANDOFF-templates-adoption.md` Wave 2 for background).

### Post-promotion

```ts
// MatrixAdoptionView.tsx ~line 485
useEffect(() => {
  if (buildPhase === 'promoted') {
    setTimeout(() => handleViewAgent(), 1500);
  }
}, [buildPhase]);
```

1.5s delay so the user sees the "Promoted!" indicator before the view
fades out and navigates to the new agent's editor.

## Deferred persona creation (important)

The seed effect creates the persona **after** the questionnaire is
submitted, not when the wizard opens. This was a deliberate fix — early
versions created a draft persona on wizard open, which meant closing
the wizard mid-questionnaire left orphan personas. The current flow:

- Wizard opens → no DB writes, no persona row
- Questionnaire renders, user can close freely
- Submit → `createPersona` + `create_adoption_session` in one atomic step
- From that point forward, close triggers the discard confirmation

If you touch this effect, preserve the
`if (hasAdoptionQuestions && !questionsComplete) return` early-exit.

## Adoption draft (resume flow)

When a questionnaire hits a blocked question (no credential for
`vault_category`), the user clicks **Add credential**. That handler:

```ts
// handleAddCredentialForCategory in MatrixAdoptionView
sys.setAdoptionDraft({
  reviewId: review.id,
  templateName,
  userAnswers: { ...adoptionAnswers },
  step: 'questionnaire',
  savedAt: Date.now(),
});
sys.setPendingCatalogCategoryFilter(category);
sys.setSidebarSection('credentials');
onClose();
```

The draft lives in `systemStore`. When the user re-opens the same
template after creating the credential, `MatrixAdoptionView`'s defaults
effect detects `draft.reviewId === review.id` and merges `userAnswers`
back into the new `adoptionAnswers` state. Draft cleared on successful
restore.

## Phases the backend actually cares about

The `build_phase` column in `build_sessions` has these values for
adoption:

| Phase | Meaning | UI surface |
|---|---|---|
| `initializing` | Wizard opened, no session yet | Not applicable — no session row |
| `awaiting_input` | Questionnaire waiting on user | "Input required" dot in process drawer |
| `analyzing` | (Unused in adoption — only LLM builds) | — |
| `resolving` | (Unused in adoption) | — |
| `draft_ready` | Matrix cells populated, ready to test | Green dot; "Test & Promote" CTA |
| `testing` | Test run in flight | Spinner; streaming tool results |
| `test_complete` | Tests finished, awaiting approval | "Approve to promote" CTA |
| `promoted` | Agent lives in production | Fade out + navigate |
| `failed`, `cancelled` | Terminal | Red dot; "Delete Draft" button |

`SAFE_CLOSE_PHASES` in `AdoptionWizardModal` = `{'initializing',
'promoted', 'cancelled', 'failed'}` — these don't trigger the discard
confirmation on close.

## Files involved at a glance

| File | Role |
|---|---|
| `src/features/templates/sub_generated/adoption/AdoptionWizardModal.tsx` | Outer BaseModal + close confirmation |
| `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx` | Orchestrator: parse design_result, questionnaire gate, seed effect, auto-test |
| `src/features/templates/sub_generated/adoption/QuestionnaireFormFocus.tsx` | Focus variant — one question at a time + live preview |
| `src/features/templates/sub_generated/adoption/QuestionnaireFormGrid.tsx` | Shared sub-components (QuestionCard, SelectPills, CATEGORY_META) |
| `src/features/templates/sub_generated/adoption/useDynamicQuestionOptions.ts` | Dynamic discovery frontend hook |
| `src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts` | Credential auto-detect / block logic |
| `src/features/agents/components/matrix/useMatrixBuild.ts` | Build state hook (hydrated via `hydrateBuildSession`) |
| `src/features/agents/components/matrix/useMatrixLifecycle.ts` | Test / promote / refine callbacks |
| `src-tauri/src/commands/design/template_adopt.rs` | `create_adoption_session`, `check_template_integrity`, LLM path (unused for shipped templates) |
| `src-tauri/src/db/repos/communication/reviews.rs` | `batch_create_reviews` with ON CONFLICT upsert |
