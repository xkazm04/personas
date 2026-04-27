# Settings — Dev Experience Scan

> Total: 11 · Critical: 2 · High: 4 · Medium: 4 · Low: 1
> Scope: client-side only
> Date: 2026-04-27

---

## 1. Stale duplicate panel files at root of three sub_* folders

- **Severity**: Critical
- **Category**: code-organization
- **File**: `src/features/settings/sub_account/AccountSettings.tsx`, `src/features/settings/sub_admin/AdminSettings.tsx`, `src/features/settings/sub_notifications/NotificationSettings.tsx` (vs. their `components/<Same>.tsx` siblings)
- **Scenario**: Each of these three sub-folders has *two* `<Foo>Settings.tsx` files — one at the folder root and a newer one under `components/`. `SettingsPage.tsx` imports the `components/` version (the live one), and a project-wide grep finds **zero** references to the root-level files. The two NotificationSettings, for example, differ in non-trivial ways: the live one uses `AccessibleToggle` + a `prefsRef` to fix a stale-closure race on rapid toggles, plus a 300 ms debounce on save; the dead one uses raw `<button>` toggles and saves on every keystroke. AdminSettings root file is missing the entire User Consent section that ships in the live one.
- **Root cause**: A migration moved each panel under `components/` but the old file was never deleted. The folder root layout was the original convention; once `components/` arrived, ad-hoc — only some panels followed.
- **Impact**: Every editor "Find File" or `grep` for AccountSettings / AdminSettings / NotificationSettings returns two hits. Devs editing the wrong copy waste 5–30 min, ship a "fix" that doesn't render, then have to redo it. AI agents auto-pick the first match. Confusion compounds because the two copies have already drifted (race-fix lives only in one).
- **Fix sketch**: Delete the three root-level files. Add an ESLint or codeowners rule (or a tiny CI check) flagging any `.tsx` directly under `sub_*/` whose default export name is also exported from `sub_*/components/`. Document the convention in a one-paragraph README inside `src/features/settings/`.

---

## 2. `useSettingsTranslation` hook is dead code; 27 panels reach back into the global hook

- **Severity**: Critical
- **Category**: convention-drift
- **File**: `src/features/settings/i18n/useSettingsTranslation.ts:25`
- **Scenario**: `i18n/useSettingsTranslation.ts` exists with a doc-comment ("Mirrors the project pattern") and ships its own 14-locale `en/zh/ar/...` files. **Zero call sites** — every settings panel (27 files) instead imports `useTranslation` from `@/i18n/useTranslation` and digs through `t.settings.byom`, `t.settings.account`, etc. Meanwhile `i18n/en.ts` only defines a tiny scoped surface (`byom`, `qualityGates`, `configResolution`, `ambientContext`) — the *full* settings translation tree lives in the global locale files outside this folder.
- **Root cause**: A scoped-i18n refactor was started (the namespaced hook + 14 locale stubs were authored) but never adopted. The local `en.ts` only contains the strings that *would* have been moved out of the global tree, so it is a stub of a stub.
- **Impact**: New devs adding strings have to guess which i18n surface to extend. Translators see two divergent EN sources for the same feature. The 14 locale files are deadweight in `git blame` and `grep`. CI doesn't fail on unused hooks, so the rot persists indefinitely.
- **Fix sketch**: Pick one. Either (a) delete `src/features/settings/i18n/` entirely and document that settings uses the global i18n tree, or (b) actually migrate panels to `useSettingsTranslation` and prune the `t.settings.*` keys from the global locale files. Add a CI step that runs `tsc --noEmit` plus `ts-prune` on `src/features/settings/` to surface dead exports proactively.

---

