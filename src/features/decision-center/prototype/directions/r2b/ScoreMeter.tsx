/**
 * A score as a measuring instrument: the name (never truncated — it has the
 * whole row), the reading as a figure over its scale, ten machined cells and a
 * tick scale beneath. `invert` scales (effort, risk) colour LOW as the good
 * news, via the deck's one banding rule (`bandTone`); a glyph marks "lower is
 * better" and its tooltip says so. The band word keeps the reading for anyone
 * who cannot see the colour.
 */
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownNarrowWide } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { bandTone } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import type { TriageFact } from '@/features/agents/quick-answer/triage/triageTypes';
import { LAMP_TONE } from './deckMeta';

const CELLS = 10;
const WORD = { success: 'good', warning: 'fair', danger: 'poor', accent: '', neutral: '' } as const;

export function ScoreMeter({ fact }: { fact: TriageFact & { score: NonNullable<TriageFact['score']> } }) {
  const still = useReducedMotion();
  const { value, max, invert } = fact.score;
  const tone = bandTone(value, max, invert);
  const lit = Math.round((Math.min(value, max) / (max || 1)) * CELLS);
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return (
    <div className="r2b-meter" data-testid={`r2b-meter-${fact.id}`} style={{ '--r2b-meter': LAMP_TONE[tone] } as CSSProperties}>
      <div className="r2b-meter-head">
        <span className="r2b-meter-name typo-label">
          {fact.label}
          {invert && (
            <Tooltip content="Lower is better">
              <span tabIndex={0} aria-label="lower is better" className="inline-flex r2b-unit">
                <ArrowDownNarrowWide className="h-3.5 w-3.5" aria-hidden />
              </span>
            </Tooltip>
          )}
        </span>
        <span className="r2b-meter-read">
          <span className="r2b-figure-md">{shown}</span>
          <span className="typo-caption r2b-num">/{max}</span>
          {WORD[tone] && <span className="typo-caption r2b-caps" style={{ color: LAMP_TONE[tone] }}>{WORD[tone]}</span>}
        </span>
      </div>
      <div className="r2b-cells" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={invert ? `${fact.label} (lower is better)` : fact.label}>
        {Array.from({ length: CELLS }, (_, i) => (
          <motion.span
            key={i}
            className="r2b-cell"
            data-lit={i < lit || undefined}
            initial={still ? false : { scaleY: 0.3, opacity: 0.4 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ delay: still ? 0 : 0.1 + i * 0.022, duration: 0.18 }}
          />
        ))}
      </div>
      <div className="r2b-scale" aria-hidden />
    </div>
  );
}
