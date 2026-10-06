/** P3 small shared marks: keycaps, a key legend, the tier label, a score meter. */
import type { ReactNode } from 'react';
import type { TriageFact, TriageTone } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecisionItem } from '../../../model/decisionModel';
import { TIER_LABEL, TIER_TONE, TONE_FILL, TONE_TEXT, tierOf } from './model';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="p3-kbd typo-code text-foreground">{children}</kbd>;
}

export interface KeyHint { keys: string[]; label: string }

/** The compact key legend printed in the peek and desk footers. */
export function KeyLegend({ hints }: { hints: KeyHint[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Keyboard shortcuts">
      {hints.map((h) => (
        <span key={h.label} className="inline-flex items-center gap-1">
          {h.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
          <span className="typo-caption">{h.label}</span>
        </span>
      ))}
    </div>
  );
}

export function TierTag({ item }: { item: DecisionItem }) {
  const tier = tierOf(item);
  const tone = TIER_TONE[tier];
  return (
    <span className={`inline-flex items-center gap-1.5 typo-label ${TONE_TEXT[tone]}`}>
      <span className={`h-2 w-2 rounded-full ${TONE_FILL[tone]}`} aria-hidden />
      {TIER_LABEL[tier]}
    </span>
  );
}

/**
 * A ten-cell score meter. `invert` facts (effort, risk) read good when LOW, so
 * their fill turns warning/danger as the value climbs.
 */
/**
 * Meter bands for a 0..1 "goodness" ratio (invert already applied). Prototype
 * bands, named here beside the one formula that uses them; the consolidated
 * component should take GRADE_THRESHOLDS from compositeHealthScore instead.
 */
const METER_BANDS: readonly { min: number; tone: TriageTone }[] = [
  { min: 0.6, tone: 'success' },
  { min: 0.4, tone: 'warning' },
];
function meterTone(good: number): TriageTone {
  return METER_BANDS.find((b) => good >= b.min)?.tone ?? 'danger';
}

export function ScoreMeter({ fact }: { fact: TriageFact }) {
  const score = fact.score;
  if (!score) return null;
  const filled = Math.round((score.value / score.max) * 10);
  const ratio = score.value / score.max;
  const good = score.invert ? 1 - ratio : ratio;
  const tone = meterTone(good);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="typo-label text-foreground">{fact.label}</span>
        <span className={`typo-data ${TONE_TEXT[tone]}`}>
          {fact.value}
          <span className="typo-caption"> / {score.max}{score.invert ? ' · lower is better' : ''}</span>
        </span>
      </div>
      <div className="p3-meter" role="meter" aria-valuenow={score.value} aria-valuemin={0} aria-valuemax={score.max} aria-label={fact.label}>
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < filled ? TONE_FILL[tone] : 'is-off'} />
        ))}
      </div>
    </div>
  );
}
