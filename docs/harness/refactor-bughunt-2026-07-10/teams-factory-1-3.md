> Context: teams/factory [1/3]
> Total: 8
> Critical: 0  High: 0  Medium: 5  Low: 3

## 1. Relative-time labels parse UTC timestamps as local time
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case (clock/timezone)
- **File**: src/features/teams/sub_factory/factoryData.tsx:40-49 (`rel`), 73 (`ms`)
- **Scenario**: dev_tools stores datetimes without a timezone suffix (SQLite `CURRENT_TIMESTAMP` is UTC, e.g. `"2026-07-10 12:00:00"`). `rel()` does `new Date(iso.replace(' ', 'T')).getTime()` — with no `Z`, JS interprets the string as *local* time, then subtracts `Date.now()` (a true UTC epoch). For a user at UTC+2 a measurement taken "now" renders as "120m ago" (or a future value clamped to "0m ago").
- **Root cause**: assuming a bare `YYYY-MM-DD HH:MM:SS` string is local when the DB writes it in UTC; the offset only cancels for the same-format *comparison* in `skipFresh` (both sides shifted equally), so that path is fine — but the absolute `Date.now() - t` subtraction in `rel()` is not.
- **Impact**: UX — every "last measured Xh ago" label on the KPI console/matrix is skewed by the local UTC offset.
- **Fix sketch**: normalize to UTC before parsing: append `'Z'` when the string has no offset (`iso.replace(' ', 'T') + (/[Z+]/.test(iso) ? '' : 'Z')`), or parse the components explicitly with `Date.UTC(...)`.

## 2. DeployPopover re-derives every project's passport twice per render
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: performance
- **File**: src/features/teams/sub_factory/passport/improve/DeployPopover.tsx:93-97, 175-179
- **Scenario**: In the actions `.map`, both the guard `eligibleForBatch(a).length > 1` (line 175) and the button label `Queue for all {eligibleForBatch(a).length}` (line 177) call `eligibleForBatch(a)` — and each call runs `engine.allRaw().map(r => derivePassportFromMetadata(r.meta, r.project, …))` over the WHOLE fleet, then filters. So for N projects and A applicable task actions, every popover render performs 2·A full-fleet passport derivations (each derivation parses standards, runs vendor regexes, computes both score blocks).
- **Root cause**: an expensive fleet-wide derivation invoked inline in JSX instead of memoized once.
- **Impact**: performance — visible jank opening the Deploy popover on a large fleet; work scales with projects × actions × renders.
- **Fix sketch**: compute `const batchByAction = useMemo(() => new Map(actions.map(a => [a.id, eligibleForBatch(a)])), [actions, ...])` once and read `.length` / the list from it.

## 3. KPI proposals scan polling has no unmount guard
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure (leak)
- **File**: src/features/teams/sub_factory/KpiProposalsPanel.tsx:48-82
- **Scenario**: `scan()` loops up to 40× with `await sleep(3000)` (~120s), calling `refetch()` (→ `setProposals`) each pass and `setScanning(false)` in `finally`. Unlike the mount effect (which uses an `alive` flag), this loop has no cancellation. If the user closes/navigates away from the Factory while a scan is running, the loop keeps polling the backend for up to two minutes and calls `setState` on an unmounted component every 3s.
- **Root cause**: the long-lived async loop isn't tied to component lifetime; only the initial fetch effect guards against unmount.
- **Impact**: UX/resource — wasted polling + React "set state on unmounted" churn; a fast close→reopen can also stack overlapping scan loops.
- **Fix sketch**: track a `useRef(true)` mounted flag (cleared in an effect cleanup), bail the loop / skip `setState` when unmounted; ideally also guard against a second `scan()` while one is in flight beyond the `scanning` disable.

