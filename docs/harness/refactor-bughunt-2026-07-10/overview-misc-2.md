> Context: overview (misc 2)
> Total: 8
> Critical: 0  High: 0  Medium: 3  Low: 5

## 1. `.filter(Boolean)` strips every intended blank-line separator from the summarise prompt
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/overview/sub_messages/libs/chatSeed.ts:22-34
- **Scenario**: The prompt array interleaves content lines with `` (empty string) spacers to visually separate the Persona / Execution / content / "Cover:" sections. The final `.filter(Boolean).join('\n')` removes ALL falsy entries — which includes every deliberate `''` spacer — so the composed prompt renders as one dense block with no blank lines between sections.
- **Root cause**: `filter(Boolean)` was meant to drop only the conditional `reviewBullets ? … : ''` empty case, but it indiscriminately drops the intentional spacer lines too.
- **Impact**: UX / prompt quality — the auto-sent "Play in chat" prompt is harder to read and the section framing the comment promises is lost; a Playwright spec asserting exact composer content (per the file's own comment) would see collapsed output.
- **Fix sketch**: Only strip the optional bullets line, e.g. build the array with `reviewBullets ? [\n...\n] : []` spread in, then `.join('\n')` without the blanket `filter(Boolean)`; or filter only `null/undefined` (`.filter((l) => l != null)`).

## 2. `lastSyncedIso` sorts numeric epoch timestamps lexicographically
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/overview/sub_missionControl/DashboardHomeMissionControl.tsx:220-223
- **Scenario**: `pipelineFetchedAt` is typed `Record<string, number>` (overviewSlice.ts:74). `Object.values(pipelineFetchedAt).filter(Boolean).sort().pop()` uses `Array.prototype.sort` with no comparator, which coerces the numbers to strings and sorts lexicographically. If two sources' timestamps ever differ in digit count (e.g. a mocked/legacy value, or a future epoch-second vs epoch-ms mix), `.pop()` returns the lexicographically-largest, not the most-recent, so "synced" shows the wrong time.
- **Root cause**: Missing numeric comparator; relies on all epoch-ms values being equal-length 13-digit strings.
- **Impact**: UX — a stale/incorrect "last synced" label in the status ticker under rare value-magnitude mismatch. Works today because all values are same-length ms timestamps.
- **Fix sketch**: `Math.max(...Object.values(pipelineFetchedAt).filter(Boolean))` (guarding empty), or `.sort((a, b) => a - b)`.

## 3. VaultRecentChangesCard hides itself silently if the sync-log fetch fails
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/overview/sub_missionControl/cards/VaultRecentChangesCard.tsx:39-61
- **Scenario**: When `obsidianBrainGetConfig()` resolves truthy but the chained `obsidianBrainGetSyncLog(MAX_ROWS)` rejects, the `.catch(silentCatch(...))` swallows the error and `setLoaded(true)` is never reached. Because the component returns `null` while `!loaded`, the card vanishes entirely with no error/empty state — indistinguishable from "not configured".
- **Root cause**: `loaded` is only set on the success branches; the terminal `.catch` doesn't restore a rendered state.
- **Impact**: UX — a transient obsidian-brain RPC failure makes a configured user's Vault card silently disappear until remount, masking a real backend error.
- **Fix sketch**: In the `.catch`, still `setLoaded(true)` (and optionally a lightweight error/empty state) so the card renders instead of disappearing.

## 4. UpcomingRoutinesCard "overdue" rendering is unreachable
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:13-28, 108, 150-153
- **Scenario**: `formatRelative` computes `overdue` and returns a `-`-prefixed label with `overdue: true`, and the row renders `text-rose-400` when `row.rel.overdue`. But the memo's filter (`row.nextAt === null || new Date(row.nextAt).getTime() >= now`) drops every past `nextAt` using the same `now`, so any surviving row has `diffMs >= 0` → `overdue` is always `false`. The rose overdue styling and `-`-prefix code paths can never execute.
- **Root cause**: The past-run filter was added later (per the in-file comment) and made the pre-existing overdue branch dead, but the branch was left in.
- **Impact**: Maintainability — dead conditional invites confusion (a reader believes overdue rows can render here). No user-visible effect.
- **Fix sketch**: Either drop the `overdue` field / rose styling and the `-` prefix, or intentionally keep a small grace window (`>= now - GRACE_MS`) if showing just-overdue runs is desired.

## 5. Dead exports in messageHelpers: FILTER_LABELS, FilterType, COLUMN_WIDTHS, GRID_TEMPLATE_COLUMNS
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/features/overview/sub_messages/libs/messageHelpers.ts:25-40
- **Scenario**: Grepped every importer of this module. `priorityConfig`, `MESSAGE_ROW_HEIGHT` (MessageList), and `deliveryStatusConfig`, `channelLabels` (ChannelDeliveryPill) are used. But `FILTER_LABELS`/`FilterType`, `COLUMN_WIDTHS`, and `GRID_TEMPLATE_COLUMNS` have no external importers — the two other `FILTER_LABELS` in the codebase are local consts in GlobalExecutionList and reviewHelpers, and `GRID_TEMPLATE_COLUMNS` (a grid-row template) is unused because MessageList renders via `useVirtualList`, not a CSS grid.
- **Root cause**: Leftovers from an earlier table/grid-based message list that was replaced by the virtualized row list.
- **Impact**: Maintainability — ~15 lines of unused config that implies a grid layout that no longer exists.
- **Fix sketch**: Delete `FilterType`, `FILTER_LABELS`, `COLUMN_WIDTHS`, and `GRID_TEMPLATE_COLUMNS`; keep the four exports that are actually consumed.

## 6. Duplicated relative-time formatter across the two dashboard cards
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:13-29 & cards/VaultRecentChangesCard.tsx:13-25
- **Scenario**: `formatRelative` and `formatTime` both parse an ISO string, guard `NaN`, and bucket a delta into `now`/`Nm`/`Nh`/`Nd` with the same 60_000/3_600_000/86_400_000 divisors. The only real differences are the future-vs-past sign and the 48h-vs-24h hour cutoff.
- **Root cause**: Each card grew its own copy of the same humanize-duration logic.
- **Impact**: Maintainability — two places to fix if the buckets/thresholds change.
- **Fix sketch**: Extract a shared `formatRelativeShort(iso, { now, signed })` helper (co-locate with the other overview libs) and have both cards call it.

## 7. Duplicated color→class maps between SlaCard and SLADashboard's CompactMetric
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/overview/sub_sla/components/SLACard.tsx:21-30 & components/SLADashboard.tsx:179-188
- **Scenario**: `SlaCard`'s `colorMap` and `CompactMetric`'s `colorMap` both translate the same string tokens (`emerald`/`amber`/`red`/`blue`/`violet`/`neutral`) to Tailwind classes, and both carry the identical "neutral = never red" comment. They diverge only in that one uses `healthClasses(...)` (full card style) and the other bare text tints, but the token set and the neutral fallback are copy-pasted.
- **Root cause**: Two renderers of the same metric palette hand-maintain parallel maps.
- **Impact**: Maintainability — adding a color token means editing two maps in sync.
- **Fix sketch**: Centralize the token list (and neutral fallback) next to `slaColor`/`statusTokens`; derive both variants from one source, or at least share the key set.

## 8. PaneHeader and CardHeader are near-identical header primitives
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/overview/sub_missionControl/DashboardHomeMissionControl.tsx:793-807 & cards/UpcomingRoutinesCard.tsx:165-179
- **Scenario**: `PaneHeader` (label + optional subtitle + children slot) and `UpcomingRoutinesCard`'s `CardHeader` (label + subtitle + trailing arrow) render the same `flex items-center justify-between px-3 py-2 border-b border-primary/10 bg-primary/[0.04]` header with the same typo-caption label/subtitle treatment. `CardHeader` is essentially `PaneHeader` with a fixed `<ArrowRight/>` child.
- **Root cause**: The card was authored separately from the mission-control panes and re-implemented the pane header rather than reusing it.
- **Impact**: Maintainability — header styling drift risk across the overview cards.
- **Fix sketch**: Export `PaneHeader` (or a shared `SectionHeaderBar`) and have `UpcomingRoutinesCard` pass `<ArrowRight/>` as its `children`.
