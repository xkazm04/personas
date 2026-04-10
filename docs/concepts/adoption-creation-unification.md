# Phase A: Enrich PersonaMatrix Creation Flow — Implementation Plan

Goal: Add adoption-wizard features to the creation flow without breaking existing functionality. Every step is additive — no deletions, no refactors of working code.

---

## Architecture Principle

The creation flow currently has two phases:
1. **Build phase** (CLI resolving dimensions) — cells are read-only, questions via spatial popovers
2. **Draft phase** (draft_ready/test_complete) — user reviews, tests, promotes

Phase A adds a **third capability: post-build inline editing** — after cells resolve, users can click any cell to adjust values, swap connectors, configure triggers, or override presets. Changes are tracked locally and synced to the CLI via `_refine` when the user confirms.

```
Build Phase          → Draft Phase          → Edit Phase (NEW)
CLI resolves cells     Review + Test           Click cell → inline editor
Questions via popover  Promote or refine       "Apply Changes" → CLI refine
```

**State management strategy:** Extend `matrixBuildSlice` with a `MatrixEditState` subset. Reuse existing `EditableMatrixCells` components by implementing `MatrixEditCallbacks` that write to the Zustand store.

---

## Step 1: Add Edit State to matrixBuildSlice

**File:** `src/stores/slices/agents/matrixBuildSlice.ts`

**What:** Add edit-related state fields and actions to the existing slice.

```typescript
// Add to MatrixBuildSlice interface:
buildEditState: {
  connectorCredentialMap: Record<string, string>;   // connector → credential ID
  connectorSwaps: Record<string, string>;           // original → replacement name
  triggerConfigs: Record<number, Record<string, string>>; // trigger index → config
  requireApproval: boolean;
  autoApproveSeverity: string;
  reviewTimeout: string;
  memoryEnabled: boolean;
  memoryScope: string;
  messagePreset: string;
  errorStrategy: string;
  useCases: Array<{ id: string; title: string; category: string }>;
};
buildEditDirty: boolean;  // true when user has made edits not yet synced to CLI
editingCellKey: string | null;  // which cell is currently in edit mode

// Add to actions:
setEditingCell: (cellKey: string | null) => void;
updateEditState: (partial: Partial<MatrixBuildSlice['buildEditState']>) => void;
markEditDirty: () => void;
clearEditDirty: () => void;
initEditStateFromDraft: () => void;  // populate editState from buildDraft (agent_ir)
```

**Initial values:** All empty/default. `initEditStateFromDraft()` reads `buildDraft` (agent_ir) and populates editState with current values so the edit cells show the CLI-resolved state.

**Why this approach:** Keeping edit state in Zustand (not local component state) means it survives navigation. The `buildEditDirty` flag enables the "Apply Changes" button.

**Dependencies:** None — purely additive to existing slice.

**Risk:** None — new fields with defaults, existing actions untouched.

---

## Step 2: Create useMatrixEditCallbacks Hook

**File:** `src/features/agents/components/matrix/useMatrixEditCallbacks.ts` (NEW)

**What:** Implements `MatrixEditCallbacks` interface by dispatching to the Zustand store.

```typescript
export function useMatrixEditCallbacks(): MatrixEditCallbacks {
  return {
    onCredentialSelect: (connectorName, credentialId) => {
      useAgentStore.getState().updateEditState({
        connectorCredentialMap: {
          ...useAgentStore.getState().buildEditState.connectorCredentialMap,
          [connectorName]: credentialId,
        },
      });
      useAgentStore.getState().markEditDirty();
    },
    onConnectorSwap: (original, replacement) => { /* update connectorSwaps */ },
    onTriggerConfigChange: (index, config) => { /* update triggerConfigs */ },
    onToggleApproval: (value) => { /* update requireApproval */ },
    onToggleMemory: (value) => { /* update memoryEnabled */ },
    onPreferenceChange: (key, value) => { /* update by key */ },
    onErrorStrategyChange: (value) => { /* update errorStrategy */ },
    onUseCaseAdd: (title) => { /* append to useCases */ },
    onUseCaseRemove: (id) => { /* filter from useCases */ },
    onUseCaseUpdate: (id, title) => { /* update in useCases */ },
  };
}
```

