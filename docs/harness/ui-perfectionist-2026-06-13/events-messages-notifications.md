> Total: 9 findings (0 critical, 4 high, 4 medium, 1 low)

Audit of the events feed + messages/notifications surfaces. The dominant theme: the **Events** list is built on the catalog `UnifiedTable` (grouping, accent, scroll-restore, skeleton all for free), while the **Messages** flat list hand-rolls an equivalent virtualized grid — so two chronological row lists that should look and behave identically diverge in density, separators, time-grouping, and badge styling.

---

## 1. Messages flat list hand-rolls a virtualized grid instead of using UnifiedTable
- **Severity**: high
- **Category**: reuse
- **File**: src/features/overview/sub_messages/components/MessageList.tsx:471-558
- **Problem**: The flat message list builds its own `role="grid"` + `useVirtualList` + sticky header + `ColumnResizeHandle` + manual `translateY` virtual rows. The sibling Events list (`EventLogList.tsx:413`) renders the same shape — sortable columns, per-row status accent, persona/priority/created columns, day-grouping, empty state — through `UnifiedTable`. Maintaining two parallel implementations guarantees drift (and it already has: see findings 2, 3, 6). A user toggling between Events and Messages sees subtly different row heights (44 vs 56), header treatments, and grouping behavior.
- **Fix sketch**: Migrate the flat view to `UnifiedTable<PersonaMessage>` with `TableColumn` defs mirroring `EventLogList`'s columns, `rowAccent` for high/unread, and `groupBy` for day buckets. Drop the bespoke `useVirtualList`/`ColumnResize`/`role=grid` block. The threaded view can stay custom (it's a tree, not a flat list).

## 2. Events list has sticky day-group headers; Messages list has none
- **Severity**: high
- **Category**: hierarchy
- **File**: src/features/overview/sub_messages/components/MessageList.tsx:527 (flat rowgroup)
- **Problem**: `EventLogList.tsx:149-156,431` buckets rows under sticky Today/Yesterday/… headers via `timeGroupKey`/`timeGroupLabels` + `UnifiedTable groupBy`. The Messages flat list is an undifferentiated chronological stream with no temporal wayfinding, so in a busy inbox the user cannot tell where "today" ends. Two adjacent chronological surfaces should not differ on this core readability affordance.
- **Fix sketch**: Apply the same `timeGroupKey`/`timeGroupLabels` grouping (passed to `UnifiedTable groupBy` once finding 1 lands, or as section headers if kept custom) so message rows get the same sticky day separators as events.

## 3. "New" badge uses raw `text-[10px]` + ad-hoc blue instead of type ramp + statusTokens
- **Severity**: high
- **Category**: token
- **File**: src/features/overview/sub_messages/components/MessageList.tsx:427, 551 (and dot 426, 551)
- **Problem**: The unread "New" badge is `text-[10px] font-semibold uppercase tracking-wide text-blue-400` with a `w-2 h-2 rounded-full bg-blue-500` dot, hand-written in two places (thread reply + flat row). `text-[10px]` is an off-ramp literal that fights `typography.css`; `bg-blue-500`/`text-blue-400` duplicate what `statusTokens` (`info`) centralizes; and `bg-blue-500` is a non-theme color that won't follow theme/light-mode parity. The same badge is copy-pasted, so the two instances can drift.
- **Fix sketch**: Extract an `UnreadBadge` (or use an existing catalog `Badge`/`StatusDot`) driven by `statusTokens.info` for the dot tint and a real ramp class (`typo-caption`/`typo-label`) instead of `text-[10px]`. Render it once, reuse in both rows.

## 4. `defaultStatus` fallback hard-codes amber instead of EVENT_STATUS_FALLBACK
- **Severity**: medium
- **Category**: token
- **File**: src/features/overview/sub_events/components/EventLogList.tsx:29
- **Problem**: `const defaultStatus = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' }` is a raw literal that shadows the canonical `EVENT_STATUS_FALLBACK` already exported from `eventTokens.ts` (a neutral gray). An unknown status will render amber ("warning") here but gray everywhere else that uses the token — an inconsistency in the single surface meant to be authoritative about event status color.
- **Fix sketch**: Import and use `EVENT_STATUS_FALLBACK` from `@/lib/design/eventTokens` for the fallback (`EVENT_STATUS_COLORS[event.status] ?? EVENT_STATUS_FALLBACK`); delete the local literal.