## 3. Ten copies of "load JSON setting → parse → toggle field → stringify → save" boilerplate

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/settings/sub_notifications/components/NotificationSettings.tsx:85-125` (canonical example), with the same shape repeated in `useByomSettings.ts`, `useDataPortability.ts`, `EngineSettings`, `ConfigResolutionPanel`, etc.
- **Scenario**: NotificationSettings hand-rolls: `useAppSetting(KEY, JSON.stringify(DEFAULTS), validatorFn)`, a `useRef` to skip first-load auto-save, a 300 ms debounce timer, a try/catch JSON parse that falls back to defaults, a `prefsRef` to dodge stale-closure races, and a `JSON.stringify(next)` in `toggle`. The exact same pattern appears in the deleted-but-still-extant root-file twin (without the race fix) and in subtly different forms across BYOM and other panels.
- **Root cause**: `useAppSetting` is a string-only hook. Every JSON-shaped setting reinvents the (parse|stringify|validate|debounce|race-guard) layer on top.
- **Impact**: Each new persisted preference (digest interval, severity prefs, ambient policy, BYOM policy) re-derives the race-fix and debounce. Bugs from the version *without* the prefsRef fix have already shipped (the dead duplicate file proves the pre-fix shape existed for a while). Type drift between the in-memory shape and stored string is invisible — the validator is `typeof p === 'object' && p !== null`, which would happily accept `{}` for a `NotificationPrefs` and silently fall back via `{ ...DEFAULTS, ...parsed }`.
- **Fix sketch**: Add a typed `useJsonAppSetting<T>(key, defaults, schema)` wrapper that internally uses `useAppSetting`, takes a Zod (or hand-rolled type guard) schema, debounces saves, and returns `[value, setValue, status]`. Migrate the 4–5 JSON callers. Leaves the simple-string `useAppSetting` for one-off booleans/strings.

---

## 4. Zero tests anywhere under `src/features/settings/`

- **Severity**: High
- **Category**: testing
- **File**: `src/features/settings/**/*` (no `.test.tsx`, no `.spec.tsx`)
- **Scenario**: Settings is the surface where unsaved-changes guards, debounced auto-save, race-fixed toggles, JSON validators, dirty-tracking via `policyEqual` shallow-compare, and IPC error fallbacks all live — the failure modes are subtle (lose a click, double-save, drop a field, fall back to defaults silently). And there are zero tests. The custom `policyEqual` in `useByomSettings.ts:25` even iterates routing/compliance rule arrays by index — a perfect candidate for a 6-line property test that doesn't exist.
- **Root cause**: No house pattern for testing settings — no fixture, no IPC mock, no convention.
- **Impact**: Every settings PR that touches persistence is reviewed by hand. Race fixes (like the `prefsRef` one in NotificationSettings) ride in without regression coverage; the next refactor will likely re-introduce the bug because nothing fails when it does.
- **Fix sketch**: Add one Vitest file per persisted-state hook: `useByomSettings.test.ts`, `useAppSetting.test.ts`, `useDataPortability.test.ts`. Mock `@/api/system/byom` + `@/api/system/settings` with a tiny in-memory store. Cover: dirty-tracking, save-coalesce on rapid toggles, JSON-corruption fallback, default-only path. Pattern is small (~40 lines per test) — write one, copy.

---

## 5. `OperationRow.tsx` ships hardcoded English strings inside `title=` tooltips

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/settings/sub_engine/components/OperationRow.tsx:49,63`
- **Scenario**: 20 of 21 settings components import `useTranslation`. `OperationRow.tsx` does not — it bakes English strings directly into `title` attributes: `` `${label} is not supported by ${p.shortLabel} -- failed integration tests` ``, `` `${enabled ? 'Disable' : 'Enable'} ${label} for ${p.shortLabel}` ``. The wider `EngineSettings.tsx` parent localizes everything around it, so an Arabic or Japanese user gets translated table headers and English tooltips on the same screen.
- **Root cause**: When OperationRow was extracted from EngineSettings, the i18n wiring was not carried with it.
- **Impact**: Visible bug for non-EN users; also a silent precedent — future devs copying this row component will inherit the same shortcut. Every locale audit has to re-find this.
- **Fix sketch**: Pass `t.settings.engine` slice as a prop, or import `useTranslation` directly. Add an ESLint rule (or a CI grep) that flags string literals containing English words inside `title=`, `aria-label=`, and `placeholder=` props in `src/features/settings/`.

---

## 6. `SettingsPage` lazy-tab map is the only registry; adding a tab is a 4-touchpoint task

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/settings/components/SettingsPage.tsx:8-19`
- **Scenario**: To add a new settings tab a dev must edit: (1) the `SettingsTab` union in `@/lib/types/types`, (2) `tabComponents` here, (3) the global i18n locale files (`t.settings.<new>.title/subtitle/...`) in 14 places, (4) sidebar menu wiring outside this folder. Five of the existing 10 sub-folders also expose a one-line `index.ts` barrel (e.g. `sub_byom/index.ts`) — but only 5/10. The other 5 don't, and `SettingsPage` reaches directly into `components/` paths anyway, so the barrel isn't load-bearing.
- **Root cause**: No central manifest. The lazy `tabComponents` record is the closest thing, but it doesn't carry icons, labels, sidebar order, or feature flags — those are scattered.
- **Impact**: Adding a settings tab takes 30+ minutes for a one-screen feature; half of that is finding the four edits. The inconsistent `index.ts` (5/10) is its own paper cut — `grep`s land on the barrel sometimes and the source other times.
- **Fix sketch**: Create `src/features/settings/registry.ts` as a single typed array: `{ id: SettingsTab, label, icon, sidebarOrder, lazy: () => Promise<{ default: ComponentType }>, devOnly?: boolean }`. Have `SettingsPage` and the sidebar both consume it. Also: either add the missing 5 `index.ts` barrels or delete the existing 5 — pick one and enforce.

---

## 7. `IDLE_UNMOUNT_MS = 30_000` is undocumented runtime behavior with surprising side-effects

- **Severity**: Medium
- **Category**: documentation
- **File**: `src/features/settings/components/SettingsPage.tsx:22-61`
- **Scenario**: Inactive tabs are unmounted after 30 s of idleness via a 5 s sweep interval. Comment explains *what* but not *why*. Side-effects to a dev: a tab's local state (form drafts, scroll position, expanded rows) is silently destroyed if the user clicks away for 31 s. BYOM uses `useUnsavedGuard` to dodge this for that one tab; other tabs (Account telemetry toggle, Notifications JSON prefs, Engine matrix) just lose their unsaved transient UI state.
- **Root cause**: Memory-pressure optimization landed without a feature-flag note or an opt-out for tabs with form state.
- **Impact**: Reproducing user-reported "I toggled X and it didn't stick" bugs is hard — the tab unmounted and reset before you saw the bug. Not in the team handbook anywhere.
- **Fix sketch**: Add a 4-line block comment at the top of `SettingsPage.tsx` describing the policy + listing which tabs have unsaved guards. Or, better: add an opt-in `keepMounted: true` flag to the registry from finding #6 for tabs with form-draft state.

---

## 8. `useDataPortability` returns 21 fields by destructure; no grouping, props get pass-through-drilled

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/settings/sub_portability/libs/useDataPortability.ts:195-222`, consumed by `DataPortabilitySettings.tsx:63-89`
- **Scenario**: The hook returns a flat object with 21 keys — `exportStatus`, `importStatus`, `credExportStatus`, `credImportStatus`, three `*Result` fields, six `*Passphrase`/`show*Input` paired pieces, four handlers, etc. `DataPortabilitySettings` then prop-drills 11 of these straight into `<CredentialPortability ...>`. There's no semantic grouping (`credExport`, `credImport`, `dataExport`, `dataImport`).
- **Root cause**: Hook grew incrementally — every new feature added a state pair without grouping.
- **Impact**: Adding a new field means choosing among 21 spots; reviewing a diff is hard; `<CredentialPortability>`'s prop list is its own debugging puzzle. Renaming or refactoring requires touching three files for one logical change.
- **Fix sketch**: Group return into `{ stats, dataExport, dataImport, credExport: {status, passphrase, ...}, credImport: {...}, errors }`. Pass the grouped sub-objects as single props (`<CredentialPortability cred={dp.credentials} />`). Cuts the prop drill ~75%.

