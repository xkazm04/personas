/**
 * A metric's change since the earlier measure, as a small mark beside its
 * figure: an up or down arrow (the direction, legible without colour), the
 * signed change ("+6 pts", "-1m 12s"), toned good or bad by what the metric
 * means (`delta.higherIsBetter`). No earlier measure, or no move at the
 * figure's precision, draws nothing: never "+0".
 *
 * `unitWhenWide`: the "pts" unit shows only when the card has room for it (a
 * container query on the card); the arrow and the signed number always do,
 * and the spoken text always carries the whole phrase.
 */
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { formatCount, formatDuration } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import type { MetricDelta } from '../delta';
import { isRateKey } from '../healthModel';

const TONE_INK = { good: 'text-status-success', bad: 'text-status-error', neutral: 'text-foreground' } as const;

/** The signed change without its unit word: "+6", "−1m 12s". */
export function signedChange(d: MetricDelta, language: string): string {
  const sign = d.change > 0 ? '+' : d.change < 0 ? '−' : '';
  const size = Math.abs(d.change);
  return `${sign}${isRateKey(d.key) ? formatCount(size, { language }) : formatDuration(size)}`;
}

export function DeltaMark({ delta, unitWhenWide = false }: { delta: MetricDelta | null; unitWhenWide?: boolean }) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  if (!delta || delta.direction === 'flat') return null;
  const Arrow = delta.direction === 'up' ? ArrowUpRight : ArrowDownRight;
  const value = signedChange(delta, language);
  const rate = isRateKey(delta.key);
  const spoken = rate ? tx(dl.lcx2_delta_pts, { value }) : value;
  return (
    <span
      className={`inline-flex items-center gap-0.5 whitespace-nowrap ${LT.delta} ${TONE_INK[delta.tone]}`}
      data-delta={delta.direction}
      data-tone={delta.tone}
    >
      <span className="sr-only">{tx(dl.lcx2_delta_spoken, { change: spoken })}</span>
      <Arrow className={`${GLYPH.sm} shrink-0`} strokeWidth={2.5} aria-hidden />
      <span aria-hidden>
        {value}
        {rate && <span className={unitWhenWide ? 'hidden @[11rem]/card:inline' : undefined}>{` ${dl.lcx2_delta_pts_unit}`}</span>}
      </span>
    </span>
  );
}
