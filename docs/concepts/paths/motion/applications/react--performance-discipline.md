---
layer: application
subject: motion
technique: performance-discipline
stack: react
---

# React application — performance discipline

How this repo implements the shared frame engine, and the migration story
that motivated it.

## The engine: `rafAnimationEngine.ts`

`src/lib/utils/rafAnimationEngine.ts` is the technique's "one shared frame
engine" almost clause for clause. Its header states the architecture and the
before-state it replaced: "Instead of N independent framer-motion springs
each firing setState at 60fps, a single rAF callback interpolates all
registered targets and writes directly to the DOM via refs — zero React
reconciliation during animation."

- **One clock, one registry** — a module-level `Map<symbol, AnimationEntry>`
  (`rafAnimationEngine.ts:23`) and a single `requestAnimationFrame` loop
  (`tick`, `:33-78`) advance every live spring per frame.
- **Frames bypass reactive state** — each entry carries a `write(value)`
  callback ("typically updates a DOM node", `:19-21`); nothing touches
  React state per frame. The reactive layer participates only at
  registration (`registerAnimation`, `:90-103`) and retargeting
  (`setAnimationTarget`, `:108-114`).
- **Idle cost is structurally zero** — when no entry is active the loop
  nulls its own `rafId` and stops (`:72-77`); `setAnimationTarget` restarts
  it on demand (`ensureRunning`, `:80-85`). No animation, no wake-ups.
- **The timestep is clamped centrally** — `dt = Math.min((now - lastTime) /
  1000, 0.064)` with the comment "Cap dt to avoid huge jumps after
  tab-switch" (`:40-42`): the spring-explosion-after-suspension fix, made
  once, engine-wide.
- **Creation names its reaper** — `registerAnimation` returns a `symbol`
  key; `unregisterAnimation(key)` (`:131-134`) is the documented cleanup,
  and the loop self-terminates when the registry empties.
- **Instant-settle path** — `snapAnimation` (`:119-126`) zeroes velocity and
  writes the target immediately: the no-animation code path a reduced-motion
  caller uses, same registry, no parallel implementation.

## Compositor discipline at the preset layer

The shared gesture library (`motionPresets.ts`) is built from `opacity`,
`transform: scale/translate`, and stroke-dash properties only — no animated
layout properties exist in any preset — so per-surface authors inherit the
compositor-friendly constraint by construction rather than by review. The
one deliberate exception class (SVG `stroke-dashoffset` in `draw`) animates
paint, not layout, and is scoped to small glyph surfaces.

## Bounded concurrency at the choreography layer

The entrance-cascade primitive caps its own worst case: `RevealItem.tsx`
fixes `STEP_MS = 35` and `MAX_STAGGER = 8` (`RevealItem.tsx:26-27`), so a
five-hundred-row virtualized table never schedules five hundred offset
animations — items beyond the cap enter with the max offset, and entry is
marked on `animationend` (not mount) so an interleaved re-render cannot cut
a fade short (`RevealItem.tsx:19-22`). The audit's "unbounded concurrency"
leak is unrepresentable at the call site.
