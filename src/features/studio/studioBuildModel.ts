import type { WebBuildPhase } from '@/lib/bindings/WebBuildPhase';

// The build-phase type flows from the backend (run_build_turn → BuildTurnResult).
// FE alias so components read `BuildPhase` while the shape stays the binding's.
export type BuildPhase = WebBuildPhase;

// Placeholder plan shown before Athena emits a real one (her first build turn
// replaces this via the BUILD_PLAN line). Mirrors the doctrine's Spine → Tail.
export const MOCK_PHASES: BuildPhase[] = [
  { id: 'vision', title: 'Vision', status: 'done', note: 'Portfolio for a web-dev freelancer' },
  { id: 'brand', title: 'Brand & theme', status: 'done', note: 'Calm · modern · dark' },
  { id: 'direction', title: 'Design direction', status: 'active', note: 'Choosing the hero look' },
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
