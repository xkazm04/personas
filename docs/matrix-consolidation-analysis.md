# PersonaMatrix Consolidation Analysis

Comparison of the **Creation flow** (UnifiedMatrixEntry + CLI build) vs the **Adoption flow** (AdoptionWizard + template transform) — what the creation flow is missing, and how to consolidate into a single component.

---

## Current Architecture

```
CREATION FLOW (new agent from intent)
  UnifiedMatrixEntry.tsx
   └─ PersonaMatrix (variant="creation")
       ├─ MatrixCommandCenter (variant="creation")
       │   ├─ Intent textarea / Import toggle
       │   ├─ LaunchOrb → CLI build session
       │   ├─ ActiveBuildProgress (phase dots, completeness)
       │   ├─ SpatialQuestionPopover (cell-anchored questions)
       │   ├─ CreationPostGeneration (test/refine)
       │   ├─ TestResultsPanel / TestRunningIndicator
       │   └─ PromotionSuccessIndicator
       ├─ MatrixCellRenderer × 8 (state machine cells)
       ├─ ConnectorsCellContent (credential status + swap)
       └─ useMatrixBuild + useMatrixLifecycle

ADOPTION FLOW (template → persona)
  AdoptionWizardModal.tsx
   └─ AdoptionWizardInner.tsx (5-step wizard)
       ├─ Step 1: Choose (use case selection)
       ├─ Step 2: Connect (credential linking, inline creation)
       ├─ Step 3: Build (transform + questionnaire)
       ├─ Step 4: Data (entity selection, tool/trigger toggles)
       ├─ Step 5: Create (readiness check, identity card, success)
       └─ PersonaMatrix (variant="adoption", view/edit modes)
           ├─ MatrixCommandCenter (variant="adoption")
           │   ├─ BuildQuestionnaireModal (carousel questions)
           │   ├─ CapabilityToggle (web search/browse)
           │   └─ BuildCompletedIndicator
           ├─ EditableMatrixCells (inline editing)
           │   ├─ ConnectorEditCell (credential dropdown, swapper)
           │   ├─ TriggerEditCell (cron/webhook/polling config)
           │   ├─ ReviewEditCell (preset dropdown)
           │   ├─ MemoryEditCell (preset dropdown)
           │   ├─ MessagesEditCell (preset dropdown)
           │   ├─ ErrorEditCell (preset dropdown)
           │   └─ UseCaseEditCell (inline list add/remove)
           └─ Prompt section chips (Identity, Instructions, Tools, etc.)
```

---

## Feature Gap: What Creation Has That Adoption Doesn't

| Feature | Creation | Adoption |
|---------|----------|----------|
| CLI-driven build | Yes — multi-turn CLI with streaming events | No — uses n8n transform backend |
| Spatial question popovers | Yes — anchored to cells, numbered options | No — uses carousel modal |
| Real-time cell state machine | Yes — 8 states (hidden→filling→resolved→updated) | Partial — view mode, no state transitions |
| Background resilience | Yes — EventBridge + Channel dual-emit | No — wizard modal blocks navigation |
| Test lifecycle | Yes — test_build_draft → approve/reject/refine | No |
| Template matching | Yes (new) — keyword search against template catalog | N/A — starts from template |
| Connector alternatives | Yes (new) — swap button with CLI rebuild | No — connector type swapper exists but different |
| Agent name generation | Yes (new) — CLI generates name from intent | No — uses template name |
| Workflow import | Yes — n8n JSON upload → CLI context | Yes — but through separate n8n wizard |

## Feature Gap: What Adoption Has That Creation Doesn't

| # | Feature | Adoption Component | Missing In Creation | Priority |
|---|---------|-------------------|--------------------|----|
| 1 | **Inline credential creation** | InlineCredentialPanel, ManualCredentialForm | ConnectorsCellContent only links or navigates to vault | HIGH |
| 2 | **Editable dimension cells** | EditableMatrixCells (7 cell editors) | Cells are read-only after resolution; only refine via CLI | HIGH |
| 3 | **Trigger configuration** | TriggerEditCell (cron editor, webhook URL, polling interval) | Trigger data shown as text bullets only | HIGH |
| 4 | **Preset dropdowns** | ReviewEditCell, MemoryEditCell, MessagesEditCell, ErrorEditCell | These dimensions are CLI-resolved, no manual override | MED |
| 5 | **Use case list editing** | UseCaseEditCell (add/remove items inline) | Tasks are read-only bullets | MED |
| 6 | **Entity selection toggles** | DataStep with tool/trigger/connector checkboxes | All entities from agent_ir are included by default | MED |
| 7 | **Readiness checklist** | CreateReadinessChecklist (per-connector health status) | Only ConnectorsCellContent shows status dots | LOW |
| 8 | **Identity card** | CreateIdentityCard (name, counts, readiness indicators) | No summary view before promote | MED |
| 9 | **Database setup** | DatabaseSetupCard (new/existing table, schema, table name) | Not addressed — CLI doesn't handle DB config | LOW |
| 10 | **Template variables** | TemplateVariablesCard (runtime-configurable values) | Not applicable for freeform builds | LOW |
| 11 | **Prompt section chips** | PromptModal (expandable Identity/Instructions/Tools/Examples/Errors) | Only visible in draft_ready if agent_ir has structured_prompt | MED |
| 12 | **Connector category readiness** | architecturalCategories.ts with category-level credential check | Not used in creation flow | LOW |
| 13 | **Quick adopt (auto-resolve)** | QuickAdoptConfirm (skip wizard if all connectors ready) | No equivalent — always goes through CLI build | LOW |
| 14 | **Use case flow selection** | ChooseStepFlows (pick which template workflows to adopt) | N/A for freeform | LOW |
| 15 | **Safety scan banner** | DataStep safety critical warnings | Not implemented | LOW |

