> Context: templates/generated [1/5]
> Total: 9
> Critical: 0  High: 0  Medium: 4  Low: 5

## 1. `extractDimensionData` empty-array masks the required/fallback source
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx:143,177,188
- **Scenario**: A template ships `suggested_connectors: []` (present but empty) and a populated `required_connectors`. `const connectors = (d.suggested_connectors ?? d.required_connectors ?? [])` uses `??`, which only falls back on `null`/`undefined` — an empty array is not nullish, so `connectors` stays `[]` and the Apps & Services matrix cell shows nothing. Same pattern for `suggested_triggers ?? d.triggers` (line 177). The sibling reader `buildChronology` (useUseCaseChronology.ts:357) correctly uses `.length > 0 ? suggested : required`, so the two surfaces disagree for the same template.
- **Root cause**: `??` chosen where a length check is required; an authored-but-empty array is a real template shape.
- **Impact**: UX — connectors/triggers silently disappear from the adoption preview and (via effectiveDesignResult) from what the persona is seeded with.
- **Fix sketch**: Mirror buildChronology: `const raw = (d.suggested_connectors as unknown[])?.length ? d.suggested_connectors : (d.required_connectors ?? []);` for connectors, triggers, and channels.

## 2. Adding a credential in the test report triggers a REJECT of the draft
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/templates/sub_generated/adoption/chronology/commandCenterParts.tsx:222
- **Scenario**: `TestResultsPanel` renders `<TestReportModal ... onCredentialAdded={onReject} />`. In TestReportModal, `onCredentialAdded` is fired after a user successfully saves a missing connector credential (TestReportModal.tsx:242 — it's meant as a "refresh" hook). Here it's wired to `onReject` (→ `onRejectTest` → `lifecycle.handleRejectTest`). So a user who fixes a credential gap from inside the report has their draft rejected instead of re-tested. (Reachability caveat: this chain is consumed only by ChronologyCommandHub → PersonaChronologyGlyph, which may be a prototype surface — the file header's claim of GlyphFullLayout/GlyphPrototypeLayout consumers is stale; grep finds none.)
- **Root cause**: refresh callback slot filled with the reject action; no dedicated "credential added → refresh" handler exists at this call site.
- **Impact**: data loss (abandoned draft) / confusing UX exactly when the user did the right thing.
- **Fix sketch**: Pass a refresh/no-op (e.g. `onCredentialAdded={() => {/* refetch connectors */}}`) rather than `onReject`.

## 3. Duplicated + divergent `TRIGGER_TYPE_ALIASES` / `normalizeTriggerType`
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx:57-66 vs adoption/chronology/useUseCaseChronology.ts:101-116
- **Scenario**: Two independent copies of the alias map + normalizer. They have already drifted: ChronologyAdoptionView maps `watcher/fs_watcher/watch → file_watcher`, `focus/window_focus → app_focus`, `poll → polling`; useUseCaseChronology's copy lacks all of these. A template whose trigger_type is `watch` or `focus` normalizes in one view and passes through raw in the chronology view.
- **Root cause**: copy-paste of the alias table instead of a shared export.
- **Impact**: maintainability + latent mislabeling of trigger types across the two adoption surfaces.
- **Fix sketch**: Export one `TRIGGER_TYPE_ALIASES` + `normalizeTriggerType` from a shared module (e.g. adoption/useCasePickerShared or a triggers util) and import in both.

## 4. Dead `handleApplyEdits` / `handleDiscardEdits` + no-op void render
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx:1408-1439,1543
- **Scenario**: `handleApplyEdits` and `handleDiscardEdits` (~30 lines, plus a `useCallback` each) are defined but never passed to any child. The code even admits it: line 1543 renders `{void (handleApplyEdits || handleDiscardEdits)}` purely to keep them "used", with a comment "no surface currently invokes them." The `{void (...)}` renders `undefined` — a pure no-op JSX expression left in the tree.
- **Root cause**: leftovers from the retired PersonaMatrix variant kept alive by a synthetic reference.
- **Impact**: maintainability — dead handlers bloat an already 1560-line component and mislead readers into thinking matrix edit-apply is wired.
- **Fix sketch**: Delete both callbacks and the `{void (...)}` line; re-add when a surface actually needs edit-apply.

## 5. `inferCategory` — `ticketing` branch is unreachable (ticket → support)
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/shared/architecturalCategories.ts:141,161
- **Scenario**: Line 141 returns `support` for `n.includes('support') || n.includes('ticket') || n.includes('helpdesk')`. Line 161's `if (n.includes('ticket')) return ARCH_CATEGORIES['ticketing']` can never fire — every 'ticket' name was already caught 20 lines earlier. So an unmapped connector like `zendesk_ticket` is bucketed as **support**, never **ticketing**, and the ticketing branch is dead.
- **Root cause**: overlapping substring predicates ordered so the broad one shadows the specific one.
- **Impact**: mis-categorization of ticketing connectors in gallery component filters; a genuinely dead branch.
- **Fix sketch**: Drop `ticket` from the line-141 support predicate (or move the ticketing check above support), so ticketing connectors resolve correctly.

## 6. `deriveCredentialBindings` never binds a multi-select vault answer
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts:108-114
- **Scenario**: Case 1 resolves the picked option via `q.options.indexOf(answer)`. Multi-select answers are stored CSV-encoded (SelectPills.toCsv → e.g. `"gmail,slack"`). `indexOf("gmail,slack")` returns -1, so no binding is produced and the backend keeps the placeholder connector name un-rewritten.
- **Root cause**: single-value assumption in a helper that also feeds multi-select questions.
- **Impact**: connectors on multi-select vault questions aren't rebound to concrete service_types (missing-credential at runtime). Narrow — most credential questions are single-select.
- **Fix sketch**: If the question is multi (`q.dynamic_source?.multi` or CSV detected), `parseCsv(answer)` and emit one binding per value, or document single-select-only.

## 7. Repeated tool-label formatter in TestReportModal
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/templates/sub_generated/adoption/chronology/TestReportModal.tsx:143,381,467
- **Scenario**: The identical `src.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())` "prefer connector over tool_name, then title-case" transform is inlined three times (ToolTab, ResultCards.toolLabel, ToolDetailView.subject).
- **Root cause**: copy-paste instead of a small local helper.
- **Impact**: maintainability — three copies to keep in sync.
- **Fix sketch**: Extract `toolLabel(r: ToolTestResult)` once at module scope and call it from all three.

## 8. Dead import `_ConnectorIcon` in useUcPickerState
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/adoption/ucPicker/useUcPickerState.ts:16
- **Scenario**: `import { ConnectorIcon as _ConnectorIcon, getConnectorMeta, type ConnectorMeta } from '@/lib/connectors/connectorMeta'` — `_ConnectorIcon` is never referenced in the hook (only `getConnectorMeta`/`ConnectorMeta` are). The underscore alias masks it, and the file's `@ts-nocheck` pragma suppresses the unused-import warning that would otherwise flag it.
- **Root cause**: leftover import after the icon rendering moved out of this hook.
- **Impact**: maintainability — dead import hidden behind `@ts-nocheck`.
- **Fix sketch**: Remove `ConnectorIcon as _ConnectorIcon` from the import.

## 9. `awaiting_input` seed branch is unreachable
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx:1087,1107-1108
- **Scenario**: The seed effect returns early at line 989 when `hasFilteredQuestions && !questionsComplete`. So by the time lines 1087/1107 run, that condition is always false — `initialPhase` is always `draft_ready` and `initialStatus` always `running`. The `awaiting_input` / `input_required` / "Adoption questions need answers" branches can never execute.
- **Root cause**: guard clause makes the later ternaries' first branch dead; likely a remnant of an earlier flow that seeded before questions completed.
- **Impact**: maintainability — dead branches imply a state (seed-while-awaiting-input) that no longer exists, misleading future edits.
- **Fix sketch**: Replace both ternaries with the constant results (`'draft_ready'` / `'running'`), or hoist the seed to actually support the awaiting-input case if that was the intent.
