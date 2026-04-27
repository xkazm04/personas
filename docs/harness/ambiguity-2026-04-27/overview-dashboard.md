# Ambiguity Audit — Overview Dashboard

> Total: 12 findings (2 critical, 5 high, 4 medium, 1 low)
> Files read: ~22
> Scope: Home dashboard, KPIs, activity feeds, real-time event bus, health/leaderboard, alerts, memory/messages slices.

## 1. globalExecutionsTotal is a synthetic "load more" hint, not a real total

- **Severity**: critical
- **Category**: implicit-assumption
- **File**: src/stores/slices/overview/overviewSlice.ts:185-191
- **Scenario**: After fetching, the slice sets `globalExecutionsTotal: merged.length + (rawCount >= limit ? 1 : 0)`. The field is named like a row count but is actually a "+1 if more pages available" flag. Anything reading it (badges, "X of Y" displays, paging UIs) will display a number off-by-one or wildly wrong.
- **Root cause**: A pagination heuristic is overloaded onto a state name that strongly implies a real count. There is no comment explaining that `globalExecutionCounts.total` is the authoritative count and `globalExecutionsTotal` is only a "hasMore" sentinel.
- **Impact**: A future dev wiring a "Showing N of total" UI from `globalExecutionsTotal` will silently show wrong numbers; no test or type signal catches this.
- **Fix sketch**:
  - Rename to `globalExecutionsHasMore: boolean` and stop pretending it is a count.
  - Or add a JSDoc comment: "NOT a true total — see globalExecutionCounts.total."
  - Audit all consumers to point at `globalExecutionCounts.total`.

## 2. successRate is faked from a global proxy when no per-persona daily data exists

- **Severity**: critical
- **Category**: undocumented-decision
- **File**: src/stores/slices/overview/personaHealthSlice.ts:323-326, 130-136
- **Scenario**: For each persona, the heartbeat score relies on `successRate`, but the code falls back to `dashboard?.overall_success_rate ?? 100` when there's any execution activity. Inactive personas get a perfect 100, and active personas get the *fleet-wide* success rate masquerading as theirs.
- **Root cause**: The comment "Use global success rate as proxy since we don't have per-persona failure data per day" is buried mid-function (line 132), and the `?? 100` default for the no-data case has no comment explaining why a brand-new agent should be treated as "perfect."
- **Impact**: Health grades, leaderboard scores, and routing recommendations are all driven by this number. Two personas in the same fleet will get *identical* successRate even when one is healthy and one is failing — yet the dashboard advertises them as per-persona signals. This is a silent correctness bug that only surfaces when someone debugs why a clearly-failing persona shows as "healthy."
- **Fix sketch**:
  - Either compute true per-persona success from execution rows, or surface the proxy explicitly via a `successRateSource: 'proxy' | 'measured'` field.
  - Default for inactive personas should be `'unknown'` grade, not `successRate=100`.
  - Document the proxy decision in the slice header.

## 3. Heartbeat scoring constants encode opinions with no source

- **Severity**: high
- **Category**: magic-number
- **File**: src/stores/slices/overview/personaHealthSlice.ts:106-117
- **Scenario**: `computeHeartbeatScore` mixes weights (40/20/20/20) and saturation thresholds: `100 - healingFreq*25` (4/day → 0), `100 - rollbackCount*33` (3 rollbacks → 0), and a piecewise budget curve (>1.0 → 0, >0.8 → 30, else linear). Likewise `computeGrade` treats <80 as degraded, <50 as critical.
- **Root cause**: No commit reference, no spec, no rationale. The thresholds may have been hand-tuned for one demo dataset.
- **Impact**: Future tuning will be guesswork; nobody knows whether 80 is the "we agreed" threshold or arbitrary. Changing it will break dashboards consumers in unspecified ways.
- **Fix sketch**:
  - Add a doc comment naming this the "v1 heartbeat formula" and link to whatever decision/PR set the weights.
  - Move thresholds to named constants (`CRITICAL_HEALING_PER_DAY`, `BUDGET_AT_RISK_RATIO`).
  - Mark the formula as versioned so future changes can A/B safely.

