---
layer: application
subject: canvas-graph
technique: render-budget
stack: react
---

# CanvasShell — the Mastermind render budget at 50–100 projects

`src/features/teams/sub_mastermind/lib/CanvasShell.tsx` is the shared shell
for every Mastermind variant, and its header (`:7-12`) states the budget
contract outright: the world `<g>` is driven imperatively while panning,
islands are `React.memo`'d with referentially stable callbacks, off-viewport
islands are culled — "together these keep a 50–100 project portfolio at 60fps
— a pan does zero island re-renders and a wheel zoom commits at most once per
animation frame."

## Rung 1 — pan touches one element

The camera (`useCanvasCamera.ts`) writes the world transform directly during
a pan and commits state once on release; islands never receive the camera as
a prop, so a pan invalidates nothing. Zoom keeps rendering (counter-scaled
layers genuinely need `z`), but coalesced to ≤1 commit per frame
(`useCanvasCamera.ts:6-12`, `:144-161`).

## Rung 2 — culling, and its two hard-won corollaries

- `visibleRect` is derived from the committed camera plus `CULL_MARGIN = 700`
  world units (`:63`, `:234-243`) — the margin is sized so an island (~900×800
  footprint) "is only culled once its whole body is well clear of the
  viewport — no popping" (`:62`), which is what lets point-in-rect against
  island *centers* stand in for full rect-intersection (`:250-254`).
- **Empty before measured, not everything** (`:245-249`): before the
  viewport measure + fit effects run, `visibleIslands` is `[]` — the comment
  records that rendering the whole world in pass one only to cull it in pass
  two "cost N×~150 SVG nodes of pure waste — a large slice of the
  first-open freeze."
- **Culling follows the camera mid-gesture**: the camera lands one interim
  commit per `PAN_COMMIT_WORLD = 350` (≈ `CULL_MARGIN / 2`,
  `useCanvasCamera.ts:18-22`) of world travel, so long render-free pans do
  not drag across empty sea.
- **Waved mounting under a measured frame budget** (`:257-285`): even the
  culled set commits in slices — one wave per animation frame, the next
  wave's size halved when the previous one overran `MOUNT_FRAME_BUDGET_MS`
  and grown when it came in under half, with the measurement guarded so a
  data arrival re-running the effect cannot be mistaken for a slow frame.
  Fill order ranks nearest-to-viewport-center first (`:287-305`) so the
  pixels under the user's gaze resolve first; only the *set* is ranked —
  child order stays stable so keys and paint order never shuffle. The budget
  only grows, so later pans mount immediately with no re-stagger.
- One deliberate exception proves the derivation is owned: the keyboard
  cursor's island is always mounted, "even mid-flight to an off-screen
  island" (`:307-310`) — focus travel is an animated pan, and culling the
  focused island would draw the focus ring over nothing.

## Rung 3 — memoized islands, stable callbacks

Every island-facing callback is wrapped in `useEventCallback`
(`useEventCallback.ts` — stable identity, latest closure, ref swapped in a
layout effect) at `:359-415`: hover, tap, connect, focus, menu, fleet list,
commit. The comment at `:359-360` names the reason — "referentially stable so
React.memo'd islands don't re-render when the shell does." This is the
technique's "callback takes the node's identity as an argument" clause
realized as the standard `useEvent` pattern; a fresh closure per island per
render would defeat the memoization of the entire portfolio.

Hover focus dimming bypasses rendering entirely: `el.style.opacity` is
written imperatively per island element (`:228-231`) rather than threading a
`lit` set through props — a highlight change touches zero component renders.

## Rung 4 — detail as a function of zoom

The pattern-graph sibling supplies the LOD half of the budget:
`labelScale(k) = k^-0.62` (`useGraphCanvas.ts:216-221`) counter-scales text
so names stay readable at 0.3× without becoming billboards at 3×, and
`lod(k, from, to)` (`:223-225`) is the opacity ramp — not a step — that
fades detail bands in across a zoom range. Mastermind's zoom bands
(`zoomBand`/`bandGte` in its types module) gate which structural layers
render at all.

## Where it falls short of the standard

Edges skip the budget entirely: `scene.edges.map(...)` (`:880-882`) and
`LinkLayer` (`:883-889`) render every route on every commit with no culling
at all, and derived routes are keyed by endpoint pair
(`` `${e.from}→${e.to}` ``) rather than minted edge identity. At the current
scale (tens of islands, ~70 edges) this is invisible — and it is the first
thing to revisit if edge counts grow an order of magnitude, per the
technique's "cull edges by their own geometry, not their endpoints" clause.
