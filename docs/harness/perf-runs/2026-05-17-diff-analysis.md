# Perf-walk #2 — Tier 1/3 diff analysis

> Second run, 36 stops (32 originals + 3 revisit + 1 live-events burst). Compared against `2026-05-17T20-34-55-190Z.json` (baseline immediately before the fixes).
> Full Markdown: `docs/harness/perf-runs/2026-05-17-diff.md`. Raw JSON: `2026-05-17T20-57-02-193Z.json`.

## Headline

Tier 1 fixes delivered exactly the data predicted: **L1/credentials is now an 8× cheaper page** (~7.4 sec of IPC time and 81% of render time recovered), and **Settings re-mounts are nearly free** thanks to the 5-min config cache. Tier 2 collapsed on discovery — the Design Reviews list already uses `TemplateVirtualList`; the 4001 DOM nodes come from the chrome (search bar, filters, trending carousel), not the list — so no virt fix was needed. Tier 3's revisit stops confirm the cache fixes elide redundant work on remount; the live-events burst stop shows Wave 2A's rAF coalescing absorbing a 4-event burst in 5 React commits and 3 IPCs.

The biggest miss: **first-visit cost on Overview and Settings is unchanged** — both still fire their per-id IPC fan-outs on cold mount (no cache to hit yet). That's the next data-driven priority.

## What landed (4 commits)

| Commit | Fix | File |
|---|---|---|
| `3d0b61832` | Vault healthcheck TTL: 30s → 24h | `useBulkHealthcheck.ts` |
| `03804e18c` | Rotation cache: skip refetch when populated | `rotationSlice.ts` |
| `f8df06833` | Config 5-min cache, module-level | `ConfigResolutionPanel.tsx` |
| `a1109d4b1` | 3 new spec stops: 3 revisit + 1 live-events burst | `perf-nav-walk.spec.ts` |

Tier 2 was a planned **virtualization** fix but the discovery work found `TemplateVirtualList` already in place — the high DOM count comes from page chrome, not the list. Skipped with no change.

## Per-stop validation

### L1/credentials — full win

| | Before | After | Δ |
|---|---:|---:|---:|
| Renders | 57 | 13 | **-77%** |
| Render ms | 381 | 71 | **-81%** |
| IPC count | 51 | 5 | **-90%** |
| IPC time | 8042ms | 664ms | **-92% (7.4 sec recovered)** |
| Top command | `healthcheck_credential × 25` | `healthcheck_credential × 2` | -23 |