## 4. Recent execution count is estimated by cost share — silently lies for free models

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/stores/slices/overview/personaHealthSlice.ts:312-321
- **Scenario**: `recentExecs += Math.round(pt.total_executions * (personaCostShare.cost / pt.total_cost))` divides each persona's daily cost by the day's total cost to apportion executions. If the day's total cost is 0 the branch is skipped (correct), but for any persona running a *free* local model alongside paid ones, its cost share is 0 and its execution count is dropped to zero.
- **Root cause**: Cost-share apportionment is being used as an execution-count proxy without acknowledging that cost ≠ execution volume.
- **Impact**: BYOM/local-model-heavy personas will appear inactive on the leaderboard and health dashboard even when they ran thousands of executions. Routing recommendations (line 199) gate on `recentExecutions`, so cost-saving suggestions become unreachable for personas that already use the free option.
- **Fix sketch**:
  - Pull execution counts from per-persona daily breakdowns instead of imputing them from cost share.
  - At minimum, when `personaCostShare.cost === 0` but the persona appears in `persona_costs`, fall back to evenly distributing `pt.total_executions / personas_with_zero_cost`.
  - Add a TODO + comment naming this assumption.

## 5. selectedPersonaId='' is overloaded as "All personas" sentinel

- **Severity**: high
- **Category**: requirements-unclear
- **File**: src/features/overview/components/dashboard/OverviewFilterContext.tsx:46, 84-94
- **Scenario**: Initial state is `useState('')`, and consumers across the dashboard treat `''` as "no filter / all personas." But in healingSlice.ts:64 and other places, the empty-string is also passed as a fallback to backend functions expecting a real `persona_id`.
- **Root cause**: There is no `selectedPersonaId: string | null` type — empty-string is a magic sentinel with no documentation.
- **Impact**: Backend RPCs accidentally receive `persona_id=""` when caller expected "no filter." Future devs adding filtering will reasonably pass `''` and get incorrect or empty results, or worse, a persona with literal id `""` in test data.
- **Fix sketch**:
  - Change the type to `string | null` and use `null` for "all".
  - Add a runtime guard at the API boundary that converts `''` → `undefined` and warns.
  - Document on the context type that `''` = wildcard.

## 6. Cooldown TTL is module-scoped — survives HMR but not unmount

- **Severity**: high
- **Category**: edge-case
- **File**: src/stores/slices/overview/alertSlice.ts:140-143, 351-355
- **Scenario**: `FIRED_COOLDOWN_MS = 1 hour` is enforced via `state.alertFiredCooldowns[rule.id]`, which is in-memory store state. There is no persistence to the backend, no cross-tab coordination, and no recovery after browser/app restart.
- **Root cause**: The decision to keep cooldowns in-memory only is undocumented. If the app crashes or the user reloads inside the hour, the same alert can fire again immediately.
- **Impact**: Users on a noisy production system will get duplicate "Critical cost spike!" alerts every reload. Also, two windows will alert independently.
- **Fix sketch**:
  - Document the in-memory tradeoff at the constant declaration ("cooldowns are session-scoped; backend dedupe is the durable layer").
  - Or persist `lastFiredAt` per rule on the backend and read it back on rule fetch.

## 7. pendingSyncAlertIds is a Set inside Zustand state — breaks Immer/persist assumptions

- **Severity**: medium
- **Category**: trade-off-hidden
- **File**: src/stores/slices/overview/alertSlice.ts:120, 154, 287, 386-396
- **Scenario**: `pendingSyncAlertIds: Set<string>` lives in store state and is mutated by creating new Sets on every change. If anyone later wires `persist` middleware or Immer to this store, Sets will silently turn into empty `{}` after rehydration.
- **Root cause**: No comment notes that this state slot is intentionally non-serializable.
- **Impact**: A future "let's persist alert state" change will lose retry tracking — alerts vanish from `pendingSyncAlertIds` on reload, never get re-synced, and never persist to the backend, so the in-memory toast was the only signal the user ever sees.
- **Fix sketch**:
  - Add a `// SERIALIZATION NOTE:` block warning Set/Map members.
  - Or refactor to `Record<string, true>` so it survives JSON round-trips.

## 8. Cloud review timestamp normalization assumes year < 2000 = invalid

- **Severity**: medium
- **Category**: magic-number
- **File**: src/stores/slices/overview/overviewSlice.ts:97-106
- **Scenario**: `safeTimestampToISO` rejects any value < `946684800000` (= 2000-01-01 UTC) as "invalid." It also auto-detects seconds vs. ms by `> 1e12` heuristic.
- **Root cause**: No documented contract from the cloud API about what unit the timestamp is in. The 2000-cutoff is a guess that will silently drop legitimate test data, dev fixtures, and historical imports from before 2000.
- **Impact**: If the cloud team ever changes their epoch unit (e.g. nanoseconds, or seconds-since-some-other-epoch), the `> 1e12` check will misclassify and dates will be off by 1000x with no error. Negative or zero timestamps return null silently — no telemetry.
- **Fix sketch**:
  - Lock down the contract: cloud API spec MUST say "milliseconds since Unix epoch" or "seconds since Unix epoch."
  - Replace the heuristic with a typed field. If validation fails, log a warning with the raw value.

