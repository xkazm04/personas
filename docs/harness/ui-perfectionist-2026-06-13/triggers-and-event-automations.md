# UI Perfectionist — triggers-and-event-automations

> Total: 9 findings (0 critical, 4 high, 4 medium, 1 low)

Scope reviewed: `TriggersPage.tsx`, `sub_builder/` (EventCanvas, UnifiedRoutingView, routing/RoutingView, EventRow, Toolbar, ExpandedDrawer), `sub_cloud_webhooks/CloudWebhooksTab.tsx`, `sub_smee_relay/SmeeRelayTab.tsx`.

---

## 1. Raw `<select>` instead of catalog `Listbox`/`ThemedSelect`
- **Severity**: high
- **Category**: reuse
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:198; src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:267
- **Problem**: Both create-forms use a hand-styled native `<select>` (`bg-secondary/30 border-border/40 focus:ring-blue-500/40`). The catalog explicitly ships `Listbox` ("Accessible select/listbox dropdown. Use instead of raw `<select>` or custom dropdowns") and `ThemedSelect`. Native selects render the OS dropdown chrome (system font, no theme), breaking visual parity with every other picker in the app and ignoring the per-tab accent. This is the codebase's #1 reuse rule — "never hand-roll a select."
- **Fix sketch**: Replace both with `@/features/shared/components/forms/Listbox` (or `ThemedSelect`), passing persona options; drop the bespoke focus-ring classes.

## 2. Status colors hard-coded instead of `statusTokens`
- **Severity**: high
- **Category**: token
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:331-334; src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:367,372-376
- **Problem**: Firing status (`text-emerald-400` / `text-red-400` / `text-amber-400`) and relay status pills (emerald/amber/red bg+border+text triplets) are spelled out by hand. `src/lib/design/statusTokens.ts` is the single source of truth (success/warning/error → text/bg/border classes), and the catalog ships `StatusBadge` ("Status pill mapping a status token to label + color") and `StatusDot`. Each surface inventing its own success=green mapping is exactly the deviation the token system exists to prevent, and the two files already disagree subtly (firing uses bare text color; relay uses a full pill).
- **Fix sketch**: Map `completed/active`→success, `failed/error`→error, `paused`→warning via `statusTokens`, and render the relay pill with `StatusBadge`, the firing status with the success/error/warning text token.

## 3. Live/connection dots hand-rolled instead of `LiveStatusDot`
- **Severity**: high
- **Category**: reuse
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:146; src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:151-153,366-368
- **Problem**: The "connected/active" liveness dot is re-implemented three times as `w-2 h-2 rounded-full bg-emerald-400 animate-pulse` with a muted fallback. The catalog ships `LiveStatusDot` with this exact shared vocabulary ("off=muted, active=emerald, syncing=amber-pulse, optional ping halo"). The "connecting" state here shows a static muted dot with no syncing/pulse cue, diverging from the shared component's syncing affordance.
- **Fix sketch**: Use `@/features/shared/components/display/LiveStatusDot` with `active`/`syncing`/`off` states so connecting animates consistently with the rest of the app.

## 4. Two visually different inline-action button styles across sibling tabs
- **Severity**: high
- **Category**: reuse
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:182-188,212-219; src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:190-196,300-307
- **Problem**: Every primary action (Add webhook, Create webhook, Add relay, Create relay) is a raw `<button>` with bespoke `bg-blue-500/10 …` / `bg-purple-500/15 …` recipes. The catalog ships `Button`; hand-rolled buttons here means no shared `focus-ring`, no shared disabled treatment (they use ad-hoc `disabled:opacity-50`), and the two tabs encode the same "tinted primary action" pattern with slightly different padding (`py-1.5` header vs `py-2` form) and alpha ramps. A user moving between the Smee and Cloud tabs sees two dialects of the same button.
- **Fix sketch**: Adopt `@/features/shared/components/buttons/Button` with a tonal/accent variant; pass the per-tab accent color as a prop so focus/disabled/hover come from the shared utility (`focus-ring`, `is-disabled`).