**Why a hook:** Encapsulates the callback→store wiring. Every edit cell gets the same callbacks, keeping PersonaMatrix clean.

**Dependencies:** `MatrixEditCallbacks` type from `matrixEditTypes.ts`, `useAgentStore`.

---

## Step 3: Wire Inline Editing into PersonaMatrix

**File:** `src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx`

**What:** When a resolved cell is clicked in draft_ready phase, switch it to edit mode using the existing EditableMatrixCell components.

**Changes:**
1. Import `useMatrixEditCallbacks` and EditableMatrixCells
2. Read `editingCellKey` and `buildEditState` from store
3. In the cell rendering logic, when `editingCellKey === cell.key` AND buildPhase is `draft_ready` or `test_complete`:
   - Render the appropriate EditableMatrixCell instead of read-only content
   - Pass `buildEditState` as `editState` and hook callbacks as `editCallbacks`
4. On cell click when buildPhase is draft_ready: dispatch `setEditingCell(cellKey)`
5. Click outside or press Escape: dispatch `setEditingCell(null)`

**Cell → Editor mapping:**
| Cell Key | Editor Component | Notes |
|----------|-----------------|-------|
| `use-cases` | `UseCaseEditCell` | Inline list add/remove |
| `connectors` | Keep `ConnectorsCellContent` | Already interactive (Step 5 enhances it) |
| `triggers` | `TriggerEditCell` | Cron/webhook/polling config |
| `human-review` | `ReviewEditCell` | Preset dropdown |
| `memory` | `MemoryEditCell` | Preset dropdown |
| `messages` | `MessagesEditCell` | Preset dropdown |
| `error-handling` | `ErrorEditCell` | Preset dropdown |
| `events` | No editor | Read-only (events are derived) |

**Visual cue:** Resolved cells in draft_ready show a subtle pencil icon on hover. Clicking opens the editor inline. The cell border changes to primary color while editing.

**Risk:** LOW — editing is gated behind `buildPhase === 'draft_ready'`. During build, cells remain read-only. Existing click-to-open-question behavior is gated behind `buildPhase === 'awaiting_input'`, so no conflict.

---

## Step 4: "Apply Changes" Button and CLI Refine

**File:** `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenterParts.tsx`

**What:** When `buildEditDirty` is true, show an "Apply Changes" button in the command center that sends a `_refine` message to the CLI with a summary of all edits.

**New component: `EditChangesBar`**
```typescript
function EditChangesBar({ onApply, onDiscard }: { onApply: () => void; onDiscard: () => void }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <button onClick={onApply} className="flex-1 btn-primary text-xs">
        Apply Changes
      </button>
      <button onClick={onDiscard} className="btn-ghost text-xs">
        Discard
      </button>
    </div>
  );
}
```

**Apply logic (in UnifiedMatrixEntry or useMatrixLifecycle):**
1. Build a summary string from `buildEditState` diff vs original `buildDraft`
2. Call `answerBuildQuestion(sessionId, '_refine', summary)`
3. Set edited cells to `filling` state while CLI processes
4. `clearEditDirty()`
5. CLI responds with updated dimensions → cells transition back to resolved

**Discard logic:**
1. Call `initEditStateFromDraft()` to reset edit state to CLI values
2. `clearEditDirty()`
3. `setEditingCell(null)`

**Where it renders:** In `CreationPostGeneration` section of MatrixCommandCenter, below the Test/Refine controls, only when `buildEditDirty === true`.

**Risk:** LOW — uses the existing `_refine` path which is already proven.

---

## Step 5: Inline Credential Creation in ConnectorsCellContent

