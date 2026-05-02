# Code Refactor Scan — Settings

> Scanned: 2026-05-02 | Findings: 8 | Files reviewed: ~22

## Summary

The Settings feature is well-organized into per-tab `sub_*` folders with a clean lazy-mount pattern in `SettingsPage.tsx`. Three patterns dominate the refactor opportunities here: (1) **single-provider drift** — Codex was removed leaving `claude_code` as the only provider, but several scaffolds (`CliEngine` union, `EngineCapabilityMap`, `getPreferredProvider`, mid-Provider iteration) still pretend multi-provider exists; (2) **inconsistent barrels** — seven of nine `sub_*` folders ship a one-line `index.ts` re-export that no caller imports (everyone goes deep); and (3) **scattered duplication** — confirm-reset state machines, BYOM rule-list shells, and severity-color tables are copy-pasted across siblings without a shared primitive. None of this is dangerous; all of it slows future readers.

## 1. Seven `sub_*/index.ts` barrels are entirely unused

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/settings/sub_account/index.ts`, `sub_admin/index.ts`, `sub_appearance/index.ts`, `sub_byom/index.ts`, `sub_engine/index.ts` (lines 1-2 only — see below), `sub_notifications/index.ts`, `sub_portability/index.ts`
- **Scenario**: Every `sub_*` (except `sub_quality_gates` and `sub_config`) ships a barrel like `export { default as AccountSettings } from './components/AccountSettings'`. A project-wide search for `from '@/features/settings/sub_(account|admin|appearance|byom|engine|notifications|portability)'` returns **zero** matches. `SettingsPage.tsx` lazy-imports the deep paths directly; `EngineCapabilityBadge` is also imported via deep path (`sub_engine/components/EngineCapabilityBadge`), as are the `engineCapabilities.ts` exports consumed by `useEngineCapabilities`.
- **Root cause**: Convention copied early; no one routed through it. New consumers naturally pick the deep path because that's what `SettingsPage.tsx` models.
- **Impact**: 7 files of misleading scaffolding. Future authors see them and assume the barrel is canonical, then either use it (creating churn) or wonder which path is "right."
- **Fix sketch**:
  - Delete the 7 single-line `index.ts` files.
  - In `sub_engine/index.ts` (the only non-trivial barrel — re-exports `EngineCapabilityBadge`, `CLI_OPERATIONS`, `mergeCapabilities`, etc.), also delete it: every consumer already uses deep paths.
  - Don't restore the convention unless a real cross-package boundary appears.

## 2. `getPreferredProvider` and `preferredProvider` hook field are dead consumer-side

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/settings/sub_engine/libs/engineCapabilities.ts:137-155`, `src/hooks/utility/data/useEngineCapabilities.ts:108-112,119`
- **Scenario**: `getPreferredProvider` is exported, re-exported through the unused barrel, and surfaced on the hook as `preferredProvider`. A grep for `preferredProvider` finds **only** its own declaration and shape — no caller. The function's own block comment admits it's a single-element loop after Codex removal: "Single-provider state since Codex removal — PROVIDERS contains only `claude_code`."
- **Root cause**: Designed for a multi-provider future that hasn't materialized; the only caller (the hook) exposes it but never gets read.
- **Impact**: Future readers see a "preferred provider" abstraction and assume routing logic exists somewhere. There is no routing — the matrix UI just toggles bools and the dispatcher reads `cli_engine` directly.
- **Fix sketch**:
  - Drop `getPreferredProvider` from `engineCapabilities.ts` and `preferredProvider` from `useEngineCapabilities`'s return shape.
  - If/when a second provider is added, reintroduce the abstraction with real callers.

## 3. `EngineCapabilityMap` defaults still hardcode `ollama: false` for every operation

