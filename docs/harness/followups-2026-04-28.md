# Follow-ups — 2026-04-28

## W1.2 deferred — sub_executions duplicate trees migration

**Why deferred from Wave 1:** The audit finding (`agent-chat-tool-runner.md` #1) framed this as a cleanup-by-deletion. Investigation showed it's actually a multi-step migration: the old `sub_executions/detail/` tree has live external consumers in three different feature trees:

- `features/execution/components/ExecutionMiniPlayer.tsx:27` → `detail/views/ExecutionSummaryCard`
- `features/shared/components/modals/ExecutionDetailModal/ExecutionDetailModal.tsx:2` → `detail/ExecutionDetail`
- `features/shared/components/modals/ExecutionDetailModal/ExecutionDetailContent.tsx:9-12` → 4 deep paths in `detail/inspector/` and `detail/views/`

The new `components/list/ExecutionDetail.tsx` is itself a thin re-export of `../detail/DetailSteps` (`components/list/ExecutionDetail.tsx:2`), and the old `detail/ExecutionDetail.tsx` cross-references the old `replay/` tree (`detail/ExecutionDetail.tsx:5-6`).

**What this actually is:** a 5–10 commit pairwise migration that should be its own wave:
1. Identify which files in old vs new are diff'd; merge unique fixes into the canonical copy.
2. Migrate the 7+ external consumer imports to point at the new tree.
3. Delete the loser tree.
4. Add `no-restricted-imports` ESLint rule banning the dead paths.

**Recommended next session:** `gsd-plan` a dedicated "sub_executions tree consolidation" wave, with each pairwise migration as its own atomic commit.

## W1.6 partial — home/i18n migration deferred

**Why partial:** The audit (`onboarding-home.md` #1) recommended deleting both `src/features/onboarding/i18n/` and `src/features/home/i18n/` entirely, claiming "the keys already exist in `src/i18n/locales/en.json` under `home.*`".

That is true for `HomeWelcome.tsx` (uses `t.greeting_morning`, `t.operator`, `t.quick_navigation`, `t.nav` — all present in `home.*` globally), but **not** for `FleetHealthStrip.tsx`, which uses `t.fleet.executions_today`, `t.fleet.success_rate`, `t.fleet.active_agents`, `t.fleet.credentials`. `home.fleet` does **not** exist in the global locale.

**What was done in W1.6:** deleted `src/features/onboarding/i18n/` (zero consumers — `useOnboardingTranslation` was only referenced by itself).

**What's left for a follow-up wave:**
1. Port the `fleet.*` keys from `src/features/home/i18n/en.ts` (and the 13 other locale files) into `src/i18n/locales/{en,zh,ar,...}.json` under `home.fleet.*`.
2. Migrate `HomeWelcome.tsx` and `FleetHealthStrip.tsx` from `useHomeTranslation` to the global `useTranslation` (use `const { t: globalT } = useTranslation(); const t = globalT.home;`).
3. Delete `src/features/home/i18n/` entirely.
4. Add the ESLint `no-restricted-imports` rule banning `@/features/*/i18n/*` to prevent regrowth.

This is roughly a 3–5 commit migration that should be its own session — multi-locale port + 2 component migrations + lint rule.

## Open

(none other)
