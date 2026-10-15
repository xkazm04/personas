/**
 * The Ready chip at the end of the lane strip: accepted ideas awaiting
 * dispatch. Not a decision, so it is never the lead. Icon with its lamp, label
 * (dropped to the tooltip when the bar is narrow), and the count, in bold
 * tabular figures, that rolls like an odometer when it changes.
 *
 * Aurora reading (R2-C): a chip glows by URGENCY (a pool of its lamp's light
 * under it). Zero stays in place, dark and pressable; a source that did not
 * answer shows a dashed outline and a warning glyph, never a 0 (a 0 there
 * would be a confident lie about nothing waiting).
 *
 * Until the mandate-lanes cutover (WP10, 2026-10-15) this was `StripChip`, one
 * of eight on the chip strip; the lane buttons are built in its image.
 */
import { forwardRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Rocket, TriangleAlert } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { MOTION } from '@/lib/utils/designTokens';

import type { ChipCount } from '../../model/decisionModel';
import { URGENCY } from '../../deck/deckMeta';
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
          transition={still ? { duration: MOTION.duration.fast / 1000 } : { type: 'spring', ...MOTION.spring.snappy }}
          className="au-count typo-body-lg tabular-nums text-foreground"
        >
          {n}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export interface ReadyChipProps {
  count: ChipCount;
  compact: boolean;
  open: boolean;
  onPress: (anchor: HTMLElement) => void;
}

const chip = 'ready';

export const ReadyChip = forwardRef<HTMLButtonElement, ReadyChipProps>(function ReadyChip(
  { count, compact, open, onPress },
  ref,
) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const label = m.dc_hub_chip_ready;
  const Icon = Rocket;
  const zero = !count.failed && count.n === 0;
  const lit = !zero && !count.failed && count.lamp !== 'neutral';
  const tip = count.failed
    ? tx(m.dc_hub_chip_failed, { label })
    : tx(m.dc_hub_chip_tip_hint, { label, count: count.n, hint: m.dc_hub_hint_ready });

  return (
    <Tooltip content={tip} placement="bottom">
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        onClick={(e) => onPress(e.currentTarget)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={tip}
        data-testid={`decision-chip-${chip}`}
        data-count={count.failed ? 'failed' : count.n}
        data-urgency={lit ? URGENCY[count.lamp] || undefined : undefined}
        data-zero={zero ? '' : undefined}
        data-failed={count.failed ? '' : undefined}
        data-open={open ? '' : undefined}
        className={`au-chip au-l-${count.lamp} rounded-input hover:bg-transparent ${count.failed ? 'text-status-error' : zero ? 'text-muted-foreground' : 'text-foreground'} ${compact ? 'px-1.5! [&>span]:gap-1' : 'px-2! [&>span]:gap-1.5'} [&>span]:inline-flex [&>span]:items-center`}
      >
        <span className="relative inline-flex">
          <Icon className="h-4 w-4" aria-hidden />
          {lit && <Lamp tone={count.lamp} className="au-chip-lamp" />}
        </span>
        {!compact && <span className="typo-caption text-current">{label}</span>}
        {count.failed ? (
          <TriangleAlert className="h-4 w-4 text-status-error" aria-hidden data-testid={`decision-chip-${chip}-failed`} />
        ) : (
          <RollingCount n={count.n} />
        )}
      </Button>
    </Tooltip>
  );
});
