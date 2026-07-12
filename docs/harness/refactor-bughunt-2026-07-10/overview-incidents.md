> Context: overview/incidents
> Total: 8
> Critical: 0  High: 1  Medium: 3  Low: 4

## 1. In-flight guard silently drops a filter-change refetch (stale list for up to 30s)
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: race-condition
- **File**: src/features/overview/sub_incidents/libs/useIncidentsData.ts:31-62
- **Scenario**: The 30s interval fires a `refresh()` (sets `inFlightRef.current = true`). While that request is in flight, the user changes a filter. `filterKey` changes → `refresh` is recreated → the `[refresh]` effect re-runs and calls `void refresh()`, but the guard `if (inFlightRef.current) return;` makes it a no-op. The in-flight request then resolves and writes the **old-filter** rows into state, clears the guard, and schedules the next tick 30s out. No refetch for the new filter is ever issued.
- **Root cause**: A single boolean in-flight guard cannot distinguish "same request already running" from "a newer request with different args must supersede it." Filter identity isn't tracked.
- **Impact**: UX/correctness — the inbox shows rows that don't match the selected filter (and KPI/group counts computed off stale data) for up to a full refresh interval. Easy to hit by clicking a KPI tile or filter dropdown during the periodic poll.
- **Fix sketch**: Drop the early-return guard in favor of request-supersession: capture `filterKey` at call time, and on resolve only `setIncidents` if it's still the latest key (an `AbortController` or a monotonic request-id ref). At minimum, always re-run the fetch on `filterKey` change even if one is in flight.