**File:** `src/features/agents/components/matrix/ConnectorsCellContent.tsx`

**What:** Replace the "Add in Keys" navigation with an inline credential creation panel.

**Changes:**
1. Import `InlineCredentialPanel` from adoption/steps/connect/
2. Import `useVaultStore` for connector definitions
3. Add state: `creatingCredentialFor: string | null`
4. When user clicks "Add in Keys" → set `creatingCredentialFor` to connector name
5. Render `InlineCredentialPanel` inline (below the connector row) with:
   - `connectorName` = the connector being created for
   - `connectorDefinitions` = from vaultStore
   - `onSetCredential` = link the created credential to this connector
   - `onCredentialCreated` = refresh credential list, clear creating state
   - `onClose` = clear creating state
6. After credential is created → auto-link, show green dot, set `hasChanges = true`

**Fallback:** Keep the vault navigation as a secondary option ("Or go to Keys →") for users who prefer the full vault UI.

**Dependencies:** `InlineCredentialPanel`, `ManualCredentialForm`, `inlineCredentialHelpers` from adoption/steps/connect/. These are already standalone components.

**Risk:** LOW — InlineCredentialPanel is self-contained. The only integration point is the callback wiring.

---

## Step 6: Pre-Promote Review Summary

**File:** `src/features/agents/components/matrix/BuildReviewPanel.tsx` (NEW)

**What:** A summary card shown in the command center when buildPhase is `draft_ready` or `test_complete`, before the user promotes.

**Content:**
1. **Agent identity** — name (from agent_ir), icon, color, description
2. **Entity counts** — tools count, triggers count, connectors count (from buildDraft)
3. **Connector readiness** — green/amber/red status per connector (from useMatrixCredentialGap)
4. **Readiness checklist:**
   - Name present (not "Draft Agent")
   - All 8 dimensions resolved
   - No critical credential gaps
   - Structured prompt has identity + instructions
5. **Action buttons** — "Test Agent" (if not tested), "Promote" (if test passed), "Edit" (opens cell editing)

**Reuse pattern from:** `CreateIdentityCard` (for layout) and `CreateReadinessChecklist` (for checklist logic). Don't import directly — the adoption versions depend on `N8nPersonaDraft` type. Instead, create a lightweight version that reads from `buildDraft` (agent_ir JSON).

**Where it renders:** Replace or augment `CreationPostGeneration` in MatrixCommandCenter when buildPhase is `draft_ready`.

**Risk:** LOW — new component, no modifications to existing code.

---

## Step 7: Prompt Section Chips in Draft Ready

**File:** `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenter.tsx`

**What:** When buildPhase is `draft_ready` and agent_ir has a `structured_prompt`, show the expandable prompt section chips (Identity, Instructions, Tool Guidance, Examples, Error Handling) in the command center.

**Changes:**
1. In the `CreationPostGeneration` rendering path, extract `structured_prompt` from `buildDraft`
2. Convert to `AgentIR` shape: `{ structured_prompt: { identity, instructions, toolGuidance, examples, errorHandling } }`
3. Pass as `designResult` to the existing `sections` memo computation
4. Render section chips below the review summary / above test controls
5. Clicking a chip opens `PromptModal` (already exists) showing the full section content

**Why:** Users need to see what the CLI generated before promoting. Currently the structured_prompt is invisible — users only see dimension bullets.

**Risk:** VERY LOW — reuses existing PromptModal rendering path. Just needs the data bridge from buildDraft to AgentIR shape.

---

## Implementation Order and Dependencies

```
Step 1: Edit state in store          (no deps, foundation for steps 2-4)
   │
   ├─ Step 2: useMatrixEditCallbacks  (depends on Step 1)
   │     │
   │     └─ Step 3: Wire into PersonaMatrix  (depends on Steps 1-2)
   │           │
   │           └─ Step 4: Apply Changes button  (depends on Step 3)
   │
   ├─ Step 5: Inline credential creation  (independent, can run parallel)
   │
   ├─ Step 6: Review summary panel  (independent, can run parallel)
   │
   └─ Step 7: Prompt section chips  (independent, can run parallel)
```

