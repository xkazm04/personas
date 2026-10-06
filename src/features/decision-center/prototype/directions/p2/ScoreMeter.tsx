/**
 * A ten-cell score meter (BacklogDetailLedger's effort / impact / risk,
 * metered). `invert` scales (effort, risk) colour LOW as the good news, via
 * the deck's one banding rule (`bandTone`). The glyph-free word beside it
 * keeps the reading for anyone who cannot see the colour.
 */
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { bandTone } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import type { TriageFact } from '@/features/agents/quick-answer/triage/triageTypes';
import { LAMP_FILL } from './deckMeta';

const CELLS = 10;
const WORD = { success: 'good', warning: 'fair', danger: 'poor', accent: '', neutral: '' } as const;

export function ScoreMeter({ fact }: { fact: TriageFact & { score: NonNullable<TriageFact['score']> } }) {
  const still = useReducedMotion();
  const { value, max, invert } = fact.score;
  const tone = bandTone(value, max, invert);
  const lit = Math.round((Math.min(value, max) / (max || 1)) * CELLS);
  return (
    <div className="grid grid-cols-[4.5rem_1fr_5rem] items-center gap-2 py-1" data-testid={`p2-meter-${fact.id}`}>
      <span className="truncate typo-label">{fact.label}{invert ? ' ↓' : ''}</span>
      <div className="flex gap-0.5" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={invert ? `${fact.label} (lower is better)` : fact.label}>
        {Array.from({ length: CELLS }, (_, i) => (
          <motion.span
            key={i}
            initial={still ? false : { scaleY: 0.2, opacity: 0.4 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ delay: still ? 0 : 0.12 + i * 0.025, duration: 0.18 }}
            className={`h-2 flex-1 rounded-pill ${i < lit ? LAMP_FILL[tone] : 'bg-primary/10'}`}
          />
        ))}
      </div>
      <span className="text-right typo-caption">
        <span className="typo-data tabular-nums text-foreground">{value}/{max}</span> {WORD[tone]}
      </span>
    </div>
  );
}
