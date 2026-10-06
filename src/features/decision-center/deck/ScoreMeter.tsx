/**
 * A scored fact as a real meter: a capsule whose tone-gradient fill is notched
 * into ten segments, the value beside it in tabular figures as the hero.
 * `invert` scales (effort, risk) colour LOW as the good news via the deck's
 * one banding rule (`bandTone`), and say so with a ↓ whose meaning is in its
 * tooltip. The band word (good / fair / poor) keeps the reading for anyone who
 * cannot see the colour. The dimension keeps its WORD: three bars that only
 * differ by glyph would not pass the 5-second test.
 */
import { motion } from 'framer-motion';
import { ArrowDown, Hammer, ShieldAlert, Target, Trophy, Zap, type LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { bandTone } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import type { TriageFact } from '@/features/agents/quick-answer/triage/triageTypes';

const WORD = { success: 'good', warning: 'fair', danger: 'poor', accent: '', neutral: '' } as const;
const METER_ICON: Record<string, LucideIcon> = { conf: Target, coverage: Target, effort: Hammer, impact: Zap, risk: ShieldAlert, wins: Trophy };

export function ScoreMeter({ fact }: { fact: TriageFact & { score: NonNullable<TriageFact['score']> } }) {
  const still = useReducedMotion();
  const { value, max, invert } = fact.score;
  const tone = bandTone(value, max, invert);
  const ratio = Math.min(value, max) / (max || 1);
  const Icon = METER_ICON[fact.id];
  return (
    <div className={`au-l-${tone} flex flex-col gap-1.5`} data-testid={`p2-meter-${fact.id}`}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 au-quiet flex-shrink-0" aria-hidden />}
        <span className="typo-eyebrow text-foreground">{fact.label}</span>
        {invert && (
          <Tooltip content="Lower is better">
            <span className="au-quiet inline-flex" tabIndex={0} aria-label="lower is better">
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </span>
          </Tooltip>
        )}
        <span className="ml-auto flex items-baseline gap-1.5">
          <span className="typo-heading tabular-nums text-foreground">{value}</span>
          <span className="typo-caption tabular-nums">/{max}</span>
          {WORD[tone] && <span className="au-ink-lamp typo-label">{WORD[tone]}</span>}
        </span>
      </div>
      <div className="au-meter" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={invert ? `${fact.label} (lower is better)` : fact.label}>
        {/* Full-width fill clipped to the value, so the ten notches stay fixed to the track. */}
        <motion.div
          className="au-meter-fill"
          initial={still ? false : { clipPath: 'inset(0 100% 0 0 round 999px)' }}
          animate={{ clipPath: `inset(0 ${(1 - ratio) * 100}% 0 0 round 999px)` }}
          transition={{ delay: still ? 0 : 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
