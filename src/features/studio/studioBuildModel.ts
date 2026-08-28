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