## 9. fetchExecutionDashboard race — concurrent calls can land out of order

- **Severity**: medium
- **Category**: edge-case
- **File**: src/stores/slices/overview/overviewSlice.ts:335-350
- **Scenario**: Unlike `fetchGlobalExecutions` (which uses `fetchGlobalSeq` to discard stale responses) and `fetchMemories` (which uses `fetchRequestId`), `fetchExecutionDashboard` has no sequencing. If a user clicks "30d" then "7d" rapidly, the slow 30d response can clobber the fast 7d response.
- **Root cause**: The race-protection pattern was added to peer functions but not applied here. There's no comment about whether this is intentional (e.g., "always prefer latest write") or an oversight.
- **Impact**: Dashboard chart and KPI panel can display data for the wrong time window, and `executionDashboardDays` will disagree with the actual `executionDashboard.daily_points.length`. Subsequent `fetchObservabilityMetrics` reuses the dashboard data conditional on `executionDashboardDays === days` — making the wrong metrics surface in observability.
- **Fix sketch**:
  - Apply the same monotonic sequence pattern (`++fetchExecutionDashboardSeq`).
  - Add a JSDoc note when not applying it.

## 10. Recent (7-day) issue window uses Date.now() but issues' created_at format is unverified

- **Severity**: medium
- **Category**: edge-case
- **File**: src/stores/slices/overview/personaHealthSlice.ts:329-333
- **Scenario**: `new Date(i.created_at)` followed by `Date.now() - d.getTime() < 7 * 86400_000`. If `created_at` is anything but a parseable ISO string (e.g., a Unix-second number coming from Tauri bindings), `new Date(NaN)` yields NaN and the check returns false silently, dropping all recent issues.
- **Root cause**: No type contract on the `created_at` representation; the Rust binding is `string` but its format isn't documented in this file.
- **Impact**: Healing frequency silently reads zero, heartbeat score inflates, and a critically-broken persona looks healthy. No log signals the parse failure.
- **Fix sketch**:
  - Validate `Number.isFinite(d.getTime())` and `log.warn` once on first failure.
  - Document the format as "ISO-8601 UTC string, RFC 3339" at the binding edge.

## 11. SUCCESS_RATE_IDENTITIES exists but is not enforced — drift is invisible

- **Severity**: medium
- **Category**: missing-docs
- **File**: src/features/overview/utils/metricIdentity.ts:1-59
- **Scenario**: A registry of three different "Success Rate" definitions (recent-50, day-range, precomputed) plus a `resolveMetricPercent` helper. Nothing else in the codebase imports these — every dashboard sub-feature computes success rate independently.
- **Root cause**: The file exists as documentation-via-types but isn't wired in. Future devs will compute success rate inline and miss this contract.
- **Impact**: The same KPI shows different numbers in different cards on the same page (recent-50 vs. day-range), with no signal that this is *intentional* — users assume one is broken.
- **Fix sketch**:
  - Either wire callers to use `resolveMetricPercent` and surface the identity name in tooltips.
  - Or delete the file and put a single comment in each card explaining its window choice.
  - Add an ESLint rule to flag inline `successful/total*100` calculations and require referencing an identity.

## 12. SPEEDS array hard-codes 64x replay with no UX justification

- **Severity**: low
- **Category**: magic-number
- **File**: src/features/overview/sub_realtime/timelinePlayerHelpers.ts:3
- **Scenario**: `SPEEDS: PlaybackSpeed[] = [2, 4, 8, 16, 32, 64]` — a 7-day replay at 64x renders ~2 hours/sec. There is no comment about whether 64x was tested or just feels fast. `DENSITY_BINS = 60` likewise has no explanation.
- **Root cause**: Hand-picked playback values without recorded rationale.
- **Impact**: Users picking 64x on a busy week may overwhelm the renderer; future devs adjusting won't know which numbers are load-bearing vs. arbitrary.
- **Fix sketch**:
  - Add a short comment: "Speeds chosen so 7d replay completes in <2 minutes at max speed."
  - Or measure and lower the cap if frame budget is exceeded.