---

## Consolidation Plan

### Phase A: Enrich Creation Flow (add adoption features to PersonaMatrix creation variant)

These changes make the creation flow fully featured without touching the adoption code.

#### A1. Post-Build Edit Mode (HIGH)
After `draft_ready`, allow the user to click any resolved cell to switch it to edit mode.

**What to build:**
- Add an `editingCell` state to UnifiedMatrixEntry
- On cell click (when draft_ready), toggle between read-only and EditableMatrixCell
- Wire EditableMatrixCells callbacks to update `buildCellData` in the store
- When edits are made, show "Rebuild" button that sends `_refine` with the changed values

**Files:** UnifiedMatrixEntry.tsx, PersonaMatrix.tsx, matrixBuildSlice.ts

#### A2. Inline Credential Creation (HIGH)
When a connector shows red "Add in Keys", open an inline credential form instead of navigating away.

**What to reuse:** `InlineCredentialPanel.tsx` and `ManualCredentialForm.tsx` from adoption/steps/connect/
**What to build:**
- Import InlineCredentialPanel into ConnectorsCellContent
- Show inline form when user clicks "Add in Keys" instead of navigating to vault
- On credential creation, auto-link to the connector and trigger recalculate

**Files:** ConnectorsCellContent.tsx

#### A3. Trigger Configuration (HIGH)
After triggers dimension resolves, allow inline editing of cron schedules, webhook URLs, polling intervals.

**What to reuse:** `TriggerEditCell.tsx` from gallery/matrix/
**What to build:**
- Add expand/edit toggle to trigger cell content
- Wire TriggerEditCell into the resolved triggers cell
- On edit, update buildCellData and mark dimension as "updated"

**Files:** PersonaMatrix.tsx, matrixBuildSlice.ts

#### A4. Pre-Promote Review Summary (MED)
Before promoting, show a summary card with agent name, tool count, trigger count, connector status, and missing credentials.

**What to reuse:** Pattern from `CreateIdentityCard.tsx` and `CreateReadinessChecklist.tsx`
**What to build:**
- New `BuildReviewPanel` component shown when buildPhase === 'draft_ready' or 'test_complete'
- Counts derived from buildDraft (agent_ir)
- Readiness checklist from useMatrixCredentialGap
- Approve/Reject buttons wire to lifecycle handlers

**Files:** New component in matrix/, MatrixCommandCenterParts.tsx

#### A5. Prompt Section Chips in Draft Ready (MED)
When agent_ir has structured_prompt, show expandable prompt section chips in the command center.

**What exists:** PromptModal already renders Identity/Instructions/Tools/Examples/Errors sections
**What to build:**
- Extract structured_prompt from buildDraft when phase === 'draft_ready'
- Pass as designResult to MatrixCommandCenter
- Chips appear in post-generation view alongside test/refine controls

**Files:** UnifiedMatrixEntry.tsx, MatrixCommandCenter.tsx

#### A6. Preset Overrides for Simple Dimensions (MED)
For human-review, memory, messages, error-handling: allow quick preset selection after resolution.

**What to reuse:** Preset constants and dropdown UIs from `PresetEditCells.tsx`
**What to build:**
- On resolved cell click, show preset dropdown overlay
- Selecting a preset updates buildCellData and marks as "updated"
- "Rebuild" button appears to sync changes via CLI refine

**Files:** PersonaMatrix.tsx, PresetEditCells.tsx

#### A7. Entity Selection Before Promote (MED)
Let users toggle individual tools, triggers, connectors on/off before promoting.

**What to reuse:** Pattern from `DataStep.tsx` with checkboxes
**What to build:**
- In the pre-promote review (A4), add expandable sections for tools/triggers
- Each item has a checkbox (included by default)
- Unchecked items excluded from the promote_build_draft call

**Files:** BuildReviewPanel (new), promote command

---

### Phase B: Merge Components (single PersonaMatrix handles both flows)

#### B1. Unify Entry Points
Replace AdoptionWizardModal's use of PersonaMatrix with the same creation-variant flow.

**Strategy:**
- Template adoption becomes: pre-populate intent + pre-populate dimensions → launch build
- Instead of the 5-step wizard, template data pre-seeds the matrix cells
- CLI receives template context (already implemented via template lookup)
- User can adjust any dimension via inline editing (A1-A6)

