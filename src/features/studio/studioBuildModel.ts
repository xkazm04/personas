import type { WebBuildPhase } from '@/lib/bindings/WebBuildPhase';

// The build-phase type flows from the backend (run_build_turn → BuildTurnResult).
// FE alias so components read `BuildPhase` while the shape stays the binding's.
export type BuildPhase = WebBuildPhase;

// Placeholder plan shown before Athena emits a real one (her first build turn
// replaces this via the BUILD_PLAN line). Mirrors the doctrine's Spine → Tail.
//
// Every phase is `pending` and carries no note ON PURPOSE. The earlier version
// of this list shipped two phases marked `done` and a third `active`, with notes
// asserting the project was a "Portfolio for a web-dev freelancer" themed
// "Calm · modern · dark" — for EVERY new project, whatever the user actually
// described. The plan button therefore read "2/6" and the drawer showed a
// finished Vision and Brand before a single file existed. A placeholder may
// describe the SHAPE of the work; it may not claim work was done.
export const MOCK_PHASES: BuildPhase[] = [
  { id: 'vision', title: 'Vision', status: 'pending', note: null },
  { id: 'brand', title: 'Brand & theme', status: 'pending', note: null },
  { id: 'direction', title: 'Design direction', status: 'pending', note: null },
  { id: 'foundation', title: 'Foundation', status: 'pending', note: null },
  { id: 'work', title: 'Work / case studies', status: 'pending', note: null },
  { id: 'contact', title: 'Contact', status: 'pending', note: null },
];

export function phaseProgress(phases: BuildPhase[]): {
  done: number;
  total: number;
  active?: BuildPhase;
} {
  return {
    done: phases.filter((p) => p.status === 'done').length,
    total: phases.length,
    active: phases.find((p) => p.status === 'active'),
  };
}

/** The minimum a tab's status dot needs to know — kept structural so the mapping
 *  is testable without constructing a whole `ProjectRuntime`. */
export interface TabDotState {
  question: string | null;
  autonomous: boolean;
  busy: boolean;
  phase: string;
}

/**
 * Tailwind classes for a project tab's status dot.
 *
 * The tab strip is peripheral vision: it is visible from every Studio screen and
 * the eye is pulled to whatever moves in it. The earlier mapping animated for the
 * whole of `busy || autonomous` — and an autonomous run is up to AUTO_MAX_TURNS
 * chained turns, so the dot pulsed continuously for many minutes at a stretch. A
 * state CHANGE may announce itself; a steady state never animates, or the strip
 * becomes peripheral vision with a flashlight in it.
 *
 * So exactly one state animates, and it is the only one that is actionable: the
 * build has halted on a question and is waiting on the user. Building, live,
 * error and idle are all steady and are told apart by hue — which they already
 * were, which is what made the pulse redundant even while it was firing.
 */
export function tabDotClass(rt: TabDotState): string {
  if (rt.question) return 'bg-status-warning animate-pulse';
  if (rt.autonomous || rt.busy) return 'bg-primary';
  if (rt.phase === 'live') return 'bg-status-success';
  if (rt.phase === 'error') return 'bg-status-error';
  return 'bg-foreground/30';
}
