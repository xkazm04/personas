/**
 * One segment of the strip's segmented control: kind glyph with its severity
 * lamp, the count as the hero figure (an odometer when it changes), and the
 * label in small caps when the bar has room (a tooltip always has it).
 *
 * The lamp lights only for held (amber) and critical or blocking (red) — a
 * row of "waiting" dots is wallpaper. Three honest states: zero (present,
 * quiet ink, lamp off — positions never
 * shift), failed (a warning glyph where the figure would be — never a 0), and
 * "next" (the segment holding the roster's first item: its figure and glyph
 * take the lamp's tone and its lamp breathes). The raised plate slides to the
 * open segment, or rests on "next" when nothing is open.
 */
import { forwardRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { ChipCount, HubChip } from '../../../model/decisionModel';
import { CHIP_META, LAMP_TONE } from './deckMeta';

export function RollingCount({ n, className = 'r2b-seg-count' }: { n: number; className?: string }) {
  const still = useReducedMotion();
  const [prev, setPrev] = useState(n);
  const [dir, setDir] = useState(1);
  if (prev !== n) {
    setDir(n > prev ? 1 : -1);
    setPrev(n);
  }
  return (
    <span className="relative inline-flex h-6 items-center justify-center overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span
          key={n}
          custom={dir}
          initial={still ? { opacity: 0 } : { y: dir * 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={still ? { opacity: 0 } : { y: -dir * 18, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className={`r2b-num ${className}`}
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
  /** The raised plate sits on this segment (open, or next when nothing is open). */
  plate: boolean;
  onPress: () => void;
}

export const StripChip = forwardRef<HTMLButtonElement, StripChipProps>(function StripChip(
  { chip, count, compact, isNext, open, plate, onPress },
  ref,
) {
  const still = useReducedMotion();
  const meta = CHIP_META[chip];
  const Icon = meta.icon;
  const zero = !count.failed && count.n === 0;
  // A lamp is a warning light: only held (amber) and critical / blocking (red) light it.
  const lit = !zero && !count.failed && (count.lamp === 'danger' || count.lamp === 'warning');
  const tip = count.failed
    ? `${meta.label}: the source did not answer — count unknown`
    : `${meta.label}: ${count.n} · ${meta.hint}`;
  const tone = lit ? LAMP_TONE[count.lamp] : 'var(--primary)';

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
        data-testid={`r2b-chip-${chip}`}
        data-plate={plate || undefined}
        data-next={(isNext && !zero) || undefined}
        data-zero={zero || undefined}
        data-failed={count.failed || undefined}
        className="r2b-seg"
        style={{ '--r2b-seg-tone': tone } as CSSProperties}
      >
        {plate && (
          <motion.span
            layoutId={still ? undefined : 'r2b-seg-plate'}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            className="r2b-seg-plate"
            aria-hidden
          />
        )}
        <span className="r2b-seg-icon">
          <Icon className="h-4 w-4" aria-hidden />
          {lit && (
            <span
              className="r2b-lamp"
              data-breathe={(isNext && !still) || undefined}
              style={{ '--r2b-lamp': LAMP_TONE[count.lamp] } as CSSProperties}
              aria-hidden
            />
          )}
        </span>
        {count.failed ? <TriangleAlert className="h-4 w-4 text-status-error" aria-hidden /> : <RollingCount n={count.n} />}
        {!compact && <span className="r2b-seg-label r2b-caps">{meta.label}</span>}
      </Button>
    </Tooltip>
  );
});
