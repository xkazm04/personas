// Which contest the page is looking at.
//
// A tiny module store rather than component state so that code OUTSIDE the
// page — the app-root ContestLiveFeeder turning a "ready for review" notice
// into a click — can focus a contest before the page has even mounted.
// In memory only (no persist): a focus that survived a restart would reopen a
// contest the owner already left.
import { create } from 'zustand';

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
  focusContest: (key: ContestKey | null) => void;
}

export const useContestFocus = create<ContestFocusState>()((set) => ({
  focused: null,
  focusSeq: 0,
  focusContest: (key) => set((s) => ({ focused: key, focusSeq: s.focusSeq + 1 })),
}));

/** Non-React door: focus a contest from anywhere. */
export function focusContest(key: ContestKey | null): void {
  useContestFocus.getState().focusContest(key);
}
