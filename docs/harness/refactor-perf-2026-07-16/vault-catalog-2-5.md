# vault/catalog [2/5] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 5 medium / 1 low)
> Context group: Credentials & Connectors | Files read: 18 | Missing: 0

## 1. Dead `onUniversalSetup` prop and button branch in IdlePhase
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_catalog/components/design/phases/IdlePhase.tsx:13
- **Scenario**: `IdlePhase` accepts an optional `onUniversalSetup` callback and renders an "Any service" button when it is provided — but a repo-wide grep shows the only consumer is `CredentialDesignModalBody.tsx:117`, which never passes the prop. The button, its Globe icon import usage, and the `t.vault.design_phases.any_service` string are unreachable.
- **Root cause**: Leftover from a removed/never-shipped "universal setup" entry point; the prop was kept optional so nothing broke when the caller stopped wiring it.
- **Impact**: Dead UI branch misleads readers into thinking a universal-setup flow exists; the interface is wider than reality, and the i18n key is kept alive for nothing.
- **Fix sketch**: Delete `onUniversalSetup` from `IdlePhaseProps`, the destructure, and the `{onUniversalSetup && (...)}` block (lines 60-68). Drop `Globe` from the lucide import if now unused. Verified single caller via repo-wide grep; no dynamic usage possible (prop-based).

## 2. Sanitize-then-open external-URL logic duplicated 4 ways, with one copy skipping sanitization
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/design/setup/InteractiveSetupInstructions.tsx:70
- **Scenario**: The same "sanitizeExternalUrl → openExternalUrl → fallback/log" sequence is re-implemented in `InteractiveSetupInstructions.tsx:70-79`, `negotiator/StepActions.tsx:31-39` (identical `window.open` fallback), `AutoCredBrowser.tsx:54-61` (logger variant), and `AutoCredConsent.tsx:28-32`. The AutoCredConsent copy opens `ctx.docsUrl` **without** calling `sanitizeExternalUrl` at all — a behavioral drift the duplication already produced.
- **Root cause**: Each component hand-rolled its own open-URL callback instead of sharing one helper next to `openExternalUrl`.
- **Impact**: Four divergent implementations of a trust-boundary operation; one already dropped the sanitizer, and future fixes (e.g. changing the fallback policy) must be applied in four places.
- **Fix sketch**: Add `openSafeExternalUrl(url: string, opts?: { fallbackToWindowOpen?: boolean })` beside `openExternalUrl` in `src/api/system/system.ts` (or `lib/utils/sanitizers`) that sanitizes, opens, and handles the error path once. Replace all four call sites; AutoCredConsent gains sanitization for free.

## 3. Dead stagger-animation machinery in AutoCredBrowser (delay computed, never used)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/sub_catalog/components/autoCred/steps/AutoCredBrowser.tsx:75
- **Scenario**: `annotatedItems` computes `isNew`/`newCounter`/`delay` per entry using `prevGroupCountRef`, and a trailing effect (line 102) updates the ref every render — but the render destructures `delay: _delay` (line 129) and never applies it; entries just get a static `animate-fade-slide-in` class.
- **Root cause**: Leftover from a framer-motion staggered-entry animation that was replaced with a CSS class; the delay computation and the ref-tracking effect survived the swap.
- **Impact**: ~15 lines of misleading bookkeeping running inside a `useMemo` that recomputes on every log append during an active browser session, plus an unconditional effect every render — all producing an unused value.
- **Fix sketch**: Either apply the delay (`style={{ animationDelay: `${delay}s` }}`) if the stagger is still wanted, or delete `prevGroupCountRef`, the `isNew`/`newCounter` logic, the `delay` field, and the effect at line 102, leaving `annotatedItems` as a pure divider-insertion pass.

## 4. `filterTemplateConnectors` recomputed on every render of the design modal
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_catalog/components/design/useCredentialDesignModal.ts:98
- **Scenario**: `const templateConnectors = filterTemplateConnectors(connectorDefinitions, templateSearch)` runs unconditionally in the hook body, so every keystroke in the instruction textarea (orch state), every log line during the analyzing phase, and every unrelated state change re-filters the full connector catalog and allocates a fresh array — even when the templates panel is closed.
- **Root cause**: Derived data computed inline in a hook that re-renders on high-frequency orchestrator state, without `useMemo`.
- **Impact**: Bounded but repeated waste on a hot render path (streaming output lines re-render the modal continuously during analysis); the fresh array identity also defeats any memoization downstream in `IdlePhase`/`IdleSuggestions`.
- **Fix sketch**: `const templateConnectors = useMemo(() => filterTemplateConnectors(connectorDefinitions, templateSearch), [connectorDefinitions, templateSearch])`. Optionally gate on `showTemplates` so the closed-panel case pays nothing.

## 5. ConnectorCard is not memoized despite rendering in a large animated grid
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_catalog/components/picker/ConnectorCard.tsx:51
- **Scenario**: Each `ConnectorCard` is a framer-motion button with 5+ variant-driven child `motion` elements, tooltips, and per-render calls to `getAuthMethods`/`getLicenseTier`. When the catalog picker's parent state changes (e.g. typing in the catalog search field), every card in the grid re-renders and re-evaluates its motion tree.
- **Root cause**: No `React.memo` on a leaf component whose props (`connector`, `isOwned`, `isNew`, `recipeIndicator`, `onPickType`) are stable for a given item; the constant cost is multiplied by the number of connectors in the catalog.
- **Impact**: With a catalog of dozens-to-hundreds of connectors, search keystrokes pay O(cards) framer-motion reconciliation for cards whose props did not change. Needs verification that the parent list actually re-renders on keystroke (parent is outside this context), but the fix is safe regardless.
- **Fix sketch**: Wrap the export in `React.memo`. Ensure the parent passes a stable `onPickType` (`useCallback`) and stable `recipeIndicator` references so the memo actually holds; `cardVariants` etc. are already module-level constants.

## 6. Per-markdown `setup-steps-*` localStorage keys accumulate forever
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/vault/sub_catalog/components/design/setup/InteractiveSetupInstructions.tsx:37
- **Scenario**: Progress is persisted under `setup-steps-${simpleHash(markdown)}`. Every distinct setup-instruction markdown (each AI design run can produce different text, and refinement regenerates it) mints a new key that is written but never removed.
- **Root cause**: Content-hash-keyed persistence with no eviction or TTL.
- **Impact**: Slow unbounded growth of localStorage with orphaned step-progress arrays; individually tiny, but in a long-lived desktop app the keys never die and stale progress for near-identical markdown never applies again.
- **Fix sketch**: On write, prune: keep a small index (e.g. `setup-steps-index` array of keys, most-recent-first, capped at ~20) and delete evicted keys; or store `{ ts, steps }` and sweep keys older than N days on mount in `readPersistedSteps`.