## 5. `formatRelativeTime` string instead of `RelativeTime` component
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:164,276,338; src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:393
- **Problem**: Times are rendered as plain strings via `formatRelativeTime(...)`. The catalog ships `RelativeTime`/`AbsoluteTime`, which the reference flags as the canonical replacement for raw formatted timestamps — these auto-tick and expose the absolute time on hover (`title`). Static strings here go stale until the next data fetch and give no hover affordance for the exact timestamp, which matters for "last poll" / "last fired" debugging.
- **Fix sketch**: Replace the inline calls with `@/features/shared/components/display/RelativeTime` (date prop), keeping the surrounding label.

## 6. Manual confirm-delete in Smee vs no-confirm delete in Cloud — inconsistent destructive UX
- **Severity**: medium
- **Category**: state-coverage
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:297-303 (vs) src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:433-456
- **Problem**: Smee relays use an inline two-step confirm (Trash → Confirm/Cancel), but the Cloud webhook trash icon deletes immediately on click with no confirmation and no undo. Two sibling tabs in the same builder treat the identical destructive action with opposite safety levels; the Cloud path is a one-click data-loss footgun. Smee's confirm is also a hand-rolled inline pair rather than a shared pattern.
- **Fix sketch**: Standardize on one destructive pattern — either the inline confirm or a shared `ConfirmButton`/confirm dialog — and apply it to the Cloud delete too.

## 7. `cursor.toFixed(4)` cost / raw `${ms}ms` instead of `Numeric`
- **Severity**: medium
- **Category**: reuse
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:341,344
- **Problem**: Duration (`${f.durationMs}ms`) and cost (`$${f.costUsd.toFixed(4)}`) are formatted ad-hoc. The reference calls out `Numeric` as the replacement for `toFixed`/`toLocaleString`. Hand-formatting means no locale grouping, fixed 4-decimal cost even for `$0.0000`, and no consistency with cost/latency displays elsewhere. The firing table is also a hand-built CSS-grid "table" where `UnifiedTable` is the catalog primitive.
- **Fix sketch**: Format cost/duration via `@/features/shared/components/display/Numeric`; longer term, render the firings list with `UnifiedTable` to inherit header/row tokens.

## 8. `text-[10px]` / `text-[9px]` micro-type and uppercase labels fight the type ramp
- **Severity**: medium
- **Category**: hierarchy
- **File**: src/features/triggers/sub_builder/layouts/routing/ExpandedDrawer.tsx:31,43,87,92; src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:372,488
- **Problem**: The builder's most information-dense surface (the expanded drawer) labels Sources/Listeners at `text-[10px]` and chain/capability badges at `text-[9px]` — below the `typo-caption` floor defined in `typography.css`. Arbitrary sub-10px sizes are a readability risk and bypass the type ramp; the Smee status pill and SetupGuide numerals repeat the same `text-[10px]` ad-hoc size. These are the labels a user scans to understand routing, so sub-legible text here undercuts the whole builder's purpose.
- **Fix sketch**: Use `typo-label`/`typo-caption` ramp tokens (or a `SectionLabel`) for the Sources/Listeners headers and `Badge` for the chain/capability chips instead of raw `text-[9px]`/`text-[10px]`.

## 9. Icon-only / checkbox controls missing `focus-ring` and accessible labels
- **Severity**: low
- **Category**: a11y
- **File**: src/features/triggers/sub_builder/layouts/routing/Toolbar.tsx:31,36,56-62; src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:167-173
- **Problem**: The Toolbar reload button and the two raw `<input type="checkbox">` toggles rely on `title=` only and have no `focus-ring`/`aria-label`; the checkboxes use `accent-primary`/`accent-emerald-400` native styling rather than the catalog `AccessibleToggle`. The Cloud refresh button likewise is `title`-only with no `aria-label` and no shared focus state. `title` is not a substitute for `Tooltip`/`aria-label`, and these controls won't show a visible focus ring for keyboard users.
- **Fix sketch**: Add `aria-label` + globals `focus-ring` to the icon buttons (or wrap with `Tooltip`), and replace the raw checkboxes with `AccessibleToggle`.
