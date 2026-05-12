# Code-refactor scan — i18n System & Shared Design Components

> Total: 14 findings (4 high, 7 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: brief listed paths that do not exist — `src/components/{design,shared,ui}`, `src/lib/i18n`, `src/api/i18n.ts`, `src/stores/slices/i18nSlice.ts`, `src/stores/slices/themeSlice.ts`, `src-tauri/src/commands/i18n.rs`, `src-tauri/src/lib/i18n`, `src-tauri/src/db/models/locale.rs`, `src-tauri/locales`, `locales`. Actual i18n root: `src/i18n`. Shared components live under `src/features/shared/components/*`. There is no Tauri-side i18n module at all.

## 1. 312 keys missing in every non-English locale (13 × 312 ≈ 4,056 untranslated strings)
- **Severity**: high
- **Category**: cruft (operational debt) / structure
- **File**: `src/i18n/locales/ar.json` + 12 sibling locale files; verified via `npm run check:i18n`
- **Scenario**: `node scripts/i18n/check-coverage.mjs` reports each of the 13 non-English locales is missing the exact same 312 keys (mostly `agents.executions.*`, `agents.connectors.*`, `triggers.*` recently-added strings). The runtime falls back to English silently because `useTranslation` deep-merges, so the gap is invisible at runtime but real.
- **Root cause**: keys added to `src/i18n/locales/en.json` (and `section-locales/<lang>/*.json`) were never propagated to the 13 other locales. The CI gate (`check:i18n`) is failing but apparently non-blocking.
- **Impact**: ~4k untranslated strings shipping as English to international users. The CONTRACT.md "every locale's keyset must match en" invariant is broken across 13/14 locales.
- **Fix sketch**: run a backfill pass (auto-translate or punt to translators) for the 312 missing keys per language; then make `check:i18n` a CI blocker (lefthook pre-push) so this can't regress.

## 2. Triplicate language list maintenance — manifest, switcher, onboarding all redefine the locale set
- **Severity**: high
- **Category**: duplication
- **File**:
  - `src/i18n/locales.manifest.ts:32` — `LOCALES` (14 entries: code, nativeName, englishName, dir)
  - `src/features/home/components/LanguageSwitcher.tsx:17` — `LANGUAGES` (14 entries: code, label≈nativeName, english≈englishName, flag, script)
  - `src/features/onboarding/components/AppearanceStep.tsx:11` — `ONBOARDING_LANGUAGES` (only **11** entries — missing `bn`, `id`, `vi`!)
- **Scenario**: Three independent literal arrays redeclare the same language data. The onboarding picker is already drifting — Bengali, Indonesian, and Vietnamese users can't pick their language during onboarding even though it's available everywhere else.
- **Root cause**: `LanguageSwitcher` and `AppearanceStep` predate the central `LOCALES` manifest; nothing forces them to derive from it.
- **Impact**: bug visible to users (3 missing locales in onboarding), plus every future language add must touch 3 files in lockstep. The `LOCALES` `dir: 'rtl'` field is also stranded because no consumer reads it.
- **Fix sketch**: extend `LocaleDescriptor` with optional `flag` and `script` fields (or attach them in a second derived table next to `LOCALES`), then have both pickers `map(LOCALES, ...)` instead of redeclaring. Delete `LANGUAGES` and `ONBOARDING_LANGUAGES`.

## 3. RTL `dir` attribute declared in manifest but never applied to `<html>`
- **Severity**: medium
- **Category**: dead-code (orphan data) / structure
- **File**: `src/stores/i18nStore.ts:54` (`applyLangAttributes`) vs `src/i18n/locales.manifest.ts:24` (`dir: 'ltr' | 'rtl'`)
- **Scenario**: `LocaleDescriptor.dir` is set to `'rtl'` for Arabic but `applyLangAttributes` only writes `data-lang` and `lang` — it never sets `document.documentElement.dir`. Grep confirms no file in `src/` writes the `dir` attribute. Arabic UI renders LTR despite manifest declaring RTL.
- **Root cause**: the manifest was extended with `dir` but the store wasn't updated to consume it.
- **Impact**: Arabic users see a broken layout; the `dir` field on `LOCALES` is effectively dead metadata.
- **Fix sketch**: in `applyLangAttributes`, look up `getLocaleDescriptor(lang)?.dir ?? 'ltr'` and `html.setAttribute('dir', dir)`. This also makes `getLocaleDescriptor` (an orphan export — see finding #11) used.

## 4. Eleven entirely orphan modules in `features/shared/components/*` (≈1,150 LOC dead)
- **Severity**: high
- **Category**: dead-code
- **File**: (all confirmed by `grep -rln` returning only their own definition file)
  - `src/features/shared/components/display/ChartEmptyState.tsx` — 123 LOC
  - `src/features/shared/components/display/GlossaryTooltip.tsx` — 43 LOC
  - `src/features/shared/components/display/TruncateWithTooltip.tsx` — 51 LOC
  - `src/features/shared/components/forms/FormFieldGroup.tsx` — 137 LOC
  - `src/features/shared/components/forms/TableSelector.tsx` — 173 LOC
  - `src/features/shared/components/forms/useShakeError.ts` — 28 LOC (referenced only in a doc-comment in `FormField.tsx:53`)
  - `src/features/shared/components/feedback/InlineErrorRecovery.tsx` — 100 LOC
  - `src/features/shared/components/feedback/illustrations/RecoverySpiral.tsx` — 40 LOC (only imported by `InlineErrorRecovery`, transitively orphan)
  - `src/features/shared/components/feedback/SaveFeedbackCheck.tsx` — 17 LOC
  - `src/features/shared/components/layout/AuthButton.tsx` — 119 LOC
  - `src/features/shared/components/layout/BreadcrumbTrail.tsx` — 172 LOC
  - `src/features/shared/components/progress/ConfigureStep.tsx` — 137 LOC
- **Scenario**: each file exports a public component but no other file in `src/` imports it. Some leave breadcrumbs (e.g. `BreadcrumbTrail` has a sibling `hooks/navigation/useBreadcrumbTrail.ts` that's also unused).
- **Root cause**: components built speculatively or abandoned during refactors; no tree-shaking signal because they all `export` named symbols.
- **Impact**: ~1,150 LOC of maintenance burden — design system contributors will keep "updating" these (bumping tokens, adding props) without realizing nothing consumes them.
- **Fix sketch**: delete all 12 files; remove any sibling test files. Consider an ESLint rule (e.g. `eslint-plugin-unused-imports` in "files" mode) or a CI guard that flags 0-import files.

## 5. Duplicated `ChartErrorBoundary` — byte-identical files in two locations
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/overview/sub_usage/charts/ChartErrorBoundary.tsx` vs `src/features/overview/sub_usage/components/ChartErrorBoundary.tsx` (`diff` returns no output)
- **Scenario**: identical implementation in two folders. All 5 consumers import the `components/` copy; `charts/` copy has zero importers — pure orphan duplicate.
- **Root cause**: file moved/renamed without deleting the original.
- **Impact**: ~50 LOC dead + cognitive load of "which one is canonical?".
- **Fix sketch**: delete `src/features/overview/sub_usage/charts/ChartErrorBoundary.tsx`.

## 6. Duplicated `TerminalBody` — two implementations, only one consumed
- **Severity**: medium
- **Category**: dead-code / duplication
- **File**: `src/features/shared/components/progress/TerminalBody.tsx` (74 LOC, orphan) vs `src/features/shared/components/terminal/TerminalBody.tsx` (274 LOC, canonical, 4 consumers)
- **Scenario**: All 4 importers (`ExecutionTerminal.tsx:4`, `useRunnerState.ts:9`, `CliOutputPanel.tsx:4`, `TemplatePreviewModal.tsx:4`) target `components/terminal/TerminalBody`. The `progress/` variant has its own `useTerminalScroll`, line classifier, and hardcoded translation key — none of it reachable. Implementations diverged (different APIs).
- **Root cause**: file copy during the `progress/` subfolder buildout; never wired up.
- **Impact**: 74 LOC of dead code that confuses search ("which TerminalBody do I import?").
- **Fix sketch**: delete `src/features/shared/components/progress/TerminalBody.tsx`.

## 7. Two parallel `EmptyState` components with overlapping responsibility
- **Severity**: medium
- **Category**: duplication / structure
- **File**: `src/features/shared/components/feedback/EmptyState.tsx` (205 LOC, default export, 19 consumers, scenario-based variants like `'credentials-need-agents'`) vs `src/features/shared/components/display/EmptyState.tsx` (120 LOC, named export, 4 consumers, illustration-variant-based `'chart' | 'activity' | 'alerts' | 'metrics'`)
- **Scenario**: Same component name in two folders with overlapping intent but different APIs. Importers must guess; the display/ version exports a `EmptyStateVariant` type that shadows the feedback/ one.
- **Root cause**: chart-specific empty state was carved out without renaming.
- **Impact**: 23 consumers split across two near-identical primitives; future "empty state" work has to be done twice.
- **Fix sketch**: rename the display/ one to `ChartEmptyStateVariant` or merge into feedback/ as additional variants. At minimum, alias `display/EmptyState` to a distinct name (`IllustratedEmptyState`?) so the type collision goes away.

## 8. Badge color-token table redeclared 3× across `Badge`, `StatusBadge`, and (less obviously) `SetupStatusBadge`
- **Severity**: medium
- **Category**: duplication
- **File**:
  - `src/features/shared/components/display/Badge.tsx:14-50` — `BADGE_VARIANTS`, `BADGE_HOVER`, `BADGE_TOKENS` (12 colors × 3 maps)
  - `src/features/shared/components/display/StatusBadge.tsx:20-50` — `VARIANT_CLASSES` (semantic) + `ACCENT_CLASSES` (15 colors, same `bg-{c}-500/10 text-{c}-400 border-{c}-500/20` scale)
  - `src/features/shared/components/display/SetupStatusBadge.tsx:28-46` — hardcoded inline `bg-amber-500/10 text-amber-400 border-amber-500/30` etc.
- **Scenario**: The "canonical opacity scale" documented in `Badge.tsx:6-12` is reimplemented in `StatusBadge` (with one-off `/20` → `/20` agreement that's actually fine, but maintained separately) and again as inline Tailwind in `SetupStatusBadge`. Adding a new accent color requires touching all three.
- **Root cause**: `StatusBadge` and `Badge` were built in parallel without one importing the other's token table.
- **Impact**: tokens drift (e.g. `StatusBadge` adds `slate`, `Badge` adds `yellow`, `neutral` style differs slightly between them); adding a color is ~3× the work.
- **Fix sketch**: have `StatusBadge` import `BADGE_TOKENS` from `Badge.tsx` and compose classes from those; rewrite `SetupStatusBadge` to be a thin wrapper that calls `StatusBadge` with `variant="warning"` / `"error"` and the appropriate icon.

## 9. `SetupStatusBadge` hardcodes English strings — bypasses i18n
- **Severity**: medium
- **Category**: cruft / structure
- **File**: `src/features/shared/components/display/SetupStatusBadge.tsx:19, 32-33, 41-42`
- **Scenario**: The badge renders raw English: `"Ready"`, `"Setup required"`, `"Misconfigured"`, plus full English sentences in `title=` attributes (`"One or more declared connectors have no vault credential…"`). No `useTranslation` import. Non-English users see English regardless of locale.
- **Root cause**: author skipped i18n because the badge "is only used internally" — but it ships to end-users via `PersonaOverviewBadges.tsx`.
- **Impact**: i18n hole; pseudo-locale (`?pseudo=1`) would catch this but the team isn't running it on every screen.
- **Fix sketch**: move the three labels and two tooltip strings into `agents.persona.setup_status_*` keys in `en.json` and the section-locales, then call `useTranslation()` in the component. Or, if folded into `StatusBadge` per finding #8, this disappears.

## 10. Three orphan exports in `locales.manifest.ts` — `LOCALES`, `DEFAULT_LOCALE`, `getLocaleDescriptor`
- **Severity**: low
- **Category**: dead-code
- **File**: `src/i18n/locales.manifest.ts:32, 53, 55`
- **Scenario**: Of the 6 exports, only `LocaleCode`, `LOCALE_CODES`, and `isLocaleCode` are consumed (by `i18nStore.ts` and `main.tsx`). `LOCALES` itself (the array), `DEFAULT_LOCALE` constant, and `getLocaleDescriptor()` helper are never imported anywhere in `src/` or `scripts/`. The "Note" comment in the manifest about `as const` is preserved for `LOCALES`, but `LOCALES` is then dead.
- **Root cause**: API was designed for callers that haven't been written; `LanguageSwitcher`/`AppearanceStep` reinvent their own arrays (see finding #2) instead of using `LOCALES`.
- **Impact**: tiny — but `DEFAULT_LOCALE` being unused while `i18nStore.ts:71` hardcodes `language: 'en'` is a missed single-source-of-truth.
- **Fix sketch**: wire `i18nStore`'s initial state to `DEFAULT_LOCALE`, have `LanguageSwitcher` derive from `LOCALES` (per finding #2), have `applyLangAttributes` use `getLocaleDescriptor` for `dir` (per finding #3). After fix #2 + #3, all three exports are live.

## 11. Orphan exports in `useTranslation.ts`, `useTranslatedError.ts`, `tokenMaps.ts`, `routeSections.ts`
- **Severity**: low
- **Category**: dead-code
- **File**:
  - `src/i18n/useTranslation.ts:135` — `preloadLanguage` (only called internally by the file's own `useLanguagePrefetch`)
  - `src/i18n/useTranslatedError.ts:162` — `friendlySeverityTranslated` (never called; only `resolveErrorTranslated` is used externally)
  - `src/i18n/tokenMaps.ts:61` — alias `export { tokenLabel as tToken }` is never imported as `tToken`
  - `src/i18n/routeSections.ts:40` — `preloadI18nForCurrentRoute` never imported
- **Scenario**: Four small exports flagged orphan by grep. The `tokenMaps.ts` JSDoc at line 57 also references a `useTokenLabel` hook that doesn't exist in the file.
- **Root cause**: API surface scaffolded ahead of callers, or callers refactored away without removing the export.
- **Impact**: ~30 LOC dead surface; small but adds confusion when readers see `useTokenLabel()` documented but uncallable.
- **Fix sketch**: delete `preloadLanguage` (callers use `useLanguagePrefetch`), `friendlySeverityTranslated`, the `tToken` alias, and `preloadI18nForCurrentRoute`. Fix the `useTokenLabel` doc-comment in `tokenMaps.ts:54-60` to refer to the real `tokenLabel` API.

## 12. `shared/components/modals/index.ts` re-export shim is mostly bypassed
- **Severity**: low
- **Category**: structure
- **File**: `src/features/shared/components/modals/index.ts:4`
- **Scenario**: The index re-exports `BaseModal` from `@/lib/ui/BaseModal` so contributors "find the canonical modal primitive under shared/components/modals/". Reality: **46** files import `BaseModal` directly from `@/lib/ui/BaseModal`; only **2** files use the new re-export path.
- **Root cause**: the re-export was added but the codemod / lint rule to migrate existing call-sites never ran.
- **Impact**: the documented "preferred path" isn't actually preferred. Two sources of truth for the same import; tree-shaking sees both.
- **Fix sketch**: either (a) codemod all 46 imports to `@/features/shared/components/modals` and add an ESLint `no-restricted-imports` rule banning the `@/lib/ui/BaseModal` path; or (b) delete the shim and standardize on `@/lib/ui/BaseModal` as the canonical path (matches the 46-vs-2 reality).

## 13. Two overlapping confirm-dialog primitives (`ConfirmDialog` vs `ConfirmDestructiveModal`)
- **Severity**: low
- **Category**: duplication / structure
- **File**: `src/features/shared/components/feedback/ConfirmDialog.tsx` (78 LOC, 3 consumers — all in `plugins/twin/sub_*`) vs `src/features/shared/components/overlays/ConfirmDestructiveModal.tsx` (234 LOC, 5 consumers, with `useConfirmDestructive` hook and blast-radius integration)
- **Scenario**: Two components conceptually serving the same role ("ask the user before doing a thing"). The destructive variant is richer (typed-confirmation gate, blast radius, warning banner) but the simple `ConfirmDialog` could be a default config of the same primitive.
- **Root cause**: `ConfirmDialog` predates the destructive variant; nothing forced consolidation when the richer one landed.
- **Impact**: 78 LOC duplicated dialog plumbing (Escape handler, click-outside, danger styling); contributors must choose between two primitives.
- **Fix sketch**: thin `ConfirmDialog` into a wrapper over `ConfirmDestructiveModal` (no blast radius, no typed confirmation, `danger?` controls accent), then migrate the 3 `plugins/twin` call-sites. Or document `ConfirmDialog` as deliberately-minimal in the file header and add a `lint-no-new-confirm-dialog` rule.

## 14. `tokenMaps.ts` doc-comment references a non-existent `useTokenLabel` hook
- **Severity**: low
- **Category**: cruft
- **File**: `src/i18n/tokenMaps.ts:54-60`
- **Scenario**: JSDoc says `const { tToken } = useTokenLabel(); <Badge>{tToken('execution', row.status)}</Badge>`, but `useTokenLabel` is not exported, not defined, and `tToken` is a bare alias (not destructurable). All 6 real consumers call `tokenLabel(t, …)` directly, matching the prior example block at line 19-21.
- **Root cause**: docs drift — the hook was planned, never implemented, but the example survived.
- **Impact**: tiny — a contributor copy-pasting the second example block gets a compile error.
- **Fix sketch**: delete lines 53-61 (the `useTokenLabel` example + alias) OR implement `useTokenLabel()` as a true hook that returns `{ tToken: (cat, tok) => tokenLabel(t, cat, tok) }` bound to the current translation bundle.
