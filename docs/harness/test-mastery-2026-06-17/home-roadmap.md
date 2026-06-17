# Test Mastery — Home & Roadmap
> Total: 8 findings (1 critical, 3 high, 3 medium, 1 low)

## 1. Roadmap merge & blank-protection logic (`buildDisplayItems`) is entirely untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/features/home/sub_releases/HomeRoadmapView.tsx:185-220 (also fromLive 134-148, fromBundled 116-131)
- **Current test state**: none
- **Scenario**: This is the merge point where an **untrusted, remote-authored, schema-only-validated** live roadmap payload is fused with bundled fallback content and rendered. The function's central business invariant — "if the live payload yields zero *displayable* items (empty `items: []`, or all items missing locale content), fall back to bundled content instead of blanking the surface" (line 212) — has no test. A regression that reorders the `if (built.some(isDisplayable))` guard, drops the fallback, or lets a placeholder title (`[roadmap.<id>]`) count as displayable would blank the entire Home → Roadmap surface (the `if (!hero) return null` short-circuit on line 357 nukes the status pill too) for *every* desktop client, triggered remotely by a single content-author mistake. Nothing would catch it.
- **Root cause**: All merge helpers (`buildDisplayItems`, `buildBundledItems`, `fromLive`, `fromBundled`) are module-private; the component is only reachable through React + `useReleasesTranslation`, so no one wrote a unit test, and there is no component test either.
- **Impact**: A remotely-served bad payload (or a refactor of the fallback) silently blanks the product's home/roadmap landing surface for the whole installed base — the exact failure the code comments say they are defending against, with zero automated proof the defense holds.
- **Fix sketch**: Export the merge helpers (or a thin `__test__` re-export) and add a vitest batch asserting the invariants, not snapshots: (a) live payload with ≥1 displayable item → live wins and bundled is ignored; (b) live payload with `items: []` → result equals bundled items; (c) live payload where every item lacks a locale entry (all titles become `[roadmap.<id>]`) → falls back to bundled; (d) `liveOverride == null` → bundled; (e) locale falls back to `en` when `language` block absent; (f) items returned sorted by `sort_order` ascending. LLM-generatable once helpers are exported.

