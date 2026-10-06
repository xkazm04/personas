/**
 * One chip of the strip: glyph with its severity lamp, word, count. Zero dims
 * it in place (it never leaves, so positions never shift); a failed source
 * swaps the count for a warning glyph, because "did not answer" is not
 * "nothing waiting". At narrow widths the word folds into the tooltip —
 * except on the chip that holds the next item, which keeps its word.
 */
import { forwardRef } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import type { ChipCount, HubChip } from '../../../model/decisionModel';
import { COPY } from './copy';
import { CHIP_ICON } from './meta';

interface StripChipProps {
  chip: HubChip;
  count: ChipCount;
  open: boolean;
  next: boolean;
  onToggle: (chip: HubChip) => void;
}

export const StripChip = forwardRef<HTMLButtonElement, StripChipProps>(function StripChip(
  { chip, count, open, next, onToggle }, ref,
) {
  const Icon = CHIP_ICON[chip];
  const zero = !count.failed && count.n === 0;
  const tip = count.failed
    ? `${COPY.chip[chip]}: ${COPY.strip.failed}`
    : `${COPY.chip[chip]} · ${count.n} — ${COPY.chipHint[chip]}`;
  const lamp = count.failed ? 'danger' : zero ? 'neutral' : count.lamp;

  return (
    <Tooltip content={tip} placement="bottom">
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        onClick={() => onToggle(chip)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={tip}
        data-p1-chip={chip}
        data-testid={`p1-chip-${chip}`}
        className={`p1-chip ${zero ? 'is-zero' : ''} ${next ? 'is-next' : ''} ${count.failed ? 'is-failed' : ''}`}
      >
        <span className="p1-chip-ink">
          <span className="p1-chip-glyph">
            <Icon className="h-4 w-4 text-foreground" aria-hidden />
            <span className={`p1-lamp is-${lamp}`} aria-hidden />
          </span>
          <span className="p1-chip-label typo-label text-foreground">{COPY.chip[chip]}</span>
          {count.failed ? (
            <TriangleAlert className="h-4 w-4 text-status-error" aria-hidden />
          ) : (
            <AnimatedCounter value={count.n} mode="roll" className="typo-data tabular-nums text-foreground" />
          )}
        </span>
      </Button>
    </Tooltip>
  );
});
