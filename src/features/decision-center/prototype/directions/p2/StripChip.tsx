/**
 * One chip on the strip: icon with its severity lamp, label (dropped to a
 * tooltip when the bar is narrow), and a count that rolls when it changes.
 *
 * Three honest states: zero (present, dimmed, lamp off — positions never
 * shift), failed (a warning glyph where the number would be — never a 0), and
 * "next" (the chip holding the first item of the whole roster wears a tint and
 * an underline: it is where the queue starts).
 */
import { forwardRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { TONE_CHIP } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import type { ChipCount, HubChip } from '../../../model/decisionModel';
import { CHIP_META, LAMP_FILL } from './deckMeta';

function RollingCount({ n }: { n: number }) {
  const still = useReducedMotion();
  const [prev, setPrev] = useState(n);
  const [dir, setDir] = useState(1);
  if (prev !== n) {
    setDir(n > prev ? 1 : -1);
    setPrev(n);
  }
  return (
    <span className="relative inline-flex h-5 min-w-[0.75rem] items-center justify-center overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span
          key={n}
          custom={dir}
          initial={still ? { opacity: 0 } : { y: dir * 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={still ? { opacity: 0 } : { y: -dir * 12, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className="typo-data tabular-nums"
        >
          {n}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export interface StripChipProps {
  chip: HubChip;
  count: ChipCount;
  compact: boolean;
  isNext: boolean;
  open: boolean;
  onPress: () => void;
}

export const StripChip = forwardRef<HTMLButtonElement, StripChipProps>(function StripChip(
  { chip, count, compact, isNext, open, onPress },
  ref,
) {
  const meta = CHIP_META[chip];
  const Icon = meta.icon;
  const zero = !count.failed && count.n === 0;
  const tip = count.failed
    ? `${meta.label}: the source did not answer — count unknown`
    : `${meta.label}: ${count.n} · ${meta.hint}`;
  const surface = count.failed
    ? 'border-dashed border-status-error/50 text-status-error'
    : zero
      ? 'border-primary/10 text-muted-foreground'
      : isNext
        ? TONE_CHIP[count.lamp === 'neutral' ? 'accent' : count.lamp]
        : 'border-primary/15 bg-secondary/30 text-foreground';

  return (
    <Tooltip content={tip} placement="bottom">
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        onClick={onPress}
        aria-pressed={open}
        aria-expanded={open}
        aria-label={tip}
        data-testid={`p2-chip-${chip}`}
        className={`relative rounded-input border ${surface} ${open ? 'ring-2 ring-primary/50' : ''} ${compact ? 'px-1.5! [&>span]:gap-1' : 'px-2! [&>span]:gap-1.5'} [&>span]:inline-flex [&>span]:items-center`}
      >
        <span className="relative inline-flex">
          <Icon className="h-4 w-4" aria-hidden />
          {!zero && !count.failed && count.lamp !== 'neutral' && (
            <span className={`absolute -right-1 -top-1 h-2 w-2 rounded-pill ring-2 ring-background ${LAMP_FILL[count.lamp]}`} aria-hidden />
          )}
        </span>
        {!compact && <span className="typo-caption text-current">{meta.label}</span>}
        {count.failed ? <TriangleAlert className="h-4 w-4 text-status-error" aria-hidden /> : <RollingCount n={count.n} />}
        {isNext && !zero && (
          <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-pill bg-current" aria-hidden />
        )}
      </Button>
    </Tooltip>
  );
});
