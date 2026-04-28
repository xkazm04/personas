# Dev Experience Fix Wave 1 — Dead trees & duplicates

> 4 atomic deletion commits + 3 deferred follow-ups · 5 of 9 critical findings closed in this theme.
> Baseline preserved: tsc 0 → 0 errors. Vitest baseline was already broken at scan time (pre-existing plugin failure) — no regression check available.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---:|
| 1 | `86129c7a` chore(agents): delete sub_tools orphan shims | `agent-tools-connectors.md` #1 | Critical | -2 (-423 LOC) |
| 2 | `a7caccec` chore(agents): delete sub_settings + sub_model_config/credentials zombie duplicates | `agent-editor-config.md` #1, #2 | Critical + High | -6 (-558 LOC) |
| 3 | `76239fd2`† chore(settings): delete root-level <Foo>Settings.tsx zombie panels | `settings.md` #1 | Critical | -3 (-366 LOC) |
| 4 | `4bb9c36f` chore(settings): delete dead useSettingsTranslation hook + 14 locale files | `settings.md` #2 | Critical | -15 (~-200 LOC) |
| 5 | `24cbfcac`† onboarding/i18n deletion (partial W1.6) | `onboarding-home.md` #1 (partial) | Critical (partial) | -15 (~-360 LOC) |
| 6 | `5e05476a` docs(harness): record W1.2 + W1.6 deferred follow-ups | (deferral docs) | n/a | +1 |
| 7 | `90370a3f` docs(harness): W1.7 Overview Dashboard dead-tree consolidation deferred | (deferral docs) | n/a | +1 |

† Commits 3 and 5 were bundled by a concurrent post-commit hook in this repo that was sweeping unstaged changes into "snapshot" commits during the session. The dev-experience deletions are present in those commits, but the commit messages don't carry the explicit finding refs. Recorded here for traceability.

## What was fixed (grouped by sub-pattern)

### Pattern: orphan-shim — old refactored-out file kept alongside live successor

1. **sub_tools shims (W1.1)** — The April 2026 refactor split `useToolSelectorState` into three focused libs hooks (`useToolSelectorPersona`, `useToolSelectorSearch`, `useToolSelectorActions`) and added a typed `useToolImpactData`; the original 219+204 LOC top-level files were never deleted. Worse, the orphan `useToolImpactData` had a different (double-counting) co-occurrence algorithm vs. the live `i<j` pairs version — a future drift bug the deletion eliminates. ToolSelector.tsx imports only from `libs/`, so the orphans had zero callers.

2. **sub_settings + sub_model_config/credentials zombies (W1.3)** — Same pattern, two flavors. `sub_settings/PersonaSettingsTab.tsx` (root) was shadowed by `sub_settings/components/PersonaSettingsTab.tsx` (live, exported by the barrel); the dead one even still rendered `<TwinBindingCard />` and an irreversible-warning row that had been deliberately removed from the live version. `sub_model_config/credentials/{SaveConfigButton, ProviderCredentialField, OllamaApiKeyField, LiteLLMConfigField}.tsx` were exact-twin shadows of `sub_model_config/components/<Same>.tsx` files.

### Pattern: stale-panel-at-root — `sub_*/<Name>.tsx` not yet migrated to `sub_*/components/<Name>.tsx`

3. **Settings root panel duplicates (W1.4)** — `sub_account/AccountSettings.tsx`, `sub_admin/AdminSettings.tsx`, `sub_notifications/NotificationSettings.tsx` were dead siblings of their `components/<Same>.tsx` versions. The live versions had accumulated real fixes (NotificationSettings had a `prefsRef`-guarded stale-closure fix + 300ms debounced save that the dead one lacked; AdminSettings had a User Consent section the dead one lacked). Anyone editing the dead file would have silently lost those fixes.

### Pattern: dead-i18n-tree — feature-scoped translation hook authored but never adopted

4. **`useSettingsTranslation` + 14 locale files (W1.5)** — The hook was declared with proper namespacing ("Mirrors the project pattern") and 14 locale stubs but never wired up anywhere. All 27 settings panels reach back into `@/i18n/useTranslation` and dig through `t.settings.byom`, `t.settings.account`, etc. The local `en.ts` only stubbed a tiny scoped surface (`byom`, `qualityGates`, `configResolution`, `ambientContext`) that never displaced the global tree — a stub of a stub.

