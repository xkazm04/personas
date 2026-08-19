---
layer: application
subject: async-ui-states
technique: action-busy-states
stack: react
---

# React application — action busy states

How this repo realizes the pressed-control contract, and where its call sites
still defeat it.

## The canonical primitive: `AsyncButton`

`src/features/shared/components/buttons/AsyncButton.tsx` implements the whole
technique with zero state at the call site — `onClick` returns the promise,
the button owns the rest:

- **Synchronous disarm** — `inFlightRef` is set inside the click handler
  itself (`AsyncButton.tsx:35,41-46`), before React can commit a re-render.
  The source comment states the reason precisely: the click event fires
  synchronously, so a fast double-click would otherwise invoke a mutating
  handler twice before any reactive `isLoading` could disable the button.
- **Promise-tied lifetime** — thenable detection at `AsyncButton.tsx:55`
  drives `internalLoading`; the guard is released in a `finally`
  (`AsyncButton.tsx:57-60`) so a *failed* action returns the control to
  actionable and retryable.
- **Real spinner, announced** — a visible `Loader2` (`AsyncButton.tsx:85`),
  `disabled || busy` plus `aria-busy` (`AsyncButton.tsx:99-100,112-113`), an
  animated label swap, and a reduced-motion fallthrough to `Button`'s plain
  swap (`AsyncButton.tsx:94-107`).

`Button` is the externally-owned-flag variant: `loading` renders the spinner
(`Button.tsx:230,237`), sets `aria-busy` (`Button.tsx:226`), carries the same
thenable double-submit guard (`Button.tsx:159-182`), and — the "geometry
holds" clause — **locks the resting width in a `useLayoutEffect`**
(`Button.tsx:139`) so the label→spinner swap cannot collapse the button.

## Per-entity and long-running scope

- `src/stores/slices/vault/credentialSlice.ts:215-246` is the canonical
  keyed in-flight set: the id is added to `pendingDeleteCredentialIds`
  *before* the await and deleted in both the success and the catch branch;
  each row reads `set.has(id)`. No scalar ever fans out across a collection.
- `src/stores/slices/processActivitySlice.ts` is the graduation path for
  operations measured in minutes: `processStarted/processEnded` feed the
  titlebar activity dock, which outlives the pressed control and any
  navigation away from it.

## The two live defect families (the technique's negatives, measured here)

- **`feedback/LoadingSpinner` renders `null`** (`LoadingSpinner.tsx:12-21`) —
  spinners are deliberately disabled app-wide *for surfaces*, and the shim
  survives for import compatibility. Every `{busy ? <LoadingSpinner/> :
  <Icon/>}` ternary in an action control therefore ships an **invisible**
  busy state: the icon vanishes and nothing replaces it. The 2026-08-13
  sweep (`docs/concepts/golden-paths/inline-busy-state.md`) counted ~75 such
  action-control sites.
- **`onClick={() => void save(row)}` disarms everything silently.** The
  `void` makes the handler return `undefined`, the thenable detection never
  fires, and the spinner, the disable, and the double-submit guard all
  evaporate while the call site still *looks* wired. The same sweep counted
  177 sites — the highest-frequency defect in the leaf, and the reason the
  technique names fire-and-forget as the way correct controls degrade.
