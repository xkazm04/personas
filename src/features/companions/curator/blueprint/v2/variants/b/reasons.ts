/**
 * The nine, in the order that decides WHICH ONE PRINTS ON THE ROW.
 *
 * `channels.ts` orders the nine for a nine-column grid; that order is a
 * drawing order. The order below is the registry's own DOMINANCE order, the
 * one `CuratorReasonCode` documents and the projection breaks ties with
 * (gone 6, no application 6, expired 5, deviation 4, thin 4, never swept 3,
 * no use_when 2, single stack 2, near clock 1). This variant needs that one,
 * because its whole resting state is "the dominant reason and its weight" -
 * so the reason the row names is always the first line of the nine, and the
 * strip it draws is always the first segment of the strip below.
 *
 * Nothing here invents a category: every entry resolves through
 * `channelOfCode`, so a clause the registry adds arrives as a missing channel
 * rather than a silent drop.
 */
import type { CuratorReasonCode } from '@/lib/bindings/CuratorReasonCode';

import { channelOfCode, type ChannelId, type ChannelSpec } from '../../../model/channels';
import type { BlueprintRow, CellMark } from '../../../model/types';
import type { Tone } from '@/features/shared/components/kit';

/**
 * WHO writes a channel - and therefore why exactly two of the nine can ever be
 * UNKNOWN. The consumer pair is the demand-fed one: where no consumer reports,
 * nobody has looked. The other three families are read from the corpus itself
 * and can only be counts or measured zeros.
 */
export type Family = 'consumer' | 'shape' | 'clock' | 'sweep';

const FAMILY_TONE: Record<Family, Tone> = {
  consumer: 'external',
  shape: 'agent',
  clock: 'warning',
  sweep: 'pending',
};

export interface Reason {
  code: Exclude<CuratorReasonCode, 'none'>;
  spec: ChannelSpec;
  channel: ChannelId;
  family: Family;
  tone: Tone;
}

const ORDER: [Exclude<CuratorReasonCode, 'none'>, Family][] = [
  ['citation_gone', 'consumer'],
  ['no_application', 'shape'],
  ['expired_application', 'clock'],
  ['deviation', 'consumer'],
  ['thin_techniques', 'shape'],
  ['never_swept', 'sweep'],
  ['missing_use_when', 'sweep'],
  ['single_stack', 'shape'],
  ['at_risk_application', 'clock'],
];

/** The nine, dominance-ordered. Built once; a missing spec would throw here. */
export const NINE: readonly Reason[] = ORDER.map(([code, family]) => {
  const spec = channelOfCode(code);
  // Unreachable: every code above is a member of CHANNELS' own closed set, and
  // the map is built from that set. It throws rather than skipping, because a
  // silently shortened list of nine is exactly the lossy resting state this
  // variant exists to argue against.
  if (!spec) throw new Error(`blueprint v2/b: no channel for ${code}`);
  return { code, spec, channel: spec.id, family, tone: FAMILY_TONE[family] };
});

const BY_CODE = new Map<CuratorReasonCode, Reason>(NINE.map((r) => [r.code, r]));

export function reasonOf(code: CuratorReasonCode): Reason | null {
  return BY_CODE.get(code) ?? null;
}

/** The cell the row's dominant reason sits in, and the reason itself. */
export function dominantOf(row: BlueprintRow): { reason: Reason; cell: CellMark } | null {
  const reason = reasonOf(row.dominantReason);
  if (!reason) return null;
  return { reason, cell: row.cells[reason.channel] };
}

/** The scan's own sentence for a cell, or null when it did not score. */
export function sentenceOf(cell: CellMark): string | null {
  return cell.kind === 'scored' ? cell.mark.detail : null;
}

/** Points this cell contributed. A non-scoring cell contributes nothing. */
export function pointsOf(cell: CellMark): number {
  return cell.kind === 'scored' ? cell.mark.points : 0;
}

/** Every scoring cell of a row, dominance-ordered: the nine, resolved. */
export function scoredOf(row: BlueprintRow): { reason: Reason; points: number }[] {
  const out: { reason: Reason; points: number }[] = [];
  for (const reason of NINE) {
    const points = pointsOf(row.cells[reason.channel]);
    if (points > 0) out.push({ reason, points });
  }
  return out;
}

/** 1 unit = 4 attention points. The corpus's widest row is 56, so 14 units. */
export const QUANTUM = 4;
