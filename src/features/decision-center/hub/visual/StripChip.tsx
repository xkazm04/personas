/**
 * One chip on the strip: icon with its lamp, label (dropped to a tooltip when
 * the bar is narrow), and the count — the hero, in bold tabular figures, that
 * rolls like an odometer when it changes.
 *
 * Aurora reading: a chip glows by URGENCY (a pool of its lamp's light under it,
 * stronger for critical than for waiting). The chip that holds the roster's
 * first item is lit in its lamp colour, wears a slowly circling conic ring and
 * a breathing lamp — the eye lands there first. Zero chips stay in place, dark;
 * a failed source shows a dashed red outline and a warning glyph, never a 0.
 */
import { forwardRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { ChipCount, HubChip } from '../../model/decisionModel';
import { CHIP_META, URGENCY } from '../../deck/deckMeta';
import { Lamp } from '../../deck/parts';

function RollingCount({ n }: { n: number }) {
  const still = useReducedMotion();
  const [prev, setPrev] = useState(n);
  const [dir, setDir] = useState(1);
  if (prev !== n) {
    setDir(n > prev ? 1 : -1);
    setPrev(n);
  }
  return (
    <span className="relative inline-flex h-5 min-w-[0.8rem] items-center justify-center overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span
          key={n}
          custom={dir}
          initial={still ? { opacity: 0 } : { y: dir * 14, opacity: 0, filter: 'blur(2px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={still ? { opacity: 0 } : { y: -dir * 14, opacity: 0, filter: 'blur(2px)' }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className="au-count typo-body-lg tabular-nums text-foreground"
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
  const lit = !zero && !count.failed && count.lamp !== 'neutral';
  const tip = count.failed
    ? `${meta.label}: the source did not answer — count unknown`
    : `${meta.label}: ${count.n} · ${meta.hint}`;

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
        data-urgency={lit ? URGENCY[count.lamp] || undefined : undefined}
        data-next={isNext && !zero ? '' : undefined}
        data-zero={zero ? '' : undefined}
        data-failed={count.failed ? '' : undefined}
        data-open={open ? '' : undefined}
        className={`au-chip au-l-${count.lamp} rounded-input hover:bg-transparent ${count.failed ? 'text-status-error' : zero ? 'text-muted-foreground' : 'text-foreground'} ${compact ? 'px-1.5! [&>span]:gap-1' : 'px-2! [&>span]:gap-1.5'} [&>span]:inline-flex [&>span]:items-center`}
      >
        <span className="relative inline-flex">
          <Icon className="h-4 w-4" aria-hidden />
          {lit && <Lamp tone={count.lamp} breathe={isNext} className="au-chip-lamp" />}
        </span>
        {!compact && <span className="typo-caption text-current">{meta.label}</span>}
        {count.failed ? <TriangleAlert className="h-4 w-4 text-status-error" aria-hidden /> : <RollingCount n={count.n} />}
      </Button>
    </Tooltip>
  );
});
