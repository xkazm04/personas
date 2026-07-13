/**
 * Navigation back/forward history — the pure, side-effect-free engine behind
 * the app's browser-style Back / Forward affordances (titlebar buttons,
 * Alt+Arrow keys, and the mouse back/forward buttons).
 *
 * The app has no URL bar: routing is store-driven (`systemStore.sidebarSection`
 * + the selected persona). This module models the classic two-stack browser
 * history over those destinations so a user can retrace and un-retrace their
 * steps across sidebar sections (and the agent they had open inside the Agents
 * section).
 *
 * ## Model
 *
 * A {@link NavStacks} is two stacks, each newest-first (head = closest to the
 * present):
 *   - `back`    — where you came *from*; `back[0]` is the immediately-previous
 *                 location, restored by {@link goBack}.
 *   - `forward` — where you were *before* pressing Back; `forward[0]` is the
 *                 next location, restored by {@link goForward}. Cleared the
 *                 moment you navigate somewhere new ({@link recordNavigation}),
 *                 exactly like a browser truncating the forward branch.
 *
 * The *current* location is NOT stored here — it lives in the store
 * (`sidebarSection` + selected persona) and is passed in to {@link goBack} /
 * {@link goForward} so they can drop it onto the opposite stack.
 *
 * Everything here is pure and framework-free so it can be exhaustively
 * unit-tested; the store (`uiSlice`) wires it to real state, the persona-restore
 * bus, and the gate context.
 */
import type { SidebarSection } from '@/lib/types/types';
import {
  navSection,
  passesGates,
  type GateContext,
} from '@/lib/navigation/registry';
import { BUILD_MAX_TIER, TIER_RANK, type Tier } from '@/lib/constants/uiModes';

/**
 * A single navigable destination. `personaId` captures which agent was open
 * inside the Agents section (null = the section root / no agent), so Back can
 * step through agents you were viewing — not just across sections. This is the
 * "{ section, tab? }" the history tracks; `personaId` is the sub-tab that
 * actually varies in this URL-less app.
 */
export interface NavDestination {
  section: SidebarSection;
  personaId: string | null;
}

/** The two-stack browser history over {@link NavDestination}s. */
export interface NavStacks {
  /** Newest-first. `back[0]` = the immediately-previous location. */
  back: readonly NavDestination[];
  /** Newest-first. `forward[0]` = the next location (empty after a new nav). */
  forward: readonly NavDestination[];
}

/** Predicate: `true` when a destination is currently unreachable (gated out). */
export type GatePredicate = (dest: NavDestination) => boolean;

/**
 * Cap on each stack's depth. ~50 keeps the full session's trail retraceable
 * while bounding memory to something trivial (a few kB of small objects).
 */
export const NAV_HISTORY_CAP = 50;

/** An empty history — no back, no forward. */
export const EMPTY_NAV_STACKS: NavStacks = { back: [], forward: [] };

/** Structural equality of two destinations. */
export function sameDestination(a: NavDestination, b: NavDestination): boolean {
  return a.section === b.section && a.personaId === b.personaId;
}

/**
 * Record a *new* navigation: the location you're leaving (`outgoing`) is pushed
 * onto the back stack and the forward branch is truncated (browser semantics).
 *
 * - Dedupes the consecutive head: re-recording the same outgoing location is a
 *   no-op, so rapid same-destination transitions never bloat the stack.
 * - Caps the back stack at `cap`, dropping the oldest entries.
 *
 * Returns the same reference when nothing changes so store `set` calls can
 * bail out cheaply.
 */
export function recordNavigation(
  stacks: NavStacks,
  outgoing: NavDestination,
  cap: number = NAV_HISTORY_CAP,
): NavStacks {
  const head = stacks.back[0];
  const isDupe = head != null && sameDestination(head, outgoing);
  // A dupe with an already-empty forward branch is a true no-op.
  if (isDupe && stacks.forward.length === 0) return stacks;
  const back = isDupe
    ? stacks.back
    : [outgoing, ...stacks.back].slice(0, cap);
  return { back, forward: [] };
}

/** Index of the first non-gated entry in a newest-first stack, or -1. */
function firstReachable(
  stack: readonly NavDestination[],
  isGated: GatePredicate | undefined,
): number {
  if (!isGated) return stack.length > 0 ? 0 : -1;
  for (let i = 0; i < stack.length; i++) {
    if (!isGated(stack[i]!)) return i;
  }
  return -1;
}

/** Whether {@link goBack} would move (there is a reachable back entry). */
export function canGoBack(stacks: NavStacks, isGated?: GatePredicate): boolean {
  return firstReachable(stacks.back, isGated) >= 0;
}

/** Whether {@link goForward} would move (there is a reachable forward entry). */
export function canGoForward(stacks: NavStacks, isGated?: GatePredicate): boolean {
  return firstReachable(stacks.forward, isGated) >= 0;
}

/**
 * Step back to the most-recent reachable prior location.
 *
 * `current` (the live location) is dropped onto the forward stack so a
 * subsequent {@link goForward} returns to it. Any gated entries newer than the
 * target are discarded (they're unreachable — restoring them would just bounce
 * back), matching how a browser skips a now-forbidden page.
 *
 * Returns `null` when there is nowhere reachable to go back to.
 */
export function goBack(
  stacks: NavStacks,
  current: NavDestination,
  isGated?: GatePredicate,
): { stacks: NavStacks; dest: NavDestination } | null {
  const target = firstReachable(stacks.back, isGated);
  if (target < 0) return null;
  const dest = stacks.back[target]!;
  return {
    dest,
    stacks: {
      back: stacks.back.slice(target + 1),
      forward: [current, ...stacks.forward].slice(0, NAV_HISTORY_CAP),
    },
  };
}

/**
 * Step forward to the nearest reachable un-retraced location — the mirror of
 * {@link goBack}. `current` is pushed onto the back stack; gated forward
 * entries nearer than the target are discarded.
 *
 * Returns `null` when there is nowhere reachable to go forward to.
 */
export function goForward(
  stacks: NavStacks,
  current: NavDestination,
  isGated?: GatePredicate,
): { stacks: NavStacks; dest: NavDestination } | null {
  const target = firstReachable(stacks.forward, isGated);
  if (target < 0) return null;
  const dest = stacks.forward[target]!;
  return {
    dest,
    stacks: {
      back: [current, ...stacks.back].slice(0, NAV_HISTORY_CAP),
      forward: stacks.forward.slice(target + 1),
    },
  };
}

// -- Gate context ------------------------------------------------------------

/**
 * The gate context for the running build. Tier is a build-time constant
 * (`BUILD_MAX_TIER`), so this needs no React and can be built inside a store
 * action — meaning every Back/Forward path (titlebar, keyboard, mouse) skips
 * gated destinations uniformly.
 */
export function buildGateContext(): GateContext {
  const rank = TIER_RANK[BUILD_MAX_TIER];
  return {
    isDev: import.meta.env.DEV,
    isTierVisible: (minTier: Tier) => rank >= TIER_RANK[minTier],
  };
}

/** Whether a destination's section is gated out for the given context. */
export function isDestinationGated(
  dest: NavDestination,
  ctx: GateContext,
): boolean {
  return !passesGates(navSection(dest.section).gates, ctx);
}