- **Severity**: medium
- **Category**: cleanup
- **File**: `src/features/settings/sub_engine/libs/engineCapabilities.ts:90-101`
- **Scenario**: `DEFAULT_CAPABILITIES` has 10 entries, each `{ claude_code: true, ollama: false }`. `PROVIDERS` is `[{ id: 'claude_code', ... }]`. `EngineCapabilityMap` is `Record<CliOperation, Record<CliEngine, boolean>>` and `CliEngine = "claude_code" | "ollama"` — so the type forces every entry to carry an unused `ollama` flag that the UI never renders, the merge never reads beyond shallow-spread, and `isOperationEnabled` only ever sees `claude_code`.
- **Root cause**: Codex was removed from `CliEngine` but `ollama` (which was never wired into the matrix UI) was left in the union.
- **Impact**: Every reader has to mentally distinguish "the union has ollama, but nothing iterates it." Stored capability JSON also carries the dead key forever.
- **Fix sketch**:
  - If ollama support genuinely exists somewhere else and just isn't in the matrix UI, document **which** code paths consume `cli_engine === 'ollama'` and add an `ollama` `ProviderMeta` entry to `PROVIDERS` so the UI is honest.
  - If ollama is dead (likely — there's no `'ollama'` literal anywhere in `src/features/settings`), narrow `CliEngine` to `'claude_code'` and drop the `ollama: false` columns from `DEFAULT_CAPABILITIES`.

## 4. Severity-styles + worst-severity ladder duplicated across BYOM rule lists

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/settings/sub_byom/components/ByomRoutingRules.tsx:7-11,49-67` and `ByomComplianceRules.tsx:7-11,49-67`
- **Scenario**: Both files declare the same `SEVERITY_STYLES` lookup verbatim, the same `worstSeverity` ternary chain (`error → warning → info`), the same `WorstIcon` resolution, and the same `border` selector applied to the rule card wrapper. The warning-list rendering at the bottom of each rule is also identical.
- **Root cause**: Compliance rules and routing rules were built from the same template; the per-rule UI diverges in the middle (provider chips vs. dropdown + complexity), but the chrome around each rule is the same.
- **Impact**: Two of three places to update if severity colors / worst-severity logic changes. With a third "rule kind" likely (looking at the BYOM section tabs structure) this triples.
- **Fix sketch**:
  - Extract `byomHelpers.ts:SEVERITY_STYLES` and a `pickWorstSeverity(warnings)` helper.
  - Extract a `<ByomRuleCard worstSeverity={...} headerLeft={...} headerRight={...} body={...} warnings={...}>` shell that owns the border, header layout, name input, toggle, trash, and warning footer.
  - Both files become thin: just provide `headerLeft`/`body`. Net code shrink ~80 lines.

## 5. Two-stage "confirm reset" state machine duplicated 3× with timer leak guards copy-pasted

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/settings/sub_admin/components/AdminSettings.tsx:20-22,29-34,47-63,236-273` (two instances within this one file) and `sub_quality_gates/components/QualityGateSettings.tsx:80,99-112`
- **Scenario**: The "click once to arm, second click confirms, auto-revert after 3s" pattern is implemented three separate times. AdminSettings even hand-rolls two `useRef<Timeout>` cleanup effects for it. QualityGateSettings does the same dance with a fire-and-forget `setTimeout` that does NOT clear on unmount (a small bug inherited from copy-paste — see fix sketch).
- **Root cause**: No shared primitive; each new settings panel reaches for the same UX pattern and reimplements it.
- **Impact**: 3 implementations to keep in lockstep; QualityGateSettings missed the unmount-cleanup that AdminSettings carefully added.
- **Fix sketch**:
  - Extract a `useArmedAction({ onConfirm, armWindowMs = 3000 })` hook returning `{ armed, trigger, reset }`.
  - Replace the three call sites with `const reset = useArmedAction({ onConfirm: resetTour })`.
  - Hook owns the `useRef<Timeout>` and the unmount cleanup — no caller has to remember it.

## 6. AccountSettings hand-rolls a toggle while every sibling uses `AccessibleToggle`

- **Severity**: low
- **Category**: cleanup
- **File**: `src/features/settings/sub_account/components/AccountSettings.tsx:72-91`
- **Scenario**: AccountSettings telemetry toggle is built as a custom `<button role="switch" aria-checked>` with a hand-styled track and knob. AmbientContextPanel, NotificationSettings (3 toggles), ByomSettings — all use the shared `AccessibleToggle` from `@/features/shared/components/forms/AccessibleToggle`.
- **Root cause**: AccountSettings predates the shared component, or the author didn't know it existed.
- **Impact**: Visual inconsistency one click away from comparison; accessibility behavior may diverge over time as `AccessibleToggle` evolves and AccountSettings doesn't.
- **Fix sketch**:
  - Replace the inline `<button role="switch">` block with `<AccessibleToggle checked={telemetryOn} onChange={...} label={s.telemetry_toggle_aria} />`.
  - Drop the bespoke green/secondary track styles — they don't match anywhere else.

## 7. Debounced "save on value change" effect duplicated within NotificationSettings

- **Severity**: low
- **Category**: duplication
- **File**: `src/features/settings/sub_notifications/components/NotificationSettings.tsx:36-58,84-101`
- **Scenario**: The same first-mount-skip + 300ms-debounced auto-save block is written twice in this single file (`WeeklyDigestToggle` and the parent `NotificationSettings`). Both depend on `useAppSetting`. Both use a `useRef<boolean>` "skip first load" flag.
- **Root cause**: Inline implementation copied when the digest toggle was added.
- **Impact**: Self-contained, but the next "saves a setting on change" panel will copy it again.
- **Fix sketch**:
  - Extend `useAppSetting` (or add `useDebouncedAppSetting`) to take an optional `{ autoSaveDebounceMs }` and own the skip-first-load + debounce internally.
  - Replace both blocks with a single call.
  - Other settings panels (engine capabilities — `useEngineCapabilities` already has its own debounce inside `persist`) could converge here too eventually.

## 8. `sub_quality_gates` and `sub_config` lack `index.ts` while peers have them

- **Severity**: low
- **Category**: structure
- **File**: `src/features/settings/sub_quality_gates/`, `src/features/settings/sub_config/`
- **Scenario**: 7 of 9 `sub_*` directories ship an `index.ts`; these two don't. (See finding #1: the 7 that exist are useless, and the 2 that are missing don't actually need one.) The asymmetry is the issue, not which side is right.
- **Root cause**: New panels skipped the convention; old ones kept it.
- **Impact**: Trivial reader confusion ("did they forget the barrel here, or is it intentional?").
- **Fix sketch**:
  - Resolve consistently with finding #1 — delete all the unused `index.ts` files and standardize on deep imports throughout, since that's already the dominant pattern.
  - If you'd rather keep barrels, add the two missing ones (`sub_quality_gates/index.ts`, `sub_config/index.ts`) and route `SettingsPage.tsx` through them — but this is the higher-cost path.

> Total: 8 findings (0 high, 5 medium, 3 low)
