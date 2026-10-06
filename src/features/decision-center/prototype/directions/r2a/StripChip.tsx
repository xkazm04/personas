/**
 * One chip on the glass strip: kind glyph (in its tone) with its severity
 * lamp, label (dropped to a tooltip when the bar is narrow), and the count as
 * the hero, rolling like an odometer when it changes.
 *
 * Honest states: zero (present, dimmed, lamp off — positions never shift),
 * failed (a warning glyph where the number would be — never a 0), and "next"
 * (the chip holding the roster's first item is a RAISED LENS lit by its lamp,
 * and that lamp breathes: it is where the queue starts).
 */
import { forwardRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { ChipCount, HubChip } from '../../../model/decisionModel';
import { CHIP_META } from './deckMeta';

function RollingCount({ n, dim }: { n: number; dim: boolean }) {
  const still = useReducedMotion();
  const [prev, setPrev] = useState(n);
  const [dir, setDir] = useState(1);
  if (prev !== n) {
    setDir(n > prev ? 1 : -1);
    setPrev(n);
  }
  return (
    <span className="r2a-odometer">
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span
          key={n}
          custom={dir}
          initial={still ? { opacity: 0 } : { y: dir * 14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={still ? { opacity: 0 } : { y: -dir * 14, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className={`typo-heading tabular-nums ${dim ? 'text-muted-foreground' : 'text-foreground'}`}
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
  const still = useReducedMotion();
  const meta = CHIP_META[chip];
  const Icon = meta.icon;
  const zero = !count.failed && count.n === 0;
  const lens = isNext && !zero && !count.failed;
  const lit = !zero && !count.failed && count.lamp !== 'neutral';
  const tip = count.failed
    ? `${meta.label}: the source did not answer — count unknown`
    : `${meta.label}: ${count.n} · ${meta.hint}${lens ? ' · starts the queue' : ''}`;
  const state = count.failed ? 'failed' : zero ? 'zero' : 'live';

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
        data-testid={`r2a-chip-${chip}`}
        data-r2a-kind={chip}
        data-r2a-lamp={count.lamp === 'neutral' ? 'accent' : count.lamp}
        data-state={state}
        data-lens={lens}
        data-compact={compact}
        className="r2a-chip r2a-btn"
      >
        <span className="relative inline-flex">
          <Icon className="r2a-chip__icon h-4 w-4" aria-hidden />
          {lit && <span className="r2a-lamp r2a-chip__lamp" data-breathe={lens && !still} aria-hidden />}
        </span>
        {!compact && <span className={`typo-caption ${lens ? 'text-foreground' : ''}`}>{meta.label}</span>}
        {count.failed
          ? <TriangleAlert className="h-4 w-4 text-status-error" aria-hidden />
          : <RollingCount n={count.n} dim={zero} />}
      </Button>
    </Tooltip>
  );
});
