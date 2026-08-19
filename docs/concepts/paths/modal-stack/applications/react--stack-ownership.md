---
layer: application
subject: modal-stack
technique: stack-ownership
stack: react
---

# ModalStackContext + BaseModal — how this repo owns the overlay stack

This repo realizes stack ownership in the **registry variant** the technique
describes: overlays are rendered by scattered owners (129 `<BaseModal>` render
sites across 128 files, measured 2026-08-17 by the legacy corpus sweep in
`docs/concepts/golden-paths/modal-stacking.md`), so there is no single render
fold — instead every modal joins a central registry on open, and the registry
alone answers ordering.

## The registry

`src/lib/ui/ModalStackContext.tsx` — `ModalStackProvider`, mounted once at
`App.tsx:310`:

- `register()` mints a monotonically increasing id and appends
  (`ModalStackContext.tsx:36-43`); `unregister(id)` removes by identity
  (`:45-51`). Registry order is open order, no sorting to get wrong.
- `isTopmost(id)` reads the **last** entry (`:59-62`); `getDepth`/`getTotal`
  expose position; a subscriber `Set` (`:64-69`) re-renders registrants when
  the stack changes, so escape gating and progressive backdrop dimming react
  when a sibling opens.
- `useModalStackPosition(isOpen)` (`:93-122`) is the sole consumer surface:
  registers while open, unregisters in the effect cleanup (creation names its
  reaper), returns `{ depth, total, isTopmost }`.

`BaseModal` (`src/lib/ui/BaseModal.tsx`) is the one door to the registry — no
call site touches the context directly. Top-of-stack input ownership is four
lines at `:198-203`: `if (!isTopmost) return false;` *before* `onClose()`,
returning `true` to stop the app keyboard ladder (`AppKeyboardProvider.tsx`,
BaseModal registered at priority 80). A non-topmost modal declines the key
rather than consuming it — the technique's "top owns input", exactly.

## Typed entries, locally

The technique's typed push/pop form exists at feature scope:
`src/features/templates/sub_generated/gallery/modals/useModalStack.ts` — a
generic stack over a discriminated union (`{ type: 'detail'; item } | …`),
with `open`/`close`/`replace`/`closeAll`/`find`/`top`. Adding a modal to the
gallery is one union member, zero new state variables. Its `close(type)`
removes the *most recent entry of that type* (`:37-49`) — identity by kind
rather than by position, honoring "never pop index 2". This hook and the
app-wide registry compose cleanly: the hook decides *which* entries exist,
the registry (via the `BaseModal` each entry renders) decides *ordering*.

## Sub-modals in practice

`ConfirmDialog` (`src/features/shared/components/feedback/ConfirmDialog.tsx`)
is the modal most often opened on top of another; it is 50 lines with zero
overlay code — it renders `BaseModal portal` and inherits stacking. Stacked
depth is visible in the backdrop: topmost gets `bg-black/60
surface-blur-modal`, buried layers `bg-black/30` (`BaseModal.tsx:179-181`).

## Where the repo falls short of the standard (kept, not hidden)

- **Entries are positions, not identities.** `ModalStackEntry` is
  `{ id: number }` (`ModalStackContext.tsx:12-14`) — no kind, no payload. The
  registry variant's stated cost is fully paid here: nothing outside a modal
  can ask "is any modal open?", so the command palette, tour, and toast
  layers negotiate precedence by hand-picked z-index instead of querying.
- **Escape is gated on topmost; the backdrop click is not.**
  `onClick={onClose}` (`BaseModal.tsx:283`) has no `isTopmost` check. Safe
  only while paint order matches stack order — which the two-base z scheme
  (`Z_INDEX_BASE = 50` vs `Z_INDEX_PORTAL_BASE = 10000`, `:8-10`) does not
  guarantee across the 62-portal / 67-non-portal split.
- **Absence of the provider degrades silently.** No provider →
  `isTopmost = true` fallback (`BaseModal.tsx:157`), deliberate for tests,
  but also the mechanism by which `embedded` modals leave the stack while
  keeping their priority-80 keyboard claim.
- **The 19-file shadow population.** 20 hand-painted `fixed inset-0`
  backdrops across 19 files never register at all (census rule
  `hand-painted-modal-backdrop`, 20/20 precision): the modal beneath still
  believes it is topmost and still answers escape. Adoption of the door is
  129:20 — 86.6% — and every defect class this Application lists lives in
  the unregistered 13.4%.
- **Navigation is not a registered reaper.** No central stack-clear on route
  change; the one modal that must outlive its opener is hoisted by hand
  (`ResourcePickerHost`, `App.tsx:398-402`) rather than owned by the stack.
