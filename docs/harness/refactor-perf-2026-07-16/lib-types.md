# lib/types — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 3 medium / 0 low)
> Context group: Core Libraries & State | Files read: 11 | Missing: 0

## 1. teamConfigTypes.ts is an entirely unused module
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/types/teamConfigTypes.ts:1
- **Scenario**: A repo-wide grep for `parseTeamConfig`, `parseCanvasLayout`, `serializeTeamConfig`, `serializeCanvasLayout`, `TeamConfigNode`, `CanvasLayout`, and the import path `@/lib/types/teamConfigTypes` finds zero matches outside the file itself — no component, hook, store, or test imports anything from it.
- **Root cause**: The typed-JSON-boundary layer for `PersonaTeam.team_config` / `canvas_data` was authored ahead of (or survived past) the consuming feature; callers either never materialized or now parse those columns elsewhere.
- **Impact**: 77 lines of dead exported API that advertises a contract ("consumers don't need to parse-and-hope") nobody honors. Future contributors may extend it believing it is the live seam for team canvas persistence, diverging from whatever the teams feature actually does.
- **Fix sketch**: Confirm with a final search over `src-tauri` and any script/e2e directories (TS-only exports make dynamic use implausible), then delete the file. If the teams canvas does parse `team_config`/`canvas_data` ad hoc somewhere, instead wire those call sites through this module and keep it — but one of the two must happen.

## 2. schedule.ts canonical helpers are test-only; the composer re-declares its own Rhythm type
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/types/schedule.ts:36
- **Scenario**: `toSchedule()` and `frequencyToSchedule()` (plus `FrequencyInputs`) are exercised only by `src/lib/types/__tests__/schedule.test.ts`; the sole production import of this module is `import type { Schedule }` in `src/lib/utils/platform/triggerConstants.ts`. Meanwhile the Glyph composer — the exact surface the module's ADR comment says it unifies — declares its own duplicate `export type Rhythm = "once" | "daily" | "weekly" | "monthly"` in `ComposerScheduleRhythmCard.tsx:1` and builds cron strings through its own path.
- **Root cause**: The 2026-05-01 canonical-schedule ADR shipped the primitive and tests, but the three drifting surfaces it was meant to consolidate were never migrated onto `frequencyToSchedule`/`toSchedule`.
- **Impact**: The consolidation the module exists for hasn't happened, so the drift cost it documents (a timezone field added in 3+ places) is still live; tests green-light runtime code with zero production callers, giving false coverage confidence.
- **Fix sketch**: Either finish the adoption — have the composer import `Rhythm`/`frequencyToSchedule` from `@/lib/types/schedule` (deleting the duplicate union in ComposerScheduleRhythmCard) and route the schedules calendar through `toSchedule(agent)` — or, if the ADR is abandoned, strip the module down to the `Schedule` interface and delete the unused converters and their tests.

## 3. Phase C2 question-scope helpers in designTypes.ts have no callers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/types/designTypes.ts:196
- **Scenario**: `inferQuestionScope()` (line 196) and `questionCapabilityId()` (line 205) appear nowhere in the repo outside their own definitions — the adoption questionnaire grid their doc comments describe ("used by the grid to nest the question under the correct capability section") never imports them.
- **Root cause**: The C2 capability-aware questionnaire either implemented its grouping logic locally in the adoption feature or the grouped-UI rendering path was cut, leaving the shared helpers orphaned.
- **Impact**: Two exported functions encode non-trivial precedence rules (explicit scope → connector_names → single use_case_ids → persona) that will silently diverge from whatever logic the adoption UI actually runs, misleading anyone who reads this file as the source of truth for v1-template back-compat.
- **Fix sketch**: Grep the adoption/questionnaire feature (src/features/templates, sub_recipes, adoption grid components) for hand-rolled scope-grouping logic; if found, replace it with calls to these helpers. If the grouped UI derives scope differently or not at all, delete both functions and the `AdoptionQuestionScope` narrative comments referencing them.

_perf-optimizer lens: no findings. This context is almost entirely type declarations; the few runtime helpers (`enrichWithPersona` uses a Map lookup, `parseConnectorDefinition`/`toCredentialMetadata` parse small JSON blobs once per record, `resolveTimeRange` is O(1)) have no scaling, re-render, or resource-lifetime characteristics worth reporting._
