// monitorVisibility — is the Fleet Monitor overlay on screen right now?
//
// THE MONITOR STOPS UNMOUNTING. Until 2026-10-06 the overlay was torn down on
// close (`useTitleBarTray`'s `{headerOverlay === 'monitor' && ...}`), so every
// open rebuilt a 212-module tree, re-registered about twelve polls and re-ran
// every mount effect. It now stays mounted for the app session and is HIDDEN
// instead — the same `content-visibility: hidden` + `inert` trade `App.tsx`
// already makes for the app shell underneath it (see its "C5 — SHELL
// SUSPENSION" comment).
//
// That trade has a price, and this module is how the price is paid: a hidden
// subtree's React state and effects are still ALIVE. Paint, hit-testing and
// the a11y tree are skipped by the browser; timers, subscriptions and polls
// are not. So everything in the monitor that costs something while nobody is
// looking has to ask whether it is being looked at, and this is the one place
// that answers.
//
// WHY A CONTEXT AND NOT A STORE SELECTOR. `useSystemStore(s => s.headerOverlay)`
// would answer the same question from anywhere, and that is exactly the
// problem: it would let any descendant of any surface read the monitor's
// visibility, and it ties the monitor's internals to the name of a global UI
// mode. The provider is the overlay itself, so the question "am I visible?"
// can only be asked by something inside it, and a component lifted out of the
// monitor gets the default — `true` — which fails toward doing the work rather
// than toward silently never polling again.

import { createContext, useContext } from 'react';

/**
 * True while the monitor is on screen.
 *
 * **Defaults to `true` on purpose.** A consumer rendered outside the provider
 * (the Quick Answer popover's copy of the review queue, a test mounting one
 * panel in isolation) must behave as it always has. A `false` default would
 * make a missing provider look like a working optimisation while quietly
 * stopping every poll in a surface nobody remembered to wrap.
 */
export const MonitorVisibilityContext = createContext<boolean>(true);

/**
 * Whether the surface this component sits in is currently visible.
 *
 * Gate anything that COSTS something on it: a poll, an interval, an animation
 * frame loop, a subscription that recomputes. Do not gate rendering on it —
 * the whole point of `content-visibility` over `display: none` is that the
 * tree keeps its state and its scroll offsets, so it can be shown again
 * instantly.
 */
export function useMonitorVisible(): boolean {
  return useContext(MonitorVisibilityContext);
}