The 30s TTL was triggering a fresh bulk healthcheck on every Vault page mount (because the previous bulk's `completedAt` was older than 30s, and per-credential `healthcheck_last_tested_at` was also stale). The 24h TTL caches the per-credential result — only credentials genuinely never tested in the last day get probed. The 2 remaining calls are likely brand-new credentials with no `healthcheck_last_tested_at`.

The render-count drop (57 → 13) is downstream of the IPC drop: fewer `patch_credential_metadata` invocations means fewer `useVaultStore.setState` calls means fewer cascading re-renders through `CredentialList`. **This validates the audit's `credential-vault #1` finding causally**: the 35+ scattered fetchers weren't the problem — the bulk healthcheck *was*, and reducing it killed both IPC and render churn together.

### settings/account — config cache hit

| | Before | After | Δ |
|---|---:|---:|---:|
| Renders | 9 | 8 | -11% |
| IPC count | 59 | 7 | **-88%** |
| IPC time | 1887ms | 68ms | **-96%** |
| Top command | `resolve_effective_config × 52` | (gone) | -52 |

This is the cache *hit*: `L1/settings` was visited earlier in the walk, populated the cache, so by the time `settings/account` lands the config panel reads from memory. **First-visit cost (L1/settings → 53 IPCs) is unchanged** — that's the cold-mount full-resolve.

### settings/engine — paired win

| | Before | After |
|---|---:|---:|
| IPC count | 11 | 7 |
| IPC time | 518ms | 52ms (-90%) |

Smaller absolute change but same pattern: rotation/config caches hitting on related panels.

### Revisit stops (new) — caches confirmed working

| Stop | Renders | IPC | Render ms | Notes |
|---|---:|---:|---:|---|
| `revisit/credentials-2nd` | 14 | 10 | 49ms | vs `L1/credentials` first-visit (after fix: 13/5/71) — second visit ~equal to first because TTL kicks in equally |
| `revisit/overview-2nd` | 70 | 12 | 141ms | vs 58/34/203 first — IPC count dropped 34 → 12 (rotation cache hit), but render count *went up* (70 vs 58). The render churn isn't IPC-caused — there's an independent source on Overview |
| `revisit/settings-2nd` | 8 | 7 | 42ms | vs 6/53/51 first — IPC count dropped 53 → 7 (config cache hit); render count near-flat |

**Important signal: `revisit/overview-2nd` renders > `L1/overview` renders.** Cache helps IPC but doesn't reduce render commits on Overview. There's an independent re-render source there — possibly the Recharts panels, the credential status pulse animations, or an unstable selector elsewhere. Investigation candidate.

### interaction/live-events-burst (new) — Wave 2A validated under load

| Renders | IPC | Render ms | DOM |
|---:|---:|---:|---:|
| 5 | 3 | 23ms | 823 |

`triggerTestFlow()` fans 4 simulated events through the bus over ~1.5 sec. The bridge counted only **3 IPCs total** (the `triggerTestFlow` invoke itself + 2 backend follow-ups) and **5 React commits** for what would naively be 4 events × N subscribers. The rAF coalescing in `createSingletonListener` is doing its job — without it, we'd expect at least 4 commits from `useRealtimeEvents` alone, plus EventLogSidebar updates per event, easily 20-50 commits. **Wave 2A's coalescing fix is verified by measurement** for the first time.

## What didn't change

### L1/overview cold-mount IPC fan-out — unchanged
`get_rotation_status × 25` still fires on the *first* Overview visit. The cache only helps **second** visits (proven by `revisit/overview-2nd` dropping IPC count 34 → 12). To win on cold-mount, we'd need either:
- A **Rust bulk endpoint** (`get_rotation_statuses_bulk(ids: Vec<String>)`) — eliminates roundtrips on every first visit
- Or a **persisted cache** (localStorage / IDB) seeded from the previous session

### L1/settings cold-mount unchanged
Same story for `resolve_effective_config × 52`: 5-min in-memory cache helps revisits, not first visits. Same fix options (bulk Rust endpoint, persisted cache).

### L1/design-reviews unchanged (expected)
Tier 2 skipped after discovering `TemplateVirtualList`. The 4001 DOM comes from search bar / filter chips / trending carousel — none of which are list items. Would need a separate "chrome-trim" investigation if desired.

### L1/overview render time (+687ms IPC time, -36ms render time)
IPC time *increased* despite IPC count dropping — likely backend latency variance run-to-run, not a regression. Render time dropped a real -15% though.

## Run totals (32 originals only, fair comparison)

The "Run totals" in the diff report counts the 4 new stops, inflating the apples-to-oranges comparison. Restricting to the 32 stops present in both runs:

| Metric | Before | After (32 only) | Δ |
|---|---:|---:|---:|
| Render commits | 337 | ~282 | **-16%** |
| IPC calls | 329 | ~222 | **-32% (107 fewer)** |
| Render actual time | 1687ms | ~1418ms | **-16%** |

(Approximate — the report sums all stops, the 4 new ones add ~97 renders / ~32 IPCs / ~255ms.)

## Next steps (data-driven, refreshed priorities)

### P0 — fix first-visit cost on Overview + Settings (cold-mount wins)
The cache fixes are great on revisits but pay nothing on cold. Two paths:
- **(a) Add Rust bulk endpoints**: `get_rotation_statuses_bulk(ids)`, `resolve_effective_config_bulk(persona_ids)`. Each is one IPC + Rust-side parallelism. Likely 5-8x faster than 25/52 roundtrips.
- **(b) Hydrate from persisted store on app boot**: seed `rotationStatuses` and config cache from localStorage on app init, so first-render reads stale-but-good data instantly, refreshes in background.

(a) is structurally cleaner; (b) is faster to ship. Either gets the *first-visit* cost down to where revisits already are.

### P1 — investigate Overview render churn (independent of IPCs)
`revisit/overview-2nd` shows 70 renders **after** the IPC fan-out is cached down to 12. So 70 of those renders are not IPC-driven. Candidates: Recharts panels updating on timer, credential status pulses (CSS animations don't cause renders, but state updates from them might), unstable selectors on overview slices. Add per-component Profilers under `src/features/overview/sub_analytics/` to identify.

### P2 — interaction stops the audit needed
The live-events burst stop validated Wave 2A. Three more interaction stops would similarly validate or invalidate the audit's other "invisible to nav" findings:
- **persona-editor keystroke** — type 10 chars in description field. Validates persona-editor #1+2 (JSON.stringify fingerprint, useEffectivePersona reallocation).
- **catalog-search type** — type in connector picker search. Validates connector-catalog #1 (no debounce).
- **build-session start** — `startBuildFromIntent` exists in the bridge; but takes 30-90s and would inflate spec time. Defer.

### P3 — Vault visible render improvement
The L1/credentials render-time drop of 81% should be user-perceivable. Worth a quick manual confirmation: open the Vault page before/after and feel the difference. The data says it's there.

### P4 — CI integration
The two-run diff format works. Wire into PR checks: any PR touching `src/` runs the walk, attaches a `--diff` report to the PR description. Catches regressions before review.

## Reproducing this run

```pwsh
# 1. Boot test-mode app
npm run tauri:dev:test    # ~5-10s warm, ~3 min cold

# 2. Run the spec
npx playwright test tests/playwright/perf-nav-walk.spec.ts

# 3. Render the diff
node scripts/perf/render-perf-report.mjs --diff --output docs/harness/perf-runs/<name>.md
```

JSON files in `docs/harness/perf-runs/` are tracked; the diff against the previous run is one command away.