## 2. Lifecycle commands return a boolean, but a `false` refusal is treated as success (success theater)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/overview/sub_incidents/libs/useIncidentActions.ts:24-37; src/features/overview/sub_incidents/components/IncidentDetailModal.tsx:113-123
- **Scenario**: `acknowledge/resolve/dismiss/reopen/setInProgress` all resolve to `boolean` (see api/overview/incidents.ts:33-52). Both call sites `await promise` and never inspect the result. If the backend refuses an invalid transition (e.g. reopen on an incident that isn't closed, resolve on an already-resolved row) and signals it by returning `false` rather than throwing, `handle()`/`run()` proceed as if it worked: `onAfterChange()`/refresh runs, no error toast fires, and the modal closes. The user believes the action succeeded when nothing changed.
- **Root cause**: The success contract is modeled as "did not throw," but the command's own boolean is the actual success signal and is discarded.
- **Impact**: UX/data-integrity — silent no-ops on state transitions; the "Back to open" (in_progress→reopen) and keyboard `r` paths are the most likely to hit a `false`.
- **Fix sketch**: In `handle`, capture `const ok = await promise;` and treat `!ok` like a failure (surface the action-failed toast, skip the close-on-success). Do the same in the modal's `run`.

## 3. `DEFAULT_LIMIT = 100` silently truncates the list; counts diverge from what's shown
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/overview/sub_incidents/libs/useIncidentsData.ts:10,40-44
- **Scenario**: `listAuditIncidents(filters, 100, 0)` caps the fetch at 100 rows with no pagination and no "showing 100 of N" affordance. The KPI header renders `summary.open` (a global count that can exceed 100), and `groups`/`newCount`/`visibleIncidents` are all computed off the truncated array. With >100 open incidents, the KPI says e.g. 250 while the grouped list only reflects 100, the "N new since last visit" marker undercounts, and older incidents are invisible with no signal they exist.
- **Root cause**: A hard client-side cap chosen for the common case, with no overflow indicator or "load more."
- **Impact**: UX/trust — headline numbers don't reconcile with the list; work silently hidden past row 100.
- **Fix sketch**: Either surface a truncation banner when `rows.length === DEFAULT_LIMIT` (and/or when `summary.open > rows.length`), or add offset-based "load more." At minimum, compare fetched length to the summary and warn.

## 4. Keyboard `r` triggers resolve on incidents of any status
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/overview/sub_incidents/components/IncidentsInbox.tsx:348-355
- **Scenario**: The `a` (acknowledge) shortcut guards `list[curIdx].status === 'open'`, but the `r` (resolve) shortcut has no status guard. Focusing an already-resolved or dismissed row and pressing `r` fires `resolveAuditIncident` on it, announces "Resolved: …" via the aria-live region regardless of outcome, and — per finding #2 — a `false`/refused return is swallowed. The a11y announcement asserts a change that may not have happened.
- **Root cause**: Asymmetric guarding between the two triage shortcuts.
- **Impact**: UX/a11y — doomed API calls on closed rows and a misleading screen-reader announcement.
- **Fix sketch**: Gate `r` on an active status (`status === 'open' || 'acknowledged' || 'in_progress'`) mirroring the modal's `isActive`, and only announce after the action resolves truthy.

## 5. `loading` is never reset on filter change — no spinner, stale rows shown during refetch
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/features/overview/sub_incidents/libs/useIncidentsData.ts:29,36-52
- **Scenario**: `loading` starts `true` and is only ever set `false` in the `finally`. On any subsequent filter change, `refresh()` runs but never sets `loading = true`, so `IncidentsInbox`'s `loading && incidents.length === 0` spinner branch can't trigger. The previous filter's rows stay on screen with no in-progress indication until the new fetch resolves (compounded by finding #1 if a fetch is already in flight).
- **Root cause**: `loading` models only the first-load, not per-fetch pending state.
- **Impact**: UX — no feedback that a filter change is being applied; stale content lingers.
- **Fix sketch**: Set `setLoading(true)` at the top of `refresh` (or expose a separate `refreshing` flag) so filter transitions get an indicator.

## 6. Dead code: `groupIncidentsByAgent` back-compat wrapper has no callers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/overview/sub_incidents/libs/groupIncidents.ts:119-122
- **Scenario**: Grepped the whole `src/` tree for `groupIncidentsByAgent` — the only hit is its own definition. The live caller (`IncidentsInbox`) uses `groupIncidents(incidents, groupMode, oldestFirst)` directly. The "back-compat wrapper for callers that only ever group by agent" has no such callers.
- **Root cause**: Leftover from the agent-only → multi-mode refactor of the grouping lib.
- **Impact**: maintainability — dead export invites future misuse and clutters the module.
- **Fix sketch**: Delete the wrapper (lines 119-122).

## 7. Dead code: `incidentRowSubtext` is exported but unused
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/overview/sub_incidents/libs/incidentDetail.ts:136-139
- **Scenario**: Grepped `src/` for `incidentRowSubtext` — only the definition matches. Rows (`IncidentRow.tsx`) render `incident.title` and never a normalized detail subtext; the modal uses `normalizeIncidentDetail` via `IncidentDetailBreakdown`. The "convenience for list rows" helper is orphaned.
- **Root cause**: Row design dropped the inline detail subtext; the helper wasn't removed.
- **Impact**: maintainability — dead surface area on the detail-normalization lib.
- **Fix sketch**: Remove `incidentRowSubtext` (and confirm nothing in tests references it), or wire it into the row if the inline subtext was intended.

## 8. Triplicated "open-only" filter constant + duplicated `isNarrowed` logic
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/overview/sub_incidents/components/IncidentsInbox.tsx:28-34,386-393; src/features/overview/sub_incidents/components/IncidentsFilterBar.tsx:29-35,88-94; src/features/overview/sub_incidents/components/IncidentsInboxKpiHeader.tsx:17-19
- **Scenario**: The identical `{ statuses: ['open'], severities: null, source_tables: null, persona_id: null, since: null }` object is hand-written three times as `DEFAULT_FILTERS`, `OPEN_ONLY_FILTERS`, and `OPEN_FILTERS` (the FilterBar copy even carries a "Mirrors DEFAULT_FILTERS" comment admitting the drift risk). The "narrowed past resting open-only" predicate is also implemented twice — `statusesAreDefaultOpen`/`isNarrowed` in the inbox and `statusNarrowed`/`isNarrowed` in the filter bar — with subtly different shapes.
- **Root cause**: No shared module for the incidents filter defaults/predicates; each component grew its own copy.
- **Impact**: maintainability — changing the resting view (e.g. adding a default severity) requires editing 3+ places; the predicates can silently diverge.
- **Fix sketch**: Extract `OPEN_ONLY_FILTERS` and an `isNarrowedFilters(filters)` helper into the libs folder (e.g. incidentColumns.ts's neighbor) and import them in all three components.
