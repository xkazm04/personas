> Context: vault/catalog [2/5]
> Total: 6
> Critical: 0  High: 1  Medium: 4  Low: 1

## 1. Setup-progress restore corrupts state when instructions change (e.g. on refine)
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: state-corruption
- **File**: src/features/vault/sub_catalog/components/design/setup/InteractiveSetupInstructions.tsx:37-63
- **Scenario**: `storageKey = setup-steps-${simpleHash(markdown)}` is derived from `markdown`. The restore effect (deps `[rawToggle, storageKey]`) *toggles* each persisted index via `rawToggle(i)` rather than setting the completed set. On the first mount from an empty set this is fine. But when `markdown` changes on the SAME component instance — which happens in PreviewPhase when the user refines and `result.setup_instructions` changes — `storageKey` changes, the effect re-fires, and it toggles the newly-persisted indices *on top of the still-present completedSteps from the previous markdown*. `useStepProgress` is never reset on length/key change, and the `restored` flag never returns to false. Result: steps flip to the wrong completed/incomplete state, and stale indices ≥ the new step count linger in the set (miscounting `completedCount === totalSteps`).
- **Root cause**: restore models "apply saved progress" as a series of toggles against mutable prior state instead of an absolute set, and there is no reset when the storage key (markdown identity) changes.
- **Impact**: UX / data integrity — progress ring and "all steps complete" banner show wrong values after a refine; persisted JSON can contain out-of-range indices.
- **Fix sketch**: Add a reset when `storageKey` changes (e.g. `useStepProgress.reset()` in an effect keyed on `storageKey`, gated before restore), and restore by building the Set directly (`setCompletedSteps(new Set(saved))`) instead of toggling; re-arm `restored=false` on key change.

## 2. Recipe lookup can be bypassed by a concurrent design.start() race
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/vault/sub_catalog/components/autoCred/steps/CatalogAutoSetup.tsx:72-97
- **Scenario**: The recipe-lookup effect has deps `[connector.label, connector.name, design, phase]`; `design` is a fresh object each render, so the effect re-fires on every re-render while `phase==='analyzing' && design.phase==='idle'`. First fire sets `recipeLookedUpRef.current = true` and kicks off the async `lookupRecipeAsDesignResult(...)`. The sibling `checkPlaywrightAvailable().then(setMode)` effect resolves and triggers a re-render *before* the recipe promise resolves. The recipe effect re-runs, sees `ref === true` and `design.phase` still `'idle'`, and immediately calls `design.start(...)` — launching a full LLM analysis even though a cached recipe may be about to resolve. When the recipe promise then resolves with `cached`, it does `setPhase('auto')`, leaving a redundant design run executing in the background.
- **Root cause**: the "already looked up" ref is used to gate the second branch into `design.start`, but the recipe promise is still in flight; the unstable `design` dep makes the second fire happen at exactly the wrong moment.
- **Impact**: wasted LLM tokens / cost, possible flicker or state flip-flop between recipe result and live analysis.
- **Fix sketch**: Track lookup completion with a resolved flag/state (not just "started"), and don't call `design.start` until the recipe promise has settled; or await the lookup inside a single effect and drop `design` from the dep array (guard with a stable ref).

## 3. Foraging card crashes on an unknown source/confidence from the Rust backend
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src/features/vault/sub_catalog/components/foraging/ForagingResultCard.tsx:55-58,136-138
- **Scenario**: `credential.source` and `credential.confidence` come across the Tauri boundary from the Rust foraging scan. `SOURCE_META[credential.source]` and `CONFIDENCE_STYLES[credential.confidence]` are looked up with no fallback. If the Rust side ever emits a source key not in the map (a newly added scanner, a renamed variant, or a serde tag mismatch), `meta` is `undefined` and `fg[meta.labelKey]` / `meta.icon` throw at render, blanking the whole foraging results list.
- **Root cause**: exhaustive-map assumption on values that cross a process boundary and can drift independently of the TS union.
- **Impact**: crash / render blast-radius — one unexpected foraged credential takes down the entire results view.
- **Fix sketch**: Default the lookups (`const meta = SOURCE_META[credential.source] ?? FALLBACK_META;`), and either skip or render a generic row for unknown sources; same for `CONFIDENCE_STYLES`.

## 4. Stale `autoSetupPending` can hijack a later normal design into the AutoCred panel
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_catalog/components/design/useCredentialDesignModal.ts:62-95
- **Scenario**: `handleAutoSetup()` sets `autoSetupPending = true` and calls `orch.start()`. The capture effect only clears it when `orch.phase === 'preview'`. If that design run ends in `'error'` (or the user cancels/starts over without closing the modal), `autoSetupPending` stays `true`. When the user then runs a *normal* "Design credential" and it reaches `preview`, the effect fires, sets `autoSetupResult`, and the body switches to the full `AutoCredPanel` instead of the manual `PreviewPhase` — an unexpected auto-provision flow the user never asked for. Only `handleClose` resets the flag.
- **Root cause**: the pending flag is cleared solely on the success transition, not on error/reset, so it leaks across subsequent design attempts within the same open modal.
- **Impact**: UX — wrong phase surfaced; user is pushed into browser auto-cred without consent to it on this run.
- **Fix sketch**: Clear `autoSetupPending` on `orch.phase === 'error'` and in the retry/start-over/resetAll paths (or reset it inside `orch.resetAll` wiring), not only in `handleClose`.

## 5. Dead stagger-delay machinery in AutoCredBrowser
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/vault/sub_catalog/components/autoCred/steps/AutoCredBrowser.tsx:75-102,129
- **Scenario**: `annotatedItems` computes a per-entry `delay` (`isNew ? Math.min(newCounter, 8) * 0.08 : 0`), maintaining `newCounter`, `prevGroupCountRef`, and an extra effect (`useEffect(() => { prevGroupCountRef.current = groupedEntries.length; })`) purely to feed it. At render the value is destructured as `const { group, gi, delay: _delay } = item;` and never used — entries animate via the static `animate-fade-slide-in` class with no inline delay. Verified: `_delay` has no reference anywhere in the JSX.
- **Root cause**: leftover from an earlier staggered-animation approach that was replaced by a CSS class; the plumbing was never removed.
- **Impact**: maintainability — dead ref/effect/counter obscure the component and invite confusion about whether stagger is active.
- **Fix sketch**: Drop the `delay`/`newCounter`/`prevGroupCountRef` logic and its effect from `annotatedItems`; keep just `{ kind, group, gi }` (or wire the delay into an inline `style={{ animationDelay }}` if stagger is actually wanted).

## 6. Dead `onUniversalSetup` ("any service") branch in IdlePhase
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/vault/sub_catalog/components/design/phases/IdlePhase.tsx:13,31,60-68
- **Scenario**: `onUniversalSetup` is an optional prop rendering the `any_service` button. Grep across `src` shows it is declared/consumed only inside IdlePhase itself — no caller ever passes it (CredentialDesignModalBody renders IdlePhase without it), so the button is unreachable dead UI plus an unused translation key `design_phases.any_service`.
- **Root cause**: a planned "universal setup" entry point that was never wired to a handler.
- **Impact**: maintainability — dead prop/branch and an orphaned i18n key.
- **Fix sketch**: Remove the `onUniversalSetup` prop and its button (and prune `any_service` from the catalogs) unless the universal-setup flow is imminent; otherwise wire it in the modal body.
