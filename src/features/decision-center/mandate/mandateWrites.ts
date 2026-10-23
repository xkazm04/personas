/**
 * mandateWrites — the deck verdicts that write to a MANDATE rather than to the
 * item on the card. One mapping, React-free, doors injected:
 *
 *   Sign card (`kind: 'mandate'`)
 *     accept            mandate_sign(charter, the card's draft envelope)
 *     reject            mandate_drop(charter, the reason from the prompt)
 *     skip / done       nothing: the card stays
 *   Re-read card (`kind: 'mandate'`, `payload.reread` set)
 *     accept, no edit   mandate_keep(charter, the re-read code): kept as signed
 *     accept, edited    mandate_sign(charter, the edited envelope): re-signing
 *                       is re-reading, so it moves the re-read marker too
 *   Breach card (`mandateAct`, any kind)
 *     amend             mandate_amend(charter, change)
 *     suspend           mandate_suspend(charter)
 *
 * Everything else is not a mandate write (`false`): the caller routes it to
 * the roster as before. A write that did not land REJECTS, like every deck
 * door, so the deck walks back to the card.
 */
import type { MandateChange } from '@/lib/bindings/MandateChange';
import type { MandateSignInput } from '@/lib/bindings/MandateSignInput';

import type { DeckVerdict } from '../deck/deckTypes';

export interface MandateDoors {
  sign: (charterId: string, envelope: MandateSignInput) => Promise<unknown>;
  drop: (charterId: string, reason: string | null) => Promise<unknown>;
  keep: (charterId: string, reason: string) => Promise<unknown>;
  amend: (charterId: string, change: MandateChange) => Promise<unknown>;
  suspend: (charterId: string) => Promise<unknown>;
}

export function isMandateWrite(v: DeckVerdict): boolean {
  return !!v.mandateAct || v.item.kind === 'mandate';
}

/** Perform a mandate write. Resolves `true` when it wrote, `false` when there was nothing to write. */
export async function writeMandateVerdict(v: DeckVerdict, doors: MandateDoors): Promise<boolean> {
  const act = v.mandateAct;
  if (act) {
    if (act.op === 'amend') await doors.amend(act.charterId, act.change);
    else await doors.suspend(act.charterId);
    return true;
  }
  if (v.item.kind !== 'mandate') return false;
  const charterId = v.item.payload?.charterId ?? v.item.sourceId;
  const reread = v.item.payload?.reread;
  if (v.verdict === 'accept') {
    if (reread && !v.envelope) {
      await doors.keep(charterId, reread);
      return true;
    }
    if (!v.envelope) throw new Error('A mandate cannot be signed without its envelope');
    await doors.sign(charterId, v.envelope);
    return true;
  }
  if (v.verdict === 'reject' && !reread) {
    await doors.drop(charterId, v.reason?.trim() || null);
    return true;
  }
  return false;
}
