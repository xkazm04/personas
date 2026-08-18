---
layer: application
subject: modal-stack
technique: destructive-confirmation
stack: react
---

# ConfirmDialog + ConfirmDestructiveModal — proportional friction in this repo

The repo implements the technique's two friction tiers as two shared
primitives, both composed on `BaseModal` (so they inherit stacking, escape
gating, and focus behavior for free), plus a hook that keeps call sites
declarative.

## Tier 1 — lightweight: `ConfirmDialog`

`src/features/shared/components/feedback/ConfirmDialog.tsx` replaces the
OS-native `confirm()`:

- `danger` switches the confirming button to the rose danger treatment
  (`:84-88`) — one danger idiom, reused, so red reads as red reflexively.
- `confirmLabel` / `cancelLabel` let call sites supply the **verb**; the
  defaults are generic `t.common.confirm` / `t.common.cancel` (see
  shortfalls).
- **Confirm-then-fail is handled**: `onConfirm` may return a promise; while
  pending, `busy` disables both buttons, sets `aria-busy`, and the same flag
  makes `handleCancel` a no-op — so escape and backdrop dismissal are inert
  mid-flight (`:37-55`). Double-click, trackpad bounce, and impatient retry
  cannot fire the action twice; if the action throws, the dialog re-enables
  for retry rather than closing optimistically (`:44-49`).
- Light dismissal means "keep": `onClose={handleCancel}` — escape and
  backdrop resolve as the safe choice, never as confirm.

## Tier 2 — heavyweight: `ConfirmDestructiveModal` + `useConfirmDestructive`

`src/features/shared/components/overlays/ConfirmDestructiveModal.tsx`
escalates friction exactly along the technique's ladder:

- **Names the object and consequence**: `title` + `message` + optional
  `details` key-value rows (`:84-93`) putting the blast target on screen by
  name, and a `warningMessage` banner for the permanent-loss statement.
- **Explicit scope acknowledgment**: the `blastRadius?: ReactNode` slot
  (`:19-22`) renders host-provided impact UI (e.g. `BlastRadiusPanelLazy`)
  above the actions — the host owns fetching so the primitive stays
  domain-free.
- **Typed confirmation**: `requireTypedConfirmation` (`:23-27`, `:106-124`)
  gates the destructive button on typing the exact object name —
  recognition converted to recall, reserved by convention for high-impact
  deletions (persona names, credential names).
- **The safe action is the default**: cancel precedes the destructive button
  in source order, and `BaseModal`'s initial-focus rule ("first focusable",
  `BaseModal.tsx:187-196`) therefore lands on cancel — the destructive
  action is never pre-armed. With typing required it is also `disabled`
  until the name matches (`:138`).
- `useConfirmDestructive()` (`:189-217`) owns open/config state so call
  sites write `confirm({ title, message, onConfirm })` and render
  `<ConfirmDestructiveModal {...modal} />` — one door, no scattered
  booleans.

The unsaved-work sibling — `UnsavedChangesModal` +
`useUnsavedGuard` (`src/hooks/utility/interaction/useUnsavedGuard.ts`) —
shows the same resolution discipline from the dismissal technique: three
distinguishable exits (`save` / `discard` / `stay`), all dismissal gestures
resolving to `stay`, and a failed save returning the user to the page
instead of navigating over the wreckage (`:124-133`).

## Where the repo falls short of the standard (kept, not hidden)

- **Default labels are not verbs.** `ConfirmDialog` falls back to
  `Confirm`/`Cancel`; the technique wants the verb on the button
  ("Delete project"). The prop exists; the default should be treated as a
  last resort, and `ConfirmDestructiveModal`'s default (`t.common.delete`)
  is closer to right.
- **Initial focus lands on cancel by accident, not by contract.** It is a
  consequence of source order plus first-focusable — reordering the action
  row would silently pre-arm the destructive button. Nothing encodes "focus
  the safe action" as an intention.
- **No undo tier.** The repo's ladder starts at confirmation; the
  technique's first rung — perform-then-undo for reversible actions — has
  no shared primitive, so reversible flows tend to get a `ConfirmDialog`
  they should not need.
- **Typed input auto-focuses** (`:121`), which is correct here (the field is
  the arming mechanism, not the trigger), but note the enter key in that
  field must not submit while the name mismatches — currently guarded only
  by the button's `disabled`.
