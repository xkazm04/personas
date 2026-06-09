# UI Perfectionist — events-messages-notifications
> Total: 6
> Severity: 0 critical, 3 high, 2 medium, 1 low

## 1. Event status icon collapses 5 distinct statuses into one generic Clock — status not distinguishable by shape
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/overview/sub_events/components/EventLogList.tsx:248-261
- **Scenario**: In the Events table Status column, `pending`, `skipped`, `discarded`, `dead_letter` (and any unknown status) all render the SAME Clock icon. Only the color token differs (amber vs neutral vs red). A color-vision-deficient user — or anyone scanning fast — sees four rows with an identical clock glyph and cannot tell a skipped event from a pending one, or a dead-letter from a failure.
- **Root cause**: The `statusIcon` ternary only branches on `completed/delivered` (CheckCircle2), `failed` (AlertCircle), `processing` (spinner), and dumps everything else into `<Clock />`. Meanwhile `EVENT_STATUS_COLORS` (eventTokens.ts:106-115) defines 8 semantically distinct statuses. Status is encoded by color-plus-label but the glyph — the one cue independent of color — is not 1:1 with status.
- **Impact**: error-blind / inaccessible
- **Fix sketch**: Drive the icon from a status→icon map parallel to `EVENT_STATUS_COLORS` (e.g. `failed`/`dead_letter` → AlertCircle, `skipped`/`discarded` → MinusCircle/Ban, `pending` → Clock, `processing` → spinner, `completed`/`delivered` → CheckCircle2). Add the icon map to `eventTokens.ts` next to the colors so the two stay in lockstep and every status is shape-distinct.

## 2. Dead duplicate config file with DIVERGENT delivery/priority colors
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/overview/sub_messages/messageListConstants.ts:6-58
- **Scenario**: A maintainer editing message priority or delivery-status colors will likely edit `messageListConstants.ts` (the obvious-sounding file) and see zero visual change, because the components actually import from `libs/messageHelpers.ts`. The two files define `priorityConfig` and `deliveryStatusConfig` with DIFFERENT values — e.g. delivered is `text-status-success` in constants vs `text-emerald-400` in helpers; low priority is `bg-muted/20` vs `bg-transparent border-dashed`.
- **Root cause**: `messageListConstants.ts` is never imported anywhere (confirmed: no references in `src/`). It is a stale fork of `messageHelpers.ts` left after a refactor. Two sources of truth for the same status visual language guarantees future drift.
- **Impact**: inconsistency
- **Fix sketch**: Delete `messageListConstants.ts`. If any token there is genuinely wanted (the status-token classes `text-status-success/error/pending/processing` are arguably the more correct, theme-aware choice than the literal `emerald/red/amber/blue-400` in helpers), fold it into `messageHelpers.ts` so there is exactly one config.

## 3. Delivery and Pending-decisions sections render nothing while loading — content silently pops in
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/overview/sub_messages/components/MessageDetailModal.tsx:699,720
- **Scenario**: Opening a message detail, Section III (Delivery) and Section IV (Pending decisions) show only their header + hairline rule, then — after the async fetch resolves — pills/cards appear with no transition. The user can't tell whether the section is empty, still loading, or broken. `deliveriesLoading`/`reviewsLoading` both short-circuit to `null`.
- **Root cause**: `{deliveriesLoading ? null : ...}` and `{reviewsLoading ? null : ...}` treat the loading state as "render nothing", so there is no skeleton or spinner during the in-flight `getMessageDeliveries` / `listManualReviews` calls.
- **Impact**: unpolished / confusion
- **Fix sketch**: Replace the `null` branch with a lightweight placeholder — a row of 2 muted pill skeletons for Delivery, one card skeleton for Pending decisions (or a small inline `Loader2` + "Checking deliveries…"). Matches the flat list, which already uses `ListSkeleton`.

## 4. Failed delivery fetch is indistinguishable from "no channels"
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/overview/sub_messages/components/MessageDetailModal.tsx:123-129,699-702
- **Scenario**: If `getMessageDeliveries` throws (IPC error, backend down), the `.catch(() => setDeliveries([]))` swallows it and the Delivery section renders the same "No channels" italic copy as a message that genuinely had no deliveries. The user sees a confident "No channels" when the truth is "we couldn't load this".
- **Root cause**: The catch handler collapses the error path into the empty-success path (`[]`), and there is no error flag in component state to branch the render on.
- **Impact**: error-blind
- **Fix sketch**: Track a `deliveriesError` boolean; on catch, render a quiet inline error ("Couldn't load delivery status — retry") with a small retry button instead of the empty-state copy. Same pattern for the `listManualReviews` catch in Section IV.

## 5. Unread "New" indicator is ad-hoc and inconsistent between flat rows and thread replies
- **Severity**: low
- **Category**: component-extraction
- **File**: src/features/overview/sub_messages/components/MessageList.tsx:424-429,551
- **Scenario**: The flat-list "read" column shows a `w-2.5 h-2.5` blue dot + a hardcoded literal `New` string (line 551, NOT localized — every other label here uses `t.*`), while thread replies (lines 424-429) show a `w-2 h-2` dot + the localized `t.overview.messages_view.new_badge`. Same concept, two different dot sizes and two different label sources side by side.
- **Root cause**: The unread badge markup is inlined twice with copy-pasted-but-drifted classes; the flat-list copy was hand-typed (`New`) instead of using the existing `new_badge` token used by the threaded copy.
- **Impact**: inconsistency
- **Fix sketch**: Extract an `<UnreadBadge size?>` component (dot + uppercase label) into `sub_messages/components`, use the localized `t.overview.messages_view.new_badge` in both, and render it in the flat row and the thread reply. Removes the un-localized literal and unifies the dot size.

## 6. Status column visual language differs between the Events table and the Messages flat list
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/overview/sub_messages/components/MessageList.tsx:507-519,551
- **Scenario**: Both tabs sit in the same Overview area and both have a "Status" column, but they speak different visual dialects: Events renders a full pill (icon + colored text + border, EventLogList.tsx:255-260) reflecting the real delivery/processing state; Messages renders only a tiny read/unread dot under a column literally headed "Status" (MessageList.tsx:551), which conveys read-receipt, not delivery state. A user moving between tabs has to re-learn what "Status" means and loses the at-a-glance "did this land" cue that the message's own ChannelDeliveryPill already knows.
- **Root cause**: The Messages flat list conflates "read state" with "Status" and never surfaces the per-message aggregate delivery outcome in the row, even though `deliveryStatusConfig` + `ChannelDeliveryPill` exist for the detail modal. The two list surfaces were designed independently.
- **Impact**: inconsistency
- **Fix sketch**: Either (a) rename the Messages column header to "Read" so it stops overloading "Status", or (b) better, show a compact delivery-outcome glyph (worst-of channel statuses: failed > pending > delivered) using the shared `deliveryStatusConfig` icon/ring so the column matches the Events status pill's icon+color language, and keep the unread dot as a separate leading accent (the row already has the blue left-border for unread).