**What changes:**
- `DesignReviewsPage` "Adopt" button calls `UnifiedMatrixEntry` with pre-populated state
- Template's payload populates `buildCellData` for all 8 dimensions
- CLI prompt includes full template as reference (not just name/description)
- The Choose step is eliminated (template is the choice)
- The Connect step is absorbed into ConnectorsCellContent (A2)
- The Build step is the CLI build with template context
- The Data step is the entity selection (A7)
- The Create step is the promote flow (already exists)

#### B2. Template Pre-seeding API
New store action: `seedBuildFromTemplate(templatePayload)` that:
1. Populates `buildCellData` for all 8 dimensions from template payload
2. Sets all cells to "resolved" state
3. Sets buildPhase to "draft_ready" (skip CLI entirely for full-coverage templates)
4. OR sets buildPhase to "resolving" and passes template to CLI for adaptation

**Decision point:** Should template adoption skip CLI entirely?
- **Skip CLI:** Faster, but user can't customize dimensions interactively
- **Use CLI with template:** Slower, but CLI can ask targeted questions about user's specific context
- **Recommendation:** Hybrid — pre-seed cells as "resolved", let user click any to refine. If user clicks "Customize", launch CLI with template context. If user clicks "Adopt as-is", go directly to promote.

#### B3. Retire Adoption Wizard
Once B1-B2 are complete:
1. Remove `AdoptionWizardModal`, `AdoptionWizardInner`, and all step components
2. Remove `AdoptionWizardContext` and `useAdoptReducer`
3. Keep `EditableMatrixCells` (now used by creation flow via A1)
4. Keep `InlineCredentialPanel` (now used by ConnectorsCellContent via A2)
5. Keep prompt section chips and extraction helpers
6. Update `DesignReviewsPage` to use the new unified entry

**Files to delete (~50 files):**
```
adoption/AdoptionWizardModal.tsx
adoption/AdoptionWizardInner.tsx
adoption/AdoptionWizardContext.tsx
adoption/BackButton.tsx
adoption/hooks/ (9 files)
adoption/state/ (7 files)
adoption/steps/ (all step components)
adoption/review/ (5 files)
adoption/wizardConstants.ts
adoption/templateVariables.ts
adoption/index.ts
```

**Files to keep/move:**
```
gallery/matrix/EditableMatrixCells.tsx → keep (used by enriched creation)
gallery/matrix/ConnectorEditCell.tsx → keep
gallery/matrix/TriggerEditCell.tsx → keep
gallery/matrix/PresetEditCells.tsx → keep
adoption/steps/connect/InlineCredentialPanel.tsx → move to shared
adoption/steps/connect/ManualCredentialForm.tsx → move to shared
```

---

## Implementation Order

```
Phase A (enrich creation — can ship incrementally):
  A1. Post-build edit mode           ← unlocks manual dimension adjustment
  A2. Inline credential creation     ← removes "Add in Keys" dead-end
  A3. Trigger configuration          ← most requested missing feature
  A4. Pre-promote review summary     ← reduces promote anxiety
  A5. Prompt section chips           ← shows what CLI generated
  A6. Preset overrides               ← quick adjust without CLI round-trip
  A7. Entity selection               ← choose which tools to include

Phase B (merge — requires Phase A complete):
  B1. Unify entry points             ← template adopt uses creation flow
  B2. Template pre-seeding API       ← instant cell population from template
  B3. Retire adoption wizard         ← delete ~50 files
```

---

## Shared Components After Consolidation

```
src/features/agents/components/matrix/
  UnifiedMatrixEntry.tsx          ← single entry (intent OR template)
  useMatrixBuild.ts               ← CLI orchestration
  useMatrixLifecycle.ts           ← test/promote/refine
  ConnectorsCellContent.tsx       ← credential status + swap + inline create
  SpatialQuestionPopover.tsx      ← cell-anchored questions
  cellStateClasses.ts             ← state machine CSS
  cellVocabulary.ts               ← dimension labels

src/features/templates/sub_generated/gallery/matrix/
  PersonaMatrix.tsx               ← the 3x3 grid (variant prop removed, single mode)
  MatrixCommandCenter.tsx         ← 9th cell (unified)
  MatrixCommandCenterParts.tsx    ← sub-components
  MatrixCellRenderer.tsx          ← cell rendering + state
  EditableMatrixCells.tsx         ← inline editors (7 types)
  personaMatrixHelpers.ts         ← extraction functions
  architecturalCategories.ts      ← connector categories

src/features/shared/components/credentials/
  InlineCredentialPanel.tsx       ← moved from adoption
  ManualCredentialForm.tsx        ← moved from adoption
```

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Template adoption UX regression | Keep adoption wizard behind feature flag until creation flow is verified |
| Inline editing conflicts with CLI state | Use "updated" cell state + explicit "Rebuild" action (no silent overwrites) |
| Performance with 95+ templates in prompt | Template lookup already limits to top 3 matches by keyword score |
| Losing adoption wizard's structured flow | Pre-promote review (A4) provides equivalent guardrails |
| Breaking existing template users | Migration path: adopt button launches unified flow with template pre-seeded |
