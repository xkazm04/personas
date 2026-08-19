---
layer: application
subject: canvas-graph
technique: viewport-transform
stack: react
---

# The Mastermind camera and the pattern-graph camera — two realizations, one contract

This repo holds two independent pan/zoom cameras, and together they witness
nearly every clause of the viewport-transform technique — including two
lessons that were paid for live and then folded back upward.

## The transform authority

`src/features/teams/sub_mastermind/lib/useCanvasCamera.ts` owns the Mastermind
canvas's camera as plain `{x, y, z}` with `screen = world * z + (x, y)`
(header, `:4`), serialized into the world `<g>` by one function
(`camTransform`, `:32`). Zoom-to-point is written once, in `zoomAt`
(`:133-139`): clamp the scale (`clampZ`, `:29`, bounds `MIN_Z`/`MAX_Z`
`:26-27` — exported so the programmatic action layer can report `clamped:
true` instead of silently landing short), then recompute the pan so the world
point under the pivot stays fixed. Every entry point routes through it: wheel
(`:150`), double-click (`:213-216`), toolbar buttons via viewport center
(`:218-223`), and `fit` (`:225-237`) which derives the framing transform from
world bounds. The pattern-graph twin, `useGraphCanvas.ts`
(`src/features/overview/sub_patterns/graph/useGraphCanvas.ts`), repeats the
same change of basis with a center-origin convention (`:96-101`) and exposes
`project()` (`:191-197`) so HTML overlays share the authority instead of
re-deriving it.

## The gesture loan, all four guards

- **Imperative during the gesture**: pan writes the world `<g>` transform
  directly (`applyLive`, `:91-93`; drive site `:188-200`) — "a pan does zero
  island re-renders" (`CanvasShell.tsx:11`).
- **Commit coalesced**: wheel zoom accumulates factors and flushes at most
  one state commit per animation frame (`zoomAccum`/`flushZoom`,
  `:144-161`); pan commits exactly once on release (`endDrag`, `:204-211`).
- **Reconciliation guard**: if an unrelated re-render (fleet poll, hover)
  lands mid-pan, the framework reconciles the `<g>` back to the stale
  committed camera — a `useLayoutEffect` re-asserts the live transform every
  render while a pan is active (`:95-100`), and `useIslandDrag.ts:37-40`
  mirrors the same guard for node drags. The live camera also lives in
  `camRef`, deliberately not clobbered by state while mid-pan (`:67-71`),
  because gesture math must read the uncommitted truth.
- **Interim commits on sustained gestures**: `PAN_COMMIT_WORLD = 350`
  (`:18-22`) — after ~half a cull margin of world travel, one commit lands
  so the culling window follows the camera; the comment records the defect
  it fixed ("long pans no longer drag across empty sea until release").

## The wheel-ownership lesson, verbatim

`useGraphCanvas.ts:82-87` carries the paid-for version of the technique's
bubbling rule: the wheel listener must be native and non-passive (the
framework's synthetic wheel handler cannot `preventDefault`, so every notch
scrolled the page beneath), and it moved from the container to the svg
because the cluster modal and the playbooks rail are children of the
*container* — "bubbling follows the DOM, so a container listener turned every
scroll inside an overlay into a canvas zoom." Both cameras register
`{ passive: false }` on the element that genuinely owns canvas pixels
(`useGraphCanvas.ts:103`, `useCanvasCamera.ts:163`).

## Capture timing and the trailing click

The two cameras resolve press ambiguity differently, and the difference is
the technique's capture-timing clause. The pattern graph captures **only
after the 3px slop converts the press into a pan** (`:107-112`, `:126-132`),
because capturing at pointerdown retargeted the whole stream — including the
eventual click — at the svg, and node clicks never fired. It then suppresses
the trailing click after a pan via a capture-phase click handler
(`suppressClick`/`onClickCapture`, `:113`, `:138-150`) so releasing a drag
over a node doesn't select it. Mastermind instead captures at press
(`useCanvasCamera.ts:176`) and stays correct because island handlers
`stopPropagation()` at their own pointerdown (`useIslandDrag.ts:44`) — the
surface never sees presses that belong to children. Either discipline works;
having neither is the bug.

## The user always wins the camera

Both cameras run programmatic travel as cancellable tweens: any wheel or
drag input cancels the flight (`cancelTween` on wheel `:154` and pointerdown
`:174`; `cancelFlight` at `useGraphCanvas.ts:92`, `:117`), and Mastermind's
settle promise resolves on cancel too (`animDone`, `:79-87`) so an awaiting
programmatic driver observes wherever the camera ended up instead of hanging
— the exact "canceled tween still resolves" clause.
