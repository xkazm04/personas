# triggers/triggers [3/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 1 medium / 2 low)
> Context group: Execution & Orchestration | Files read: 4 | Missing: 0

## 1. Dead `HEALTH_STYLES` export in triggerListTypes.ts (superseded by StatusShape)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/triggers/sub_triggers/triggerListTypes.ts:3
- **Scenario**: `HEALTH_STYLES` (lines 3-8) has zero importers anywhere in `src/` — `HealthDot.tsx` was migrated to `StatusShape`/`mapToShapeStatus` and carries its own `HEALTH_ANIMATION` map with the same `health-pulse` animation strings. (The `HEALTH_STYLES` hits in `features/agents/allPersonas/` are a different, unrelated constant defined in `PersonaOverviewBadges.tsx`.)
- **Root cause**: The StatusShape migration replaced the raw dot styling but left the old style map behind, and the animation fragments were re-copied into `HealthDot.tsx` instead of being derived from one source.
- **Impact**: Dead export that still looks authoritative — the next person editing trigger-health visuals may edit it and see no change; the pulse timings (2s / 1.5s) now exist in two places with only one live.
- **Fix sketch**: Delete `HEALTH_STYLES` from triggerListTypes.ts. If keeping the timings centralized is desired, move `HEALTH_ANIMATION` from HealthDot.tsx into triggerListTypes.ts as the single animation source; otherwise leave it local and just remove the dead map. Verified no cross-context importers via repo-wide grep.

## 2. `HEALTH_TITLES` hardcodes English tooltips, bypassing the i18n layer
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: i18n-consistency
- **File**: src/features/triggers/sub_triggers/triggerListTypes.ts:10
- **Scenario**: Every other user-facing string in this context goes through `useTranslation()` (TriggerModeBadge, TriggerFieldGroup), but the health-dot `title` tooltips ("Healthy -- last 3 runs succeeded", etc.) are raw English constants rendered via HealthDot.tsx:16.
- **Root cause**: Tooltip copy was defined as module constants alongside style maps instead of being added to the translation catalog.
- **Impact**: Non-English locales show English tooltips on trigger health; also a `--` typo-ish separator that a copy pass through the catalog would normalize.
- **Fix sketch**: Add `t.triggers.health.{healthy,degraded,failing,unknown}` keys to the catalog, replace `HEALTH_TITLES` lookups in HealthDot.tsx with a translated map built inside the component (it already can call `useTranslation` — TriggerModeBadge does), and delete the constant.

## 3. RING_* countdown-ring constants/geometry duplicated with vault's RotationCountdownRing
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/triggers/sub_triggers/triggerListTypes.ts:28
- **Scenario**: `RING_SIZE=36`, `RING_STROKE`, `RING_RADIUS=(SIZE-STROKE)/2`, `RING_CIRCUMFERENCE=2πr` and the dashoffset formula feeding RadialCountdownRing.tsx are re-implemented verbatim (same size 36, same derivations) as private constants in src/features/vault/sub_credentials/components/features/RotationCountdownRing.tsx:3-6, with a third stroke-only variant in OAuthProgressRing.tsx.
- **Root cause**: Each feature grew its own SVG countdown ring; the shared geometry was never extracted.
- **Impact**: Bounded maintenance drift — a sizing/stroke change to the "countdown ring" visual must be found and repeated in 2-3 places; also `triggerListTypes.ts` is a types file that has accrued style maps and SVG geometry, diluting its purpose.
- **Fix sketch**: Extract a small `shared/components/display/CountdownRing` (or a `ringGeometry(size, stroke)` helper) consumed by both RadialCountdownRing and RotationCountdownRing, and move `TRIGGER_RING_COLORS` + RING_* out of triggerListTypes.ts into the ring component file so the types module holds only types. Cross-context change — verify vault callers before consolidating.
