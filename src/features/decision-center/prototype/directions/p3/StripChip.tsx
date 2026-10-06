/** One strip chip: icon + count over a label, a severity lamp along its floor. */
import { forwardRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { ChipCount, HubChip } from '../../../model/decisionModel';
import { CHIP_META, DUR, TONE_FILL, TONE_TEXT } from './model';

interface Props {
  chip: HubChip;
  count: ChipCount;
  open: boolean;
  first: boolean;
  reduced: boolean;
  onPress: (chip: HubChip) => void;
}

function tipFor(chip: HubChip, c: ChipCount, first: boolean): string {
  const meta = CHIP_META[chip];
  if (c.failed) return `${meta.label}: the source did not answer — the count is unknown, not zero`;
  if (c.n === 0) return `${meta.label}: nothing waiting`;
  return `${meta.label}: ${c.n} ${meta.noun}${c.n === 1 ? '' : 's'} waiting${first ? ' — holds the most urgent item' : ''}`;
}

export const StripChip = forwardRef<HTMLButtonElement, Props>(function StripChip(
  { chip, count, open, first, reduced, onPress },
  ref,
) {
  const meta = CHIP_META[chip];
  const Icon = meta.icon;
  const zero = !count.failed && count.n === 0;
  const ink = count.failed ? 'text-status-error' : zero ? 'text-muted-foreground' : 'text-foreground';
  const iconInk = count.failed ? 'text-status-error' : zero ? 'text-muted-foreground' : TONE_TEXT[count.lamp];
  const cls = ['p3-chip', open && 'is-open', zero && 'is-zero', count.failed && 'is-failed', first && 'is-first']
    .filter(Boolean)
    .join(' ');
  return (
    <Tooltip content={tipFor(chip, count, first)} placement="bottom">
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        className={cls}
        onClick={() => onPress(chip)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={tipFor(chip, count, first)}
        data-testid={`p3-chip-${chip}`}
      >
        <span className="flex items-center justify-between gap-1.5">
          <Icon className={`h-4 w-4 ${iconInk}`} aria-hidden />
          {count.failed ? (
            <TriangleAlert className="h-4 w-4 text-status-error" aria-hidden />
          ) : (
            <span className="relative inline-flex overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={count.n}
                  className={`typo-data tabular-nums ${ink}`}
                  initial={reduced ? { opacity: 0 } : { y: -10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={reduced ? { opacity: 0 } : { y: 10, opacity: 0 }}
                  transition={{ duration: DUR.fast }}
                >
                  {count.n}
                </motion.span>
              </AnimatePresence>
            </span>
          )}
        </span>
        <span className={`p3-chip__label typo-caption ${count.failed ? 'text-status-error' : zero ? '' : 'text-foreground'}`}>
          {meta.label}
        </span>
        {count.failed ? (
          <span className="p3-chip__lamp is-failed" aria-hidden />
        ) : !zero ? (
          <span className={`p3-chip__lamp ${TONE_FILL[count.lamp]}`} aria-hidden />
        ) : null}
      </Button>
    </Tooltip>
  );
});