## 5. MessageDetailModal renders timestamps as static strings instead of RelativeTime/AbsoluteTime
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/overview/sub_messages/components/MessageDetailModal.tsx:495, 900, 342
- **Problem**: The modal subtitle (`formatRelativeTime(message.created_at)`, :495) and the pending-decision card (`formatRelativeTime(review.created_at)`, :900) render frozen strings — they don't tick, and they lack the hover-exact absolute tooltip that the catalog `RelativeTime` provides and that the list rows on the same screen already use (`ChannelDeliveryPill` and `MessageList` both use `RelativeTime`). The PDF export at :342 uses `toLocaleString()` (acceptable for print HTML, noted only for completeness).
- **Fix sketch**: Replace the two on-screen `formatRelativeTime(...)` calls with `<RelativeTime timestamp={...} />` so the detail view matches the list rows and gets live updates + exact-time tooltip.

## 6. Two different empty-state components across sibling surfaces
- **Severity**: medium
- **Category**: hierarchy
- **File**: src/features/overview/sub_messages/components/MessageList.tsx:335,459 vs src/features/overview/sub_events/components/EventLogList.tsx:401
- **Problem**: Events uses `EmptyState`; Messages uses `IllustrationEmptyState`. Both take the same `{icon,title,subtitle,action,secondaryAction}` shape and the same CTAs ("Create persona" / "From templates"), but render with different visual weight. Adjacent overview tabs presenting different empty-state chrome reads as unintentional rather than a deliberate hierarchy choice.
- **Fix sketch**: Pick one per the design system's intended tier (the illustrated variant for primary feeds, or `EmptyState` for both) and apply it consistently to Events and Messages. If `IllustrationEmptyState` is the richer/intended one, adopt it in `EventLogList` too.

## 7. EventLogList hand-rolls the search input + filter/save/clear buttons
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/overview/sub_events/components/EventLogList.tsx:303-339, 371-394
- **Problem**: The search field is a raw `<input>` with `focus:outline-none focus:border-primary/30` (re-implementing focus styling instead of the `focus-ring` utility) and a hand-built clear-button; the Save/Clear/Save-view-dialog actions are raw `<button>`s with bespoke padding/tone classes. The catalog provides `Button` and form-field primitives (used by `MessageDetailModal`), so these should not be hand-rolled — and the raw `focus:outline-none` without a replacement ring is an a11y/keyboard-visibility regression.
- **Fix sketch**: Use the catalog search-input / `Button` components (matching `MessageDetailModal`'s `Button` usage), and apply the `focus-ring` globals utility instead of `focus:outline-none focus:border-...` so keyboard focus stays visible and themed.

## 8. Thread reply-count and "decisions" pills use ad-hoc indigo/primary instead of tokens
- **Severity**: low
- **Category**: token
- **File**: src/features/overview/sub_messages/components/MessageList.tsx:384 (reply count) and MessageDetailModal.tsx:876 (decisions count)
- **Problem**: The reply-count pill (`bg-indigo-500/10 text-indigo-400 border border-indigo-500/20`) and the decisions-count pill duplicate count-badge styling inline with non-semantic raw colors. The codebase has badge primitives; these one-off pills will drift in radius/tint from the rest of the app's count chips.
- **Fix sketch**: Replace with a catalog `Badge`/count-chip (info tone). If kept inline, source the tint from `statusTokens.info` rather than literal `indigo-500/*`.

## 9. ChannelDeliveryPill error text uses raw red instead of statusTokens.error
- **Severity**: medium
- **Category**: token
- **File**: src/features/overview/sub_messages/components/ChannelDeliveryPill.tsx:60; EventDetailContent.tsx:60-62
- **Problem**: The delivery-error text is `text-red-400/80` and the event-detail error block is `text-red-400` / `bg-red-500/5` — raw status colors that bypass `statusTokens.error` (`text-status-error` / `bg-status-error/*`). These are the exact "error" surface the token exists to own, so they should not hand-pick red. Non-theme red also breaks light-mode parity.
- **Fix sketch**: Use `statusTokens.error` classes (`text-status-error`, `bg-status-error/5`) for both the pill error text and the `EventDetailContent` error `<pre>`/label, matching how `EVENT_STATUS_COLORS` already routes failed events through `status-error`.
