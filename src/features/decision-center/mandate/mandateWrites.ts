/**
 * mandateWrites — the deck verdicts that write to a MANDATE rather than to the
 * item on the card. One mapping, React-free, doors injected:
 *
 *   Sign card (`kind: 'mandate'`)
 *     accept            mandate_sign(charter, the card's draft envelope)
 *     reject            the draft charter is retired (Drop)
 *     skip / done       nothing: the card stays
 *   Breach card (`mandateAct`, any kind)
 *     amend             mandate_amend(charter, change)
 *     suspend           mandate_suspend(charter)
 *
 * Everything else is not a mandate write (`false`): the caller routes it to
 * the roster as before. A write that did not land REJECTS, like every deck
 * door, so the deck walks back to the card.
 *
 * Drop's reason is captured by the prompt but has nowhere to land: the only
 * door that ends a draft (`retire_persona_responsibility`) takes no reason and
 * writes no act. Recorded as an open risk of WP5, not papered over here.
 */
import type { MandateChange } from '@/lib/bindings/MandateChange';
import type { MandateSignInput } from '@/lib/bindings/MandateSignInput';

import type { DeckVerdict } from '../deck/deckTypes';

export interface MandateDoors {
  sign: (charterId: string, envelope: MandateSignInput) => Promise<unknown>;
  drop: (charterId: string) => Promise<unknown>;
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
  if (v.verdict === 'accept') {
    if (!v.envelope) throw new Error('A mandate cannot be signed without its envelope');
    await doors.sign(charterId, v.envelope);
    return true;
  }
  if (v.verdict === 'reject') {
    await doors.drop(charterId);
    return true;
  }
  return false;
}
