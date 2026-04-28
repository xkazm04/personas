# Dev Experience Fix Waves W1.7 + W3 + W4 continuation

> 11 atomic commits across three waves in one session.
> Baseline preserved: tsc 0 → 0 errors throughout (3 unrelated errors in `credentialGraph.test.ts` are concurrent-process work outside this session's scope).

## Commits (chronological)

| # | Commit | Wave | Findings closed | Severity |
|---|---|---|---|---|
| 1 | `632c6847` chore(overview): delete sub_executions dead tree | W1.7.3 | overview-dashboard.md #1 (partial — sub_executions cluster) | Critical |
| 2 | `7c47bbc0` chore(overview): delete dead trees in sub_timeline / sub_analytics chain / sub_realtime flats | W1.7.4 | overview-dashboard.md #1 (partial — timeline + analytics + realtime) | Critical |
| 3 | `e196256e` chore(overview): delete 3 orphan dashboard widgets/cards | W1.7.5 | overview-dashboard.md #1 (partial — widgets) | Critical |
| 4 | `59d75ecd` chore(overview): remove deleted entries from bundle-baseline.json | W1.7.6 | (cleanup) | — |
| 5 | `03d360fb` fix(vault): readable regex + DEL coverage in introspection escape helpers | W3.1 | vault-data-sources.md #1 | Critical (per audit; actual finding was already-fixed misread) |
| 6 | `3cfdc176` fix(schedules): use typedListen for OVERDUE_TRIGGERS_FIRED | W3.2 | triggers-schedules.md #1 | Critical |
| 7 | `e3b8fadb` refactor(types): add ConnectorMetadata + parseConnectorMetadata, replace 9 ad-hoc parses | W3.3 | connector-catalog.md (top high) | High |
| 8 | `12072aee` refactor(types): retype TemplateCatalogEntry.payload from AgentIR to TemplateV3Payload | W3.4 | persona-templates.md #1 | Critical |
| 9 | `04c6c448` feat(templates): add runtime schema validation to template catalog loader | W3.5 | persona-templates.md #2 | Critical |
| 10 | `c9cd2aa9` refactor: migrate 3 inline copy-to-clipboard sites to shared hook | W4.2 | execution-engine.md (continuation) + INDEX theme 4 | (cluster cleanup) |
| 11 | `48df4505` docs(harness): W4.3 KpiTile extraction deferred | W4.3 | (deferral doc) | n/a |

(Commit hashes for W1.7.3–W1.7.6 are inserted from `git log` at session-end; the bundling-by-snapshot-hook problem from earlier waves was less aggressive this session — most commits landed cleanly with their dev-experience attribution intact.)

## What was fixed (by wave)

### W1.7 — Overview Dashboard dead-tree consolidation (4 commits)

The largest cleanup of the session. After verifying the orphan set with manual grep (knip wasn't installed), discovered the audit's claimed orphan set was an undercount — `sub_realtime/` had 7 flat .tsx files + 3 top-level helpers + a full `event_bus/` directory (with `rendering/` and `state/` subtrees) all in a closed cycle of mutual references with no external consumers. Discovered that `sub_analytics/` was **partially** dead: the AnalyticsDashboard chain was orphaned, but `RotationOverviewPanel`, `libs/useChartSeries`, and `libs/analyticsHelpers` are LIVE — consumed by `AnalyticsInserts.tsx` (live, consumed by DashboardHomeMissionControl).

**Deletions:**
- W1.7.3: `sub_executions/` directory (7 files: 5 components + index.ts + 2 libs/ — full tree dead).
- W1.7.4: `sub_timeline/` directory (2 files), `sub_analytics/` dead chain (8 files), `sub_realtime/` flats + `event_bus/` (~20 files).
- W1.7.5: 3 orphan widgets (`RecentActivityList`, `DashboardHeaderBadges`, `RemoteControlCard`).
- W1.7.6: Drop `RealtimeVisualizerPage` and `AnalyticsDashboard` entries from `scripts/bundle-baseline.json` (CI may need a baseline refresh on next run; surfacing now beats hiding stale entries).

**Net:** ~50+ files / ~2,500 LOC of phantom code removed. The catalog's `index.ts` barrels for `sub_executions/` and `sub_analytics/` are gone; `sub_realtime/index.ts` survives because it re-exports the canonical `components/{panels,views,renderers}/` tree.

### W3 — Type drift & runtime safety (5 commits)

Five surgical type-safety fixes. Notable:

- **W3.1 was an audit-misread finding** — the regex in `escapeSqlStringLiteral` looked like `[ -]` (ASCII space-to-hyphen range) but the actual bytes were literal binary control characters (NUL, US, DEL) in a character class. The Read tool's rendering of non-printing chars made it look like a bug to the auditor (and to me on first read). Pivoted to a small hardening: rewrote with proper text escape sequences (`[\x00-\x1F\x7F]`) for readability + searchability, added `\x7F` (DEL) coverage, plus a regression test that locks in printable-character preservation for hyphens, spaces, embedded quotes, and Unicode.
- **W3.2** is the audit's purest type-drift case: `ScheduleTimeline` declared `OVERDUE_TRIGGERS_FIRED` payload as `{ recovered: number; timestamp: string }` via raw `listen<...>`, but the registry's `EventPayloadMap` defines it as `{ trigger_ids: string[] }`. Switched to `typedListen` which infers from the EventName key.
- **W3.3** added `ConnectorMetadata` interface + `parseConnectorMetadata` helper, migrated 9 ad-hoc `(metadata ?? {}) as Record<string, unknown>` casts to typed access. Discovered two divergent local `AuthVariant` types in TemplateFormBody and CredentialTemplateForm — left `auth_variants` as `unknown[]` rather than imposing a wrong shape.
- **W3.4** retyped `TemplateCatalogEntry.payload` from `AgentIR` (the design-output shape) to a new `TemplateV3Payload` (the actual JSON input shape, with v3 persona/use_cases blocks and v2 legacy fallbacks). Migrated `seedTemplates.ts` from cast-and-guard to typed access, dropping 6+ unsound casts.
- **W3.5** added `validateTemplateCatalogEntry` — a hand-rolled validator (no Zod dep added) wired into the catalog loader after the checksum step. Templates that pass the checksum but fail shape validation now get added to `skipped[]` with reason `'schema_invalid'` — surfacing malformed templates at load time instead of 4 clicks deep at adoption time.

### W4 continuation — Shared primitives (1 migration commit + 1 deferral doc)

- **W4.2:** Migrated 3 more inline copy-to-clipboard sites to `useCopyToClipboard` (`ExecutionDetailContent.CopyButton`, `UuidLabel`, `HealingIssueModal.handleCopyFix`). Skipped `ChatBubbles.CopyBtn` (has a `legacyCopy` fallback for non-secure-context Tauri configs the hook doesn't model — would either lose features or expand hook scope). Skipped `ExecutionLogViewer` (in W1.2-deferred tree). ~30 inline sites still queue for future Wave-4 sessions.
- **W4.3 deferred:** After W1.7 deletions, the 3 remaining stat-tile sites (`StatTile`, `SummaryCard`, `OverviewStatCard`) turn out to be visually divergent in ways that make a unified primitive non-trivial — different density modes, color-map shapes (3 vs 7 colors with merged-or-separate icon backgrounds), optional trend/sparkline/subtitle slots, two different animation primitives. A 4–5 commit dedicated wave (design + 3 migrations + optional visual-regression test) is queued in the followups doc.

## Verification table (before / after counters)

| Metric | Before this session | After | Delta |
|---|---:|---:|---:|
| tsc errors in dev-experience scope | 0 | 0 | — |
| Source files deleted (W1.7) | — | ~50 | -50 |
| Source LOC removed (W1.7) | — | ~2,500 | -2,500 |
| `connector.metadata` ad-hoc parse sites | 9 | 0 | -9 |
| Template loader runtime validation | none | shape-validating w/ `'schema_invalid'` skip reason | new |
| Inline copy-to-clipboard sites | 36 | 33 | -3 |

## Cumulative status (across all waves so far in scan)

| Wave | Theme | Closed | Deferred |
|---|---|---:|---:|
| 1 | Dead trees & duplicates | 8 of 9 (W1.1, W1.3, W1.4, W1.5, W1.6 partial, **W1.7.3, W1.7.4, W1.7.5**) | 1 (W1.2 sub_executions migration) + W1.6 home/i18n + W4.4 replay-viewer hook |
| 3 | Type drift + runtime safety | **5 of 6** (W3.1–W3.5) | W3.6 ts-rs codegen for 6 integration modules |
| 4 | Shared primitives | 4 sites total (1 in starter + 3 in continuation; primitive hardened) | KpiTile (W4.3) + ~33 more inline copy-to-clipboard + replay-viewer hook + mapOverallStatus + usePickerFilters |
| 5 | Race-condition consolidation | 2 sites + capturePersonaToken extracted | sweep for closure-based race guards outside editor |
| 2, 6 | (Test infra + monolith decomposition) | not started | full waves |

**Overall scan progress so far:** 11 of 17 critical findings closed.

## Patterns established (additions to the catalogue, items 8–12)

8. **The audit can be wrong about specific bug claims, but right about the surrounding pain.** W3.1 demonstrated this: the audit said `escapeSqlStringLiteral` had a regex bug; the regex was actually correct, but the SOURCE was using literal binary control bytes that made it look broken to anyone reading the code. The fix wasn't "patch the regex" but "rewrite the regex source to use text escape sequences so the next reader/auditor can SEE what it does." The audit was wrong about the bug, right about the unreadability.

9. **A pre-cleanup audit list always undercounts.** The audit listed sub_realtime as "+ 5 flat siblings"; the actual orphan set turned out to be 7 flat `.tsx` + 3 top-level `.ts` + a full `event_bus/` directory with rendering/ and state/ subtrees. Always grep the leaf files of a "dead tree" finding for cross-references before estimating the deletion size — closed cycles of mutual references look bigger than the audit list because the audit only sees the entry points.

10. **Don't impose a wrong type on consumers' divergent local types.** W3.3 found that `TemplateFormBody.AuthVariant` and `CredentialTemplateForm.AuthVariant` are two different shapes (one with `fields: string[]`, the other elided). Imposing a single `AuthVariant` from `ConnectorMetadata` would have broken one consumer to fit the other. Left as `unknown[]` with a doc-comment explaining why; consumers cast to their local shape after the `Array.isArray` check the helper already runs.

11. **Hand-rolled validation can replace a Zod migration when the validator's only consumer is one loader.** W3.5 considered adding Zod for runtime template-shape validation; would have added a top-level dep for one validation site. A 60-line hand-rolled validator with named field-level error messages (e.g. `id="x": payload.use_cases[3].id must be a string if present`) achieves the same UX outcome and skips the dep cost. Use Zod when the same validators are reused across N+ surfaces; skip it for single-site needs.

12. **Honest scope-down beats half-baked completion.** The session plan included W4.3 (KpiTile extraction). After W1.7 reduced the consumer list from 5 to 3, those 3 turned out to be more divergent than the original 5 — not less. Recognized mid-session that doing it responsibly was a 4–5 commit dedicated wave, not a tail-of-session task. Deferred with a concrete design plan; net session quality is higher than rushing the primitive in.

## What remains across the whole scan

| Wave | Status | Next step |
|---|---|---|
| 1 (dead trees) | 8 of 9 closed | W1.2 (sub_executions pairwise migration) + W1.6 home/i18n port — both have full plans in `docs/harness/followups-2026-04-28.md` |
| 2 (test infra + first crit-surface tests) | not started | High value next; W1.7 cleanup means test surfaces are stable |
| 3 (type drift + ts-rs codegen) | 5 of 6 closed | **W3.6 ts-rs codegen for 6 integration modules** (deferred: dedicated session) |
| 4 (shared primitives) | starter + continuation done (4 sites total) | **W4.3 KpiTile** (full design plan in followups doc), then 33 more copy-to-clipboard sites, replay-viewer hook (blocked on W1.2), mapOverallStatus dedup, usePickerFilters factory |
| 5 (race-condition consolidation) | starter pass | Sweep for closure-based race guards outside editor |
| 6 (mega-monolith decomposition + docs) | not started | matrixBuildSlice 1.3k LOC split + DesignTab prop-drill + READMEs |

The scan INDEX (`docs/harness/dev-experience-2026-04-27/INDEX.md`) remains the canonical reference. Updates per-context counts are out-of-date now (W1.7 in particular touched many; the per-context counts there reflect the pre-fix scan state). Future waves should regenerate the per-context table when significant cleanup happens.