## 4. Dead exports in passportRows.ts (ALL_ROWS, cellSortValue, integrationKindCounts)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/teams/sub_factory/passport/passportRows.ts:135-158
- **Scenario**: `ALL_ROWS`, `cellSortValue`, and `integrationKindCounts` are only referenced at their own definitions (grepped across `src/` — zero other hits). Their doc comments tie them to "variant A's table body" / the Wall's "visa summary" — but the Grid variant and heat-grid were consolidated out (per the ProjectsPassportWall/ProjectsLayer headers); only the Wall remains, which consumes `SECTIONS` directly.
- **Root cause**: leftovers from the deleted Grid matrix variant.
- **Impact**: maintainability — ~25 lines of unused surface that imply a second consumer that no longer exists.
- **Fix sketch**: delete the three exports (and the now-unused `INTEGRATION_KIND_LABEL` import if nothing else uses it) after a final grep.

## 5. HealthBar widget is unused
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/teams/sub_factory/factoryPrimitives.tsx:47-55
- **Scenario**: `HealthBar` has no callers anywhere in `src/` (the only other `HealthBar` grep hits are a distinct `CompositeHealthBar` under sub_health). Sibling primitives in this file (Sparkline, StatusDot, CalibrationTrack, StatusPill, ThresholdSlider, AssessmentEditor, TrafficTally, KpiBarRating, RatingStars, Breadcrumb) are all still imported; HealthBar alone is orphaned.
- **Root cause**: a leaf widget kept "for a variant to graft back" that no surviving variant uses.
- **Impact**: maintainability — small, but it's genuinely dead.
- **Fix sketch**: remove `HealthBar` (keep the file's other primitives, which are live).

## 6. Two divergent Sparkline implementations with the same name
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/teams/sub_factory/factoryPrimitives.tsx:9-36 and src/features/teams/sub_factory/passport/passportWidgets.tsx:142-159
- **Scenario**: Both files export a component named `Sparkline` with near-identical polyline math but different prop shapes (`{ series, color, width, height }` vs `{ values, width, height, color }`) and different empty-state renders (a "—" span vs `null`). Callers must know which module a given `Sparkline` came from; the two are easy to confuse when editing.
- **Root cause**: the passport widgets grew their own copy instead of reusing the factory primitive.
- **Impact**: maintainability — parallel implementations drift; a fix to one silently misses the other.
- **Fix sketch**: unify into one `Sparkline` (accept `values`/`series` alias or normalize at the two call sites) and import it from a single module.

## 7. Duplicated measure_config describers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/teams/sub_factory/KpiProposalsPanel.tsx:24-35 (`describeProcedure`) and src/features/teams/sub_factory/KpiConsole.tsx:29-42 (`describeMethodic`)
- **Scenario**: Both functions `JSON.parse` a `measure_config` string and branch on the same keys (`cmd`, `metric`, `connector`, `instruction`, plus `parse`/`recipe`) to produce a human one-liner, with the same try/catch fallthrough. They diverge only in wording and default text.
- **Root cause**: the console and proposals panel each hand-rolled the same config-summary helper.
- **Impact**: maintainability — a new measure kind (or a JSON shape change) must be updated in two places or the two surfaces disagree.
- **Fix sketch**: extract one `describeMeasureConfig(cfg, opts?)` (e.g. into factoryModel or composeTask) and call it from both.

## 8. Redundant identity map in integrationChips
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/teams/sub_factory/passport/passportRows.ts:65-68
- **Scenario**: `integrationChips` returns `p.stack.integrations.map((i) => \`${i.name}\`)` — a template literal that just re-wraps an already-string `name`; the "grouped sentence-style by kind" comment describes behavior the code doesn't do.
- **Root cause**: an earlier richer label was simplified but the wrapper + stale comment stayed.
- **Impact**: maintainability — misleading comment; needless indirection.
- **Fix sketch**: inline as `items: p.stack.integrations.map((i) => i.name)` in the row spec and drop the helper + comment (or make it actually group by kind if that was intended).
