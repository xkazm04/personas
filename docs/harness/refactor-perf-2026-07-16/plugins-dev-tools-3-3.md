# plugins/dev-tools [3/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 1 high / 2 medium / 0 low)
> Context group: Plugins & Companion | Files read: 13 | Missing: 0

## 1. Two competing parsers for the same persisted `standards_config` field, with divergent defaults
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/dev-tools/sub_projects/pipeline/standardsConfig.ts:26
- **Scenario**: `standardsConfig.ts` (`parseStandards`/`serializeStandards`) and `src/features/teams/sub_factory/passport/improve/standards.ts` (same function names, near-identical shape) both parse/serialize `dev_projects.standards_config`. The teams module's header even claims to be the "Single source of truth for parsing the shape", while the dev-tools module's header claims "this module owns the shape". For a project with NO stored config, the pipeline module defaults `precommit` to all-true and `pr_base` to `'main'`, while the passport module defaults everything to false/null.
- **Root cause**: The passport "improve" engine and the dev-tools pipeline stepper were built independently against the same opaque JSON column; each grew its own parse/serialize/defaulting layer.
- **Impact**: The same project row renders as "lint/docs/code-quality enabled, PR base main" in the dev-tools Overview/ProjectModal but as "nothing enabled / not golden" in the team passport. Any future field added to the shape must now be added in two places or the surfaces silently diverge further; `serializeStandards` from either side round-trips through the other's differently-typed `pr_base` (`BranchSel` vs `string | null`).
- **Fix sketch**: Pick one module as the actual owner (the pipeline one has the stricter `BranchSel` typing) and re-export from a shared location, e.g. `src/lib/standards/standardsConfig.ts`. Reconcile the default policy explicitly (empty config = all-false is the safer read; the pipeline UI can apply `defaultStandards()` only when the user opens the editor for a project with no config). Migrate `passportDerive.ts`, `provenance.ts`, and `ImprovePopover.tsx` to the shared parser and keep the action-catalog logic in the passport module.

## 2. `constants/ideaCategories.ts` is a dead module — zero importers repo-wide
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/plugins/dev-tools/constants/ideaCategories.ts:19
- **Scenario**: The file is a self-described deprecation shim ("kept as a typed export so external references degrade gracefully"), but a repo-wide grep finds no importer of `toCanonicalIdeaCategory` or `LEGACY_IDEA_CATEGORY_MAP` — the only mentions are the file itself, `context-map.json`, a stale docs tree listing, and lint output. The Rust-side `IdeaCategory::from_token` already owns the legacy mapping, and the DB migration `reconcile_idea_category_vocabulary` already remapped stored rows.
- **Root cause**: The shim was kept "just in case" during the vocabulary migration; all callers have since moved to `AGENT_CATEGORIES`/the Rust enum, so its stated justification no longer holds.
- **Impact**: Dead file that ships in the bundle graph if ever re-imported, and — worse — an attractive-looking API that would reintroduce the retired vocabulary if a future contributor imports it (docs still list it as "technical/user/business/mastermind", misdescribing its contents).
- **Fix sketch**: Delete the file and remove its entry from `context-map.json` and the stale line in `docs/features/plugins/dev tools/dev-tools.md`. No verification beyond the repo grep is needed since the app is a desktop bundle with no external consumers of `src/`.

## 3. `timeUtils.ts` duplicates its own formatting logic, is the third `elapsedStr` in the codebase, and its API footgun already produced a wrong display
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/dev-tools/sub_lifecycle/competitions/timeUtils.ts:2
- **Scenario**: `elapsedStr` and `durationStr` contain byte-identical seconds→"Xh Ym"/"Xm Ys" formatting; a third, differently-signed `elapsedStr(startedAt, now)` lives in `src/features/fleet/monitor/monitorModel.ts:345`. The near-identical names already bit a caller: `RacingProgress.tsx:129` renders the COMPLETED-task branch with `elapsedStr(new Date(task.started_at).getTime())` instead of `durationStr(task.started_at, task.completed_at)`, so a finished slot's "time" keeps growing on every poll-driven re-render instead of freezing at the actual duration (`CompetitionSlotRow.tsx:184` uses the correct one).
- **Root cause**: Formatting was inlined twice instead of extracted, and the competitions module re-implemented a helper that already existed in the fleet monitor with a different (better, tick-friendly) signature.
- **Impact**: A user watching a completed competition sees a duration that ticks upward forever — misleading data on a surface whose whole point is comparing slot times. Three drifting implementations of the same concept is a standing maintenance hazard.
- **Fix sketch**: Extract `formatSeconds(s: number): string` and express both functions through it (2 lines each); fix `RacingProgress.tsx:129` to call `durationStr(task.started_at, task.completed_at)` in the `isDone` branch. Optionally converge on the monitorModel signature (`elapsedStr(startMs, nowMs)`) so callers control the tick source, then delete the competitions copy.
