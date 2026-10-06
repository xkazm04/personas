/**
 * Real meters for scored facts. A lone score (confidence, coverage, wins) is
 * an ARC GAUGE with the value as its hero; several scores (effort / impact /
 * risk) are SEGMENTED CAPSULE bars. `invert` scales (effort, risk) colour LOW
 * as the good news via the deck's one banding rule (`bandTone`), and the word
 * beside each keeps the reading for anyone who cannot see the colour.
 */
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { bandTone } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import type { TriageFact } from '@/features/agents/quick-answer/triage/triageTypes';

export type ScoredFact = TriageFact & { score: NonNullable<TriageFact['score']> };

const CELLS = 10;
const WORD = { success: 'good', warning: 'fair', danger: 'poor', accent: '', neutral: '' } as const;

function meterProps(fact: ScoredFact) {
  const { value, max, invert } = fact.score;
  return {
    role: 'meter' as const,
    'aria-valuemin': 0,
    'aria-valuemax': max,
    'aria-valuenow': value,
    'aria-label': invert ? `${fact.label} (lower is better)` : fact.label,
  };
}

/** 270° arc, value in the middle. */
export function ArcGauge({ fact }: { fact: ScoredFact }) {
  const still = useReducedMotion();
  const { value, max, invert } = fact.score;
  const tone = bandTone(value, max, invert);
  const ratio = Math.min(1, Math.max(0, value / (max || 1)));
  const r = 26;
  const arc = 2 * Math.PI * r * 0.75;
  return (
    <div className="r2a-arc" data-r2a-say={tone} data-testid={`r2a-meter-${fact.id}`}>
      <div className="relative h-16 w-16 flex-shrink-0" {...meterProps(fact)}>
        <svg viewBox="0 0 64 64" className="h-16 w-16 rotate-[135deg]" aria-hidden>
          <circle cx="32" cy="32" r={r} className="r2a-arc__track" strokeDasharray={`${arc} 999`} />
          <motion.circle
            cx="32" cy="32" r={r}
            className="r2a-arc__value"
            strokeDasharray={`${arc} 999`}
            initial={{ strokeDashoffset: still ? arc * (1 - ratio) : arc }}
            animate={{ strokeDashoffset: arc * (1 - ratio) }}
            transition={{ duration: still ? 0 : 0.7, ease: [0.22, 1, 0.36, 1], delay: still ? 0 : 0.15 }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center typo-heading tabular-nums text-foreground">{value}</span>
      </div>
      <span className="flex min-w-0 flex-col">
        <span className="typo-label">{fact.label}</span>
        <span className="typo-caption">of {max}{WORD[tone] ? ` · ${WORD[tone]}` : ''}</span>
      </span>
    </div>
  );
}

export function ScoreMeter({ fact }: { fact: ScoredFact }) {
  const still = useReducedMotion();
  const { value, max, invert } = fact.score;
  const tone = bandTone(value, max, invert);
  const lit = Math.round((Math.min(value, max) / (max || 1)) * CELLS);
  return (
    <div className="r2a-meter" data-r2a-say={tone} data-testid={`r2a-meter-${fact.id}`}>
      <span className="typo-label">{fact.label}{invert ? ' ↓' : ''}</span>
      <div className="r2a-capsule" {...meterProps(fact)}>
        {Array.from({ length: CELLS }, (_, i) => (
          <motion.span
            key={i}
            initial={still ? false : { scaleX: 0.3, opacity: 0.3 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ delay: still ? 0 : 0.12 + i * 0.025, duration: 0.18 }}
            className="r2a-capsule__cell"
            data-lit={i < lit}
          />
        ))}
      </div>
      <span className="text-right typo-caption">
        <span className="typo-data tabular-nums text-foreground">{value}</span> {WORD[tone]}
      </span>
    </div>
  );
}