**Parallel execution possible:**
- Steps 1→2→3→4 must be sequential (each builds on the previous)
- Steps 5, 6, 7 are independent of each other and of the edit chain
- Steps 5, 6, 7 can start immediately (only Step 3 needs Steps 1-2)

**Suggested execution batches:**
- **Batch 1:** Steps 1 + 2 + 5 (store foundation + credential creation)
- **Batch 2:** Steps 3 + 6 + 7 (cell editing + review + prompts)
- **Batch 3:** Step 4 (apply changes — needs manual testing)

---

## Files Modified (existing)

| File | Change | Risk |
|------|--------|------|
| `src/stores/slices/agents/matrixBuildSlice.ts` | Add editState, editDirty, editingCellKey fields + actions | LOW — additive only |
| `src/stores/storeTypes.ts` | Extend AgentStore type with new slice fields | LOW |
| `src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx` | Add cell-click→edit logic, import edit cells | MED — touches rendering |
| `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenter.tsx` | Add EditChangesBar, prompt chips in draft_ready | MED — touches rendering |
| `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenterParts.tsx` | Add EditChangesBar component | LOW — new export |
| `src/features/agents/components/matrix/ConnectorsCellContent.tsx` | Replace vault navigation with InlineCredentialPanel | MED — changes UX flow |
| `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` | Wire applyEdits handler | LOW |
| `src/features/agents/components/matrix/cellStateClasses.ts` | Add "editing" visual state | LOW |

## Files Created (new)

| File | Purpose |
|------|---------|
| `src/features/agents/components/matrix/useMatrixEditCallbacks.ts` | MatrixEditCallbacks → Zustand bridge |
| `src/features/agents/components/matrix/BuildReviewPanel.tsx` | Pre-promote summary card |

## Files Reused (no changes needed)

| File | Used By |
|------|---------|
| `EditableMatrixCells.tsx` (barrel) | Step 3 |
| `PresetEditCells.tsx` (ReviewEditCell, MemoryEditCell, etc.) | Step 3 |
| `TriggerEditCell.tsx` | Step 3 |
| `ConnectorEditCell.tsx` | Step 3 (optional, ConnectorsCellContent may be sufficient) |
| `matrixEditTypes.ts` (MatrixEditState, MatrixEditCallbacks) | Steps 1-3 |
| `InlineCredentialPanel.tsx` | Step 5 |
| `ManualCredentialForm.tsx` | Step 5 (via InlineCredentialPanel) |
| `inlineCredentialHelpers.ts` | Step 5 (via InlineCredentialPanel) |

---

## Testing Strategy

Each step should be verified via the test-automation framework before proceeding:

**Step 1-2:** Unit verification — `eval_js` to check store has new fields, callbacks don't throw
**Step 3:** Start a build, wait for draft_ready, click a resolved cell → verify edit UI appears
**Step 4:** Make an edit, verify "Apply Changes" button appears, click it → verify CLI refine triggers
**Step 5:** Start a build with missing connector → verify inline credential form appears (not vault navigation)
**Step 6:** Build to draft_ready → verify review panel shows correct counts and readiness
**Step 7:** Build to draft_ready → verify prompt chips are visible and expandable

**Regression check:** After each step, run a full build flow (Scenario 17 from test scenarios — 4-connector complex agent) to verify nothing breaks.

---

## What This Does NOT Change

- CLI build loop (`build_session.rs`) — no backend changes
- Event parsing or emission — no changes
- Question flow (SpatialQuestionPopover) — untouched
- Test/promote lifecycle — untouched
- Adoption wizard — untouched (Phase B concern)
- Template gallery — untouched
- Sidebar / navigation — untouched
