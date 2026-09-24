// Which contest the page is looking at, and through which shell.
//
// A tiny module store rather than component state so that code OUTSIDE the
// page — the app-root ContestLiveFeeder turning a "ready for review" notice
// into a click — can focus a contest before the page has even mounted.
// In memory only (no persist): the three shells are prototypes and a focus
// that survived a restart would reopen a contest the owner already left.
import { create } from 'zustand';

export type ContestSurface = 'arena' | 'contact' | 'ledger';

export const CONTEST_SURFACES: readonly ContestSurface[] = ['arena', 'contact', 'ledger'];

/** A contest's identity: arenas are per project, ids are per arena. */
export interface ContestKey {
  projectId: string;
  contestId: string;
}

export function contestKeyString(k: ContestKey): string {
  return `${k.projectId}/${k.contestId}`;
}

export function sameContest(a: ContestKey | null, b: ContestKey | null): boolean {
  return !!a && !!b && a.projectId === b.projectId && a.contestId === b.contestId;
}

interface ContestFocusState {
  /** The focused contest, or null for the home layer. */
  focused: ContestKey | null;
  /** Bumped on every `focusContest` call, so a shell can react to the same
   *  contest being focused again (a second notice click). */
  focusSeq: number;
  /** The shell the page shows. */
  surface: ContestSurface;
  focusContest: (key: ContestKey | null) => void;
  setSurface: (surface: ContestSurface) => void;
}

export const useContestFocus = create<ContestFocusState>()((set) => ({
  focused: null,
  focusSeq: 0,
  surface: 'arena',
  focusContest: (key) => set((s) => ({ focused: key, focusSeq: s.focusSeq + 1 })),
  setSurface: (surface) => set({ surface }),
}));

/** Non-React door: focus a contest from anywhere. */
export function focusContest(key: ContestKey | null): void {
  useContestFocus.getState().focusContest(key);
}
