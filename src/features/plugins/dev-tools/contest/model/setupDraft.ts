// The "New race" form's in-progress input, kept in ONE module slot so closing
// the drawer (Escape, a backdrop click) never throws a hand-written brief — or
// a metered Athena draft — away. Reopening restores it; a successful create
// or the form's own "Clear" empties it. A single fixed slot (loading v2 law 4):
// there is one setup form, so there is nothing to key or cap.
import type { ContestSeatSpec } from '@/lib/bindings/ContestSeatSpec';

import { TIMEOUT_MIN_DEFAULT, VARIANTS_DEFAULT } from './setupValidation';

export interface SetupDraft {
  title: string;
  projectId: string | null;
  idea: string;
  brief: string;
  seats: ContestSeatSpec[];
  variantsPerSeat: number;
  timeoutMin: number;
  judgesEnabled: boolean;
  judges: ContestSeatSpec[];
  dataDir: string;
  startAt: string;
}

export function blankSetupDraft(projectId: string | null): SetupDraft {
  return {
    title: '',
    projectId,
    idea: '',
    brief: '',
    seats: [],
    variantsPerSeat: VARIANTS_DEFAULT,
    timeoutMin: TIMEOUT_MIN_DEFAULT,
    judgesEnabled: false,
    judges: [],
    dataDir: '',
    startAt: '',
  };
}

let slot: SetupDraft | null = null;

export function readSetupDraft(): SetupDraft | null {
  return slot;
}

export function writeSetupDraft(draft: SetupDraft): void {
  slot = draft;
}

/** Merge into the kept draft — how a brief drafted after the form closed
 *  still lands somewhere. */
export function patchSetupDraft(patch: Partial<SetupDraft>): void {
  if (slot) slot = { ...slot, ...patch };
}

export function clearSetupDraft(): void {
  slot = null;
}

/** Whether the owner has put anything into the form (the project choice
 *  alone is not work worth guarding). */
export function isSetupDirty(draft: SetupDraft | null): boolean {
  if (!draft) return false;
  return (
    draft.title.trim() !== '' ||
    draft.idea.trim() !== '' ||
    draft.brief.trim() !== '' ||
    draft.seats.length > 0 ||
    draft.judges.length > 0 ||
    draft.judgesEnabled ||
    draft.variantsPerSeat !== VARIANTS_DEFAULT ||
    draft.timeoutMin !== TIMEOUT_MIN_DEFAULT ||
    draft.dataDir.trim() !== '' ||
    draft.startAt !== ''
  );
}
