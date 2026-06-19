// Shared model for the Studio build checklist. The phases are MOCKED here until
// the `build_plan` op (P3) feeds real phases; they mirror the web-build
// doctrine's Spine → Dynamic-Tail shape (docs/concepts/web-build-best-practices.md).

export type PhaseStatus = 'done' | 'active' | 'pending';

export interface BuildPhase {
  id: string;
  title: string;
  status: PhaseStatus;
  /** Golden-output hint or the last thing that happened on this phase. */
  note?: string;
}

/** Mock build plan (Spine + a couple generated tail phases) for prototyping. */
export const MOCK_PHASES: BuildPhase[] = [
  { id: 'vision', title: 'Vision', status: 'done', note: 'Portfolio for a web-dev freelancer' },
  { id: 'brand', title: 'Brand & theme', status: 'done', note: 'Calm · modern · dark' },
  { id: 'direction', title: 'Design direction', status: 'active', note: 'Choosing the hero look' },
  { id: 'foundation', title: 'Foundation', status: 'pending' },
  { id: 'work', title: 'Work / case studies', status: 'pending' },
  { id: 'contact', title: 'Contact', status: 'pending' },
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
