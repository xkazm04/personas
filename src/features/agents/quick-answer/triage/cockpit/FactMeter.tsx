/**
 * FactMeter / FactRow — the ledger rail's two primitives.
 *
 * `TriageFact.score` exists because effort / impact / risk / confidence are the
 * facts a reviewer actually WEIGHS, and a weighed quantity reads as a position
 * on a scale, not as the character "7". So scored facts get an instrument: a
 * segmented meter when the scale is small enough to enumerate (1–10), a
 * continuous bar otherwise (confidence, 0–1).
 *
 * `invert` is the whole reason this is a component rather than a `<progress>`:
 * on effort and risk, LOW is the good news, so the colour ramp runs the other
 * way. The model marks which scales invert; nothing here hardcodes "effort".
 *
 * ⚠️ PROTOTYPE (/prototype round 1): English literals inline, `src/i18n/**` is
 * off-limits this round. See cockpitKinds.tsx for the full note.
 */
import type { ReactNode } from 'react';

import type { TriageFact, TriageTone } from '../triageTypes';
import { TONE_FILL, TONE_TEXT } from './cockpitKinds';

/** Where a scored fact lands, expressed as a tone rather than a number. */
function scoreTone(ratio: number, invert?: boolean): TriageTone {
  if (invert) {
    if (ratio <= 0.34) return 'success';
    if (ratio <= 0.67) return 'warning';
    return 'danger';
  }
  if (ratio >= 0.67) return 'success';
  if (ratio >= 0.34) return 'warning';
  return 'neutral';
}

/** Small integer scales get enumerated; anything else gets a continuous bar. */
function isEnumerable(max: number): boolean {
  return Number.isInteger(max) && max >= 4 && max <= 12;
}

export function FactMeter({
  score,
  label,
}: {
  score: NonNullable<TriageFact['score']>;
  /** The fact's label, folded into the meter's accessible name. */
  label: string;
}) {
  const { value, max, invert } = score;
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const tone = scoreTone(ratio, invert);
  const fill = TONE_FILL[tone];
  const hint = invert ? ' — lower is better' : '';
  const title = `${label}: ${value} of ${max}${hint}`;

  const meterProps = {
    role: 'meter' as const,
    'aria-label': title,
    'aria-valuenow': value,
    'aria-valuemin': 0,
    'aria-valuemax': max,
    title,
  };

  if (isEnumerable(safeMax)) {
    const filled = Math.round(ratio * safeMax);
    return (
      <span className="flex items-center gap-[3px] w-full" {...meterProps}>
        {Array.from({ length: safeMax }).map((_, i) => (
          <span
            key={i}
            className={`h-2 flex-1 rounded-[2px] ${i < filled ? fill : 'bg-primary/12'}`}
          />
        ))}
      </span>
    );
  }

  return (
    <span className="block h-2 w-full rounded-pill bg-primary/12 overflow-hidden" {...meterProps}>
      <span
        className={`block h-full rounded-pill ${fill} transition-[width] duration-200 motion-reduce:transition-none`}
        style={{ width: `${ratio * 100}%` }}
      />
    </span>
  );
}

/**
 * One ledger row: uppercase label above, value below, meter under a scored
 * value. Label-over-value (rather than label-beside-value) is what lets a
 * 300px rail hold twelve facts without truncating any of them.
 */
export function FactRow({ fact, children }: { fact: TriageFact; children?: ReactNode }) {
  const valueTone = fact.tone && fact.tone !== 'neutral' ? TONE_TEXT[fact.tone] : 'text-foreground';
  return (
    <div className="flex flex-col gap-1 py-2.5 min-w-0">
      <span className="typo-label text-muted-foreground">{fact.label}</span>
      <span className={`typo-body ${valueTone} break-words leading-snug`}>
        {children ?? fact.value}
      </span>
      {fact.score && (
        <span className="mt-1 flex items-center gap-2">
          <FactMeter score={fact.score} label={fact.label} />
        </span>
      )}
    </div>
  );
}
