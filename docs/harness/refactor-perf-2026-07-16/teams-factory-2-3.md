# teams/factory [2/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. Improve-plan helpers re-derive and re-score every passport per call; fleet projection recomputes on every checkbox toggle
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-compute
- **File**: src/features/teams/sub_factory/passport/improve/improvePlan.ts:50
- **Scenario**: In ImprovePlanPanel, `buildImprovePlan(raws)`, `fleetGoldenAvg(raws)`, and `projectedFleetGolden(raws, selectedItems)` each independently call `passportOf(raw)` → `derivePassportFromMetadata` + `scoreAgainstRubric` for the whole fleet. `projectedFleetGolden` is memoized on `[raws, selectedItems]`, so every plan-item checkbox toggle re-derives and re-scores every project's passport from raw scan metadata even though the per-project base `goldenPct` is selection-independent.
- **Root cause**: The derive/score pipeline is repeated in three entry points instead of computed once per `raws` and shared; `buildImprovePlan` even stores the derived passport on each `PlanItem` (`passport: p`) but the other two helpers don't reuse it. Note `usePassportData` has ALSO already derived a passport for every project — the plan layer derives a fourth time.
- **Impact**: 3× (plus per-toggle) full-fleet passport derivation on an interactive path. Bounded by project count today, but derive+rubric is the heaviest pure computation in this feature and it grows linearly with fleet size × toggle frequency.
- **Fix sketch**: Compute `Map<projectId, { passport, rubric }>` once per `raws` (either exported `scoreFleet(raws)` memoized in the panel, or accept it as a parameter) and have `buildImprovePlan` / `fleetGoldenAvg` / `projectedFleetGolden` take that map. `projectedFleetGolden` then only recomputes the cheap `min(100, base + lift)` sum on toggle. Optionally reuse the passports `usePassportData` already derived instead of re-deriving from `ImproveRaw`.

## 2. `reload()` is billed as the cheap post-config-write path but fans out 2N+1 IPC calls including a filesystem probe per repo
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: over-fetch
- **File**: src/features/teams/sub_factory/passport/usePassportData.ts:38
- **Scenario**: After every Tier-0 standards toggle (`reload()`) and every debounced `factory-process-complete` event, `build(false)` re-runs the FULL pipeline: `listProjects` + `getCrossProjectMetadata` + `listSkillsGlobal` + `listSkills` per project + `probeRepoEvidence` per project. The header comment promises "re-fetch project rows + re-derive from the cached scan", but skills listings and deterministic repo file probes (disk I/O per repository) are re-executed for every project on each reload.
- **Root cause**: `build` has no granularity — the skill-catalog fan-out and evidence probes are inlined into the single code path, so the "cheap" reload pays the same 2N+1 Tauri IPC / filesystem cost as a cold load.
- **Impact**: A config toggle on one project probes every repo on disk and re-lists every project's skills; with a dozen projects that's ~25 IPC round-trips (several hitting the filesystem) for a change that only altered one project row. Latency scales with fleet size and repo size.
- **Fix sketch**: Split `build` into `loadScan(regen)` and a derive step, and cache the skills catalog + `evidenceById` across reloads (refs keyed by project id). `reload()` should refresh only `listProjects()` and re-derive; invalidate a single project's evidence/skills when a deploy completes for that project (`factory-process-complete` detail already carries context), and only do the full fan-out on `rescan`/mount.

## 3. Anchored-popover plumbing duplicated across four sub_factory components
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/teams/sub_factory/passport/WarningBadge.tsx:63
- **Scenario**: `WarningPopover` hand-rolls the full anchored-popover kit — `createPortal` to body, `useLayoutEffect` flip-above/below off `anchor.bottom`/`window.innerHeight`, horizontal clamp, Escape-to-close, deferred `mousedown`-outside listener, `z-[9995]` fixed panel. Its own comment admits it "Mirrors QuickEditPopover's positioning, minus the edit footer", and grep shows the same pattern in DeployPopover.tsx, ImprovePopover.tsx, and StandardsScan.tsx within this feature.
- **Root cause**: Each popover was written by copying the previous one instead of extracting a `useAnchoredPopover(anchor, {width})` hook (or an `<AnchoredPopover>` shell) after the second instance appeared.
- **Impact**: Four+ copies of subtle positioning/dismiss logic that must be fixed in lockstep (the flip heuristic, the setTimeout-0 outside-click guard, z-index). Divergence is already visible in widths and fallback behavior; any bug fix (e.g. scroll-reposition) needs four edits.
- **Fix sketch**: Extract a shared hook in sub_factory (or features/shared): `useAnchoredPopover({ open, anchor, width })` returning `{ panelRef, style }` plus the Escape/outside-click effect, and a thin portal wrapper with the panel chrome. Migrate WarningPopover first (smallest), then the improve popovers. Verify QuickEditPopover (outside this context) can adopt it too.

## 4. passportHistory re-reads and re-parses the entire localStorage map on every call — twice per project card render
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: redundant-parse
- **File**: src/features/teams/sub_factory/passport/passportHistory.ts:26
- **Scenario**: `ReadinessTrend` (rendered per project on the Wall) calls `getHistory(slug)` and `trendDelta(slug)`; `trendDelta` calls `getHistory` again, and each `getHistory` does a full `localStorage.getItem` + `JSON.parse` of the WHOLE history map (all projects × up to 40 snapshots). That's 2 full parses per project card, N×2 per Wall render, on the synchronous render path.
- **Root cause**: `load()` has no in-memory cache; every read helper round-trips storage even though the module is the only writer.
- **Impact**: Bounded (N projects × 40 points) so it's polish today, but the cost is quadratic-ish in project count (N cards × full-map parse) and localStorage reads are synchronous main-thread work during render.
- **Fix sketch**: Keep a module-level `cache: HistoryMap | null` invalidated by `save()` (and optionally a `storage` event listener for cross-tab safety); `load()` returns the cache when present. Also let `trendDelta` accept an already-fetched series or derive both values from one `getHistory` call in `ReadinessTrend`.

## 5. `TrendDelta.span` is a dead constant field with a stale doc comment
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/teams/sub_factory/passport/passportHistory.ts:94
- **Scenario**: `trendDelta` documents `span` as "how many snapshots back the comparison is (0 when only one point exists)" but returns `null` when fewer than 2 points exist, so `span` is hard-coded `1` on every non-null return.
- **Root cause**: Leftover from an earlier design where the delta could compare across a longer window; the field and its comment survived the simplification.
- **Impact**: Misleading API — readers (and the test file) may assume variable spans exist; dead payload in every consumer. Trivial cost, but it's exactly the kind of doc/code drift that misdirects the next change.
- **Fix sketch**: Drop `span` from `TrendDelta` and fix the doc comment (or, if variable spans are genuinely planned, compute it as `s.length - 1 - prevIndex` against the last distinct reading). Update `ReadinessTrend` and `passportHistory.test.ts` accordingly — grep shows no other consumers.