## 2. Forward-compat narrowing + dedupe (`narrowStatus`/`narrowPriority`/`dedupeById`/`isDisplayable`) untested
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/home/sub_releases/HomeRoadmapView.tsx:84-114, 157-183
- **Current test state**: none
- **Scenario**: These pure functions encode deliberate forward-compat policy: an unknown server `status` coerces to `'planned'`, unknown `priority` to `'later'`, both leaving a Sentry breadcrumb; `dedupeById` keeps first occurrence to stop a duplicate id from being stripped from *every* lane by the downstream `filter(i => i !== hero)`. A regression (e.g. unknown status mapped to `in_progress`, or dedupe keeping the last instead of first, or `isDisplayable` not rejecting the `[roadmap.<id>]` placeholder) silently corrupts what users see and lets the blanking case (finding #1) slip past.
- **Root cause**: Helpers are pure but module-private; no exported surface, so no test exists.
- **Invariant to assert**: known status/priority pass through unchanged; any unknown/null/empty value maps to the documented fallback bucket; `dedupeById` preserves first occurrence and drops later duplicates; `isDisplayable` is false for empty/whitespace titles and for the literal `[roadmap.<id>]` placeholder, true otherwise.
- **Impact**: Wrong roadmap status/priority shown to users; duplicate-id payload silently empties lanes; the blank-protection in #1 is undermined.
- **Fix sketch**: Export the four functions; LLM-generate a parameterized vitest covering each known value + an `'archived'`-style unknown + null/undefined/empty + duplicate-id list. Mock `@sentry/react` `addBreadcrumb` and assert it fires exactly on the coercion/dedupe paths (honest assertion of the observability hook, not just the return value).

## 3. `fetch_roadmap` network / cache / stale / clock-skew / atomic-write paths untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/live_roadmap.rs:163-246, 371-397 (file comment line 400 admits "Network + disk paths exercised manually")
- **Current test state**: exists-but-weak — `validate()` is well covered (lines 444-548), but the command's decision logic and disk cache are not.
- **Scenario**: The tests cover only schema validation. Untested business logic: (a) the **clock-skew guard** (lines 177-196) — a backward time jump must force a refetch instead of pinning stale content forever; this was an explicit bug fix with no test, so it can silently regress; (b) the **stale-fallback path** (lines 230-242) — network failure with a cache present must return `source: Stale` (the UI shows a red "degraded" pill), and with no cache must return `Err`; (c) the **fresh-cache short-circuit** (lines 177-186) returns `Cache`; (d) `write_cache` atomic tmp+rename (lines 376-397) is the data-loss guard against truncated cache on crash and a concurrent-writer race. None are exercised.
- **Root cause**: Network and AppHandle/disk dependencies aren't abstracted, so the author deferred to manual testing.
- **Impact**: A regression in the TTL/skew branch silently serves stale roadmap content (or refetches on every call, hammering the CDN); a regression in `source` selection makes the freshness/degraded pill lie; a `write_cache` regression reintroduces truncated-cache data loss for offline users.
- **Fix sketch**: Refactor the cache-freshness decision into a pure helper `decide_cache_action(cached_at, now, ttl, force) -> {ServeCache | Refetch}` and unit-test it (age<TTL → serve; age≥TTL → refetch; now<cached_at → refetch+warn; force → refetch). Test `write_cache`/`read_cache` round-trip against a `tempfile::tempdir()` and assert a leftover `*.tmp` sibling does not corrupt `read_cache`. Source-selection (Fresh→Network, 304→Network, Err+cache→Stale, Err+no-cache→Err) can be covered by injecting a fetch trait or testing the match arms via small helpers.

## 4. `hasFailureSpike` fleet-health threshold logic untested
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/home/sub_welcome/lib/fleetHealth.ts:47-50
- **Current test state**: none
- **Scenario**: This drives the directly user-visible red "failure spike" pulse on the Home success-rate pill. The doc-comment specifies exact boundary behavior (total<3 → false; total=3,failed=2 → true; total=6,failed=3 → false because the ratio threshold is *strict* `>`; total=0 → false). A regression flipping `>` to `>=`, or dropping the min-sample guard, either cries wolf on a single quiet-morning failure (users desensitize) or never fires on a genuinely broken fleet.
- **Root cause**: Pure exported function, no test was ever written — a clean, high-value gap.
- **Impact**: The fleet-health alarm becomes either noise or silence; a systemically broken fleet (bad credential/connector/model id) shows green and goes unnoticed.
- **Fix sketch**: LLM-generate a table-driven vitest hitting every documented boundary: `(0,0)→false`, `(2,2)→false` (sample too small), `(3,2)→true`, `(3,1)→false`, `(6,3)→false` (exact 0.5, strict), `(6,4)→true`, `(10,0)→false`. Invariant: spike requires BOTH sample ≥ `FAILURE_SPIKE_MIN_EXECUTIONS` AND `failed/total` strictly `> FAILURE_SPIKE_RATIO_THRESHOLD`. Reference the exported constants, not literals, so a threshold change forces an intentional test update.

## 5. `formatRelative` "future timestamp" clamp is determinism-sensitive and untested
- **Severity**: medium
- **Category**: flaky-nondeterministic
- **File**: src/features/home/sub_releases/LiveRoadmapStatusPill.tsx:30-40
- **Current test state**: none
- **Scenario**: This formats the "Updated 4m ago" freshness pill from a Rust cache timestamp. The deliberate fix here is clamping `diffSec` to `<= 0` so a future timestamp (NTP correction, DST jump, laptop wake, cross-machine cache replay) degrades to "just now" rather than the lying "in 4 minutes". Without a test, a regression that drops `Math.min(0, …)` reintroduces a freshness pill that claims the roadmap was updated in the future. The bucket-selection (`second/minute/hour/day`) and the empty-string returns for null/non-finite input are also unasserted.
- **Root cause**: Pure-ish function but reads `Date.now()` and uses `Intl.RelativeTimeFormat`, so it needs `vi.useFakeTimers()` + a fixed locale; the function isn't exported.
- **Impact**: Freshness/degraded pill can display a nonsensical future-relative time, undermining the carefully-designed network/cache/stale trust signals.
- **Fix sketch**: Export `formatRelative`; with `vi.setSystemTime(fixed)` assert: future iso → "now"/"just now" (clamped, never "in …"); 4 min ago → minute bucket; 2 h ago → hour bucket; 3 days ago → day bucket; `null`/`'not-a-date'` → `''`. Pin `language='en'` for stable `Intl` output (do NOT snapshot localized strings — assert bucket sign/unit).

## 6. `isLocalConnector` connector-scope classifier untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/home/sub_welcome/lib/connectorScope.ts:34-38
- **Current test state**: none
- **Scenario**: Splits credentials into "built-in/local" vs "external" buckets for the Home Connections card chip. It's explicitly display-only (a miss just lands a connector in the external bucket — nothing breaks), so this is medium, not high. But the prefix/substring rules (`^(personas_|local_)`, `includes('obsidian')`) plus the known-name set are easy to break in a refactor, and there's no test pinning intent.
- **Root cause**: Small pure exported helper, never tested.
- **Impact**: Connection counts on the home dashboard mislabel local vs external connectors; low blast radius but a visible cosmetic wrongness.
- **Fix sketch**: LLM-generate a vitest: each name in `LOCAL_CONNECTOR_NAMES` → true; `personas_anything`/`local_anything`/`my_obsidian_vault` → true; `slack`/`github`/`null`/`undefined`/`''` → false. Invariant: local iff in the known set OR matches a known prefix OR contains `obsidian`.

## 7. `useNavCardStatus` 24h/prior-24h window partitioning has no extractable, tested core
- **Severity**: medium
- **Category**: test-structure
- **File**: src/features/home/sub_welcome/lib/useNavCardStatus.ts:77-116, 47-53
- **Current test state**: none
- **Scenario**: The hook buckets executions/events into "current 24h" vs "prior 24h" with guards for `NaN` timestamps and future-dated rows (`age < 0` skip), then computes `trendOf`/`pctChange` for the trend arrows. The bucketing math and the `pctChange` zero-denominator branch (`prev===0 → curr>0?100:0`) are real logic, but they're trapped inside `useEffect`s and an inline reducer, so they can only be tested via a heavy hook harness — meaning today they're untested and a boundary regression (e.g. a row exactly at the 24h edge double-counted, or NaN dates inflating "active agents") ships silently.
- **Root cause**: Pure partitioning/trend math is inlined into the hook rather than extracted, defeating cheap unit testing.
- **Impact**: Wrong "agents active today" / "events today" counts and misleading up/down trend arrows on the home quick-nav cards.
- **Fix sketch**: Extract a pure `partitionByWindow(rows, now, dayMs)` and keep `trendOf`/`pctChange` exported; unit-test edge cases: row at `age === DAY_MS` (boundary), `age === 2*DAY_MS`, future row (`age < 0`) skipped, `NaN`/unparseable `created_at` skipped, distinct-persona dedupe, and `pctChange(0,0)→0`, `pctChange(5,0)→100`, `pctChange(0,5)→-100`. This is a structural refactor that unlocks an LLM-generatable batch.

## 8. No quality gate / new-code coverage ratchet on the live-roadmap merge code
- **Severity**: low
- **Category**: quality-gate
- **File**: src/features/home/sub_releases/HomeRoadmapView.tsx, useLiveRoadmap.ts; src-tauri/src/commands/live_roadmap.rs
- **Current test state**: none (no per-area threshold)
- **Scenario**: The live-roadmap path is the one place where remote content can outpace the desktop binary and silently blank or mislabel a user-facing surface. Once findings #1–#3 add tests, nothing prevents a future edit to these specific files from landing with the merge/fallback path re-broken and uncovered.
- **Root cause**: Coverage is opportunistic; there's no advisory threshold or new-code ratchet scoped to the live-roadmap merge/cache files.
- **Impact**: Coverage earned in #1–#3 erodes; the blank-protection regression returns unnoticed.
- **Fix sketch**: After exporting the helpers, add a *narrow, advisory-first* per-path threshold (e.g. vitest `coverage.thresholds` glob for `sub_releases/HomeRoadmapView.tsx` + `liveRoadmap.ts`, and a cargo-llvm-cov check on `commands/live_roadmap.rs`) covering branches, plus a new-code ratchet so net-new lines in these files carry tests. Keep it advisory until #1–#3 land so it never blocks unrelated work, then promote to blocking on just these files — calibrated to the blanking risk, not a repo-wide mandate.
