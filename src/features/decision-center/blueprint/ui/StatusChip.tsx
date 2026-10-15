import type { ProposalStatus } from '@/lib/lensScan/wire';
import { STATUS } from '../model/states';
import type { BpText } from '../controller/useBlueprintText';

/** The word for an item's state: the store's status, in the sheet's language. One word per status. */
export function statusWord(B: BpText, s: ProposalStatus): string {
  return B[`status_${s}` as const];
}

/** What the next key does for an item in this state ('' when nothing does). */
export function nextHint(B: BpText, s: ProposalStatus): string {
  return B[`next_${s}` as const];
}

/** A state chip: the word, in the tone the state table gives its status (never a hue named at the call site). */
export function StatusChip({ B, status }: { B: BpText; status: ProposalStatus }) {
  return <span className={`bp-chip typo-label bp-tone-${STATUS[status].tone}`} data-status={status}>{statusWord(B, status)}</span>;
}