5. **Onboarding feature-scoped i18n (W1.6 partial)** — Same pattern: `useOnboardingTranslation` was authored but never used. Fully deleted (15 files: hook + 14 locales). Home's parallel `useHomeTranslation` was deferred — it has 2 actual consumers (`HomeWelcome.tsx`, `FleetHealthStrip.tsx`), and `FleetHealthStrip` uses `t.fleet.*` keys that don't exist in the global locale yet, so a clean migration needs a multi-locale port first.

## Verification table (before / after counters)

| Metric | Before Wave 1 | After Wave 1 | Delta |
|---|---:|---:|---:|
| tsc errors (`npx tsc --noEmit`) | 0 | 0 | — |
| Source files deleted | — | 41 | -41 |
| Source LOC removed (approx) | — | ~1,900 | -1,900 |
| Critical findings closed (Theme A) | 0/9 | 5/9 | +5 |
| Theme A criticals deferred | 0 | 4 | (W1.2, W1.6 home portion, W1.7) |

## Cumulative status (across waves so far)

This is the first fix wave on the 2026-04-27 dev-experience scan.

| Wave | Theme | Closed | Deferred |
|---|---|---:|---:|
| 1 | Dead trees & duplicates | 5 (of 9 in theme) | 4 (need own waves) |

**Overall scan progress:** 5 of 17 critical findings closed. 12 critical findings remain (4 deferred from Wave 1 to dedicated waves; 8 in other themes).

## Patterns established (additions to the catalogue, items 1–4)

1. **Verify before delete via barrel + grep.** For each "dead duplicate" finding, the verification recipe is: (a) read the parent `index.ts` to confirm which path is re-exported as the public API; (b) `grep` for both filenames across `src/` to find direct deep-imports that bypass the barrel; (c) only delete files referenced solely by themselves or by other dead-tree members. This caught W1.2 (sub_executions) where the "dead" tree had live external consumers — the audit framing was wrong, the verification recipe was right.

2. **Don't merge features back from the dead copy unless the live one is an obvious regression.** The `sub_settings/PersonaSettingsTab.tsx` zombie still rendered `<TwinBindingCard />`, but the live tab deliberately omits it — that's a product decision, not a regression to "fix." When the live and dead diverge, the safer default is delete-the-dead and surface any lost feature as a follow-up question, not silently re-merge.

3. **Multi-locale i18n migrations need their own wave.** The onboarding/i18n deletion was clean (zero consumers); the home/i18n deletion was not (2 consumers + missing `fleet.*` keys in 14 global locale files). The audit's fix sketch claimed "keys already exist globally" — true for HomeWelcome, false for FleetHealthStrip. Always verify the exact keys against `src/i18n/locales/en.json` before deleting a feature-scoped i18n tree.

4. **Concurrent post-commit hooks can sweep your unstaged-but-just-deleted files into snapshot commits.** During this wave a parallel process bundled W1.4 deletions into a "snapshot concurrent WIP" commit (`76239fd2`) and W1.6 onboarding deletions into another (`24cbfcac`). The deletions are present and verifiable; only the commit-message attribution is lost. To preserve attribution in future waves, either (a) fully stage + commit before the hook fires, (b) coordinate with the hook owner to suppress sweeps during the dev-experience session, or (c) accept the bundling and record the actual commit hash in the wave summary like this doc does.

## What remains

- **W1.2** — `sub_executions` duplicate trees consolidation. 5–10 commit pairwise migration. See `docs/harness/followups-2026-04-28.md`.
- **W1.6 home portion** — `home/i18n` migration. Multi-locale port + 2 component migrations + lint rule. See `docs/harness/followups-2026-04-28.md`.
- **W1.7** — Overview dashboard dead-tree consolidation. Knip-driven dead-code pass with per-cluster commits. See `docs/harness/followups-2026-04-28.md`.
- **Other Wave 1 sub-themes** (3 replay viewers' shared shortcut hook from `agent-chat-tool-runner.md` #2; 5 stat-tile re-impls from `overview-dashboard.md` #2) → these are duplication-with-drift but are *primitive extraction*, not deletion. Folded into Wave 4 instead of further deferring W1.

Wave 4 (shared primitives) and Wave 5 (race-condition consolidation) are next per the user's selection.