---

## 9. `byomHelpers.ts:23` says it "mirrors `byom.rs`" — duplicated validation with no drift detection

- **Severity**: Medium
- **Category**: documentation / convention-drift
- **File**: `src/features/settings/sub_byom/libs/byomHelpers.ts:23-109`
- **Scenario**: The client-side `validateByomPolicy` reproduces the Rust `ByomPolicy::validate()` for instant feedback. The comment is honest about it. But: nothing checks that the two stay aligned. If the Rust side adds a new constraint (e.g. "compliance rule with empty workflow_tags is an error") the TS side won't surface it client-side, and the user only finds out when the IPC save fails with a vague backend message.
- **Root cause**: Common cross-language duplication problem. No bindgen for the validation logic.
- **Impact**: Backend rule additions silently regress client UX. Audit (now) requires reading both files in lockstep.
- **Fix sketch**: Either (a) add a "validation rules" enum/array generated via `ts-rs` like the existing `QualityGateConfig` bindings, and assert the TS rules cover all cases, or (b) downgrade the client to a thin "pre-flight" validator and route serious validation through an IPC `validate_byom_policy` call (debounced). Document chosen approach at the top of `byomHelpers.ts`.

---

## 10. Five copies of "confirm-twice button with 3 s timeout" pattern, each hand-rolled

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/settings/sub_admin/components/AdminSettings.tsx:38,222`, `sub_quality_gates/components/QualityGateSettings.tsx:99` (and similar in BYOM reset)
- **Scenario**: Each "Reset" / "Clear" button uses a local `confirmFoo` boolean + `setTimeout(..., 3000)` to require a second click within 3 s. Pattern is duplicated at least 5 times with subtle variation (icon swap, color, message). The double-click-to-confirm logic is identical.
- **Root cause**: No shared `<ConfirmAction>` or `useConfirmDoubleClick()` primitive.
- **Impact**: Inconsistent UX across panels (timing windows can drift); copy-paste bugs (the timeout id is never cancelled on unmount in any of the copies, so unmounting during the 3 s window leaves a leak — minor but real).
- **Fix sketch**: Add `useDoubleConfirm({ windowMs: 3000 })` returning `{ armed, arm, fire }`. Wrap in a `<ConfirmButton>` shared component. Migrate the 5 sites; deletes ~30 lines.

---

## 11. `i18n/en.ts` has a `// TODO(i18n-XX) marker should be grep-able` comment, but no markers exist

- **Severity**: Low
- **Category**: documentation
- **File**: `src/features/settings/i18n/en.ts:6`
- **Scenario**: Doc comment promises that untranslated strings get a `TODO(i18n-XX)` marker and points to `.claude/CLAUDE.md`. A grep for `TODO(i18n` across `src/features/settings/i18n/` returns zero hits. Either every string is translated (great) or the convention was never adopted (more likely, given finding #2 — most of the actual settings translation tree lives in the global locale files).
- **Root cause**: Documentation written aspirationally and never reconciled.
- **Impact**: Devs trust the comment, miss real untranslated strings. Low because the surface is small.
- **Fix sketch**: Either delete the misleading paragraph or add a real CI grep for `TODO(i18n-` in locale files. Alignment fix once #2 is resolved.
