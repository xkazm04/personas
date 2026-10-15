/**
 * One mandate-lane button on the command bar, built as the Ready chip beside
 * it (`ReadyChip`) is built: the lane's glyph with its corner lamp,
 * its name at caption size, the count in bold figures in the same cell, and,
 * on the most urgent lane holding something, the lead chip's tint and
 * breathing lamp. The name is never dropped (a lane is read by its name).
 *
 * THE KEYCAP LEFT THE CHIP (design pass, 2026-10-15). An inset keycap after the
 * count read as a second number ("Breach 4 [1]") and was boxed chrome no other
 * chip on the bar carries. The key (`1`-`4`, `O`) is in the tooltip and in
 * `aria-keyshortcuts`; the bar reads as one row of one kind of chip.
 *
 * A source that did not answer shows the failed mark and a tooltip naming the
 * sources, never a 0; before the first read settles the count is a ghost.
 */
import { forwardRef } from 'react';
import { TriangleAlert } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { URGENCY } from '../../deck/deckMeta';
import { Lamp } from '../../deck/parts';
import { LANE_ICON, LANE_KEY, laneHint, laneLabel } from '../../lanes/laneMeta';
import type { LaneCount, LaneKey } from '../../lanes/laneModel';

/** 0 = roomy, 1 = tight gaps (LaneStrip measures). */
export type LaneFit = 0 | 1;

export interface LaneButtonProps {
  lane: LaneKey;
  count: LaneCount;
  /** The first snapshot read settled; before it the count is a ghost, never 0. */
  settled: boolean;
  fit: LaneFit;
  /** The most urgent lane holding something: lit like the strip's lead chip. */
  isNext?: boolean;
  open: boolean;
  onPress: (lane: LaneKey, anchor: HTMLElement) => void;
}

export const LaneButton = forwardRef<HTMLButtonElement, LaneButtonProps>(function LaneButton(
  { lane, count, settled, fit, isNext = false, open, onPress },
  ref,
) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const label = laneLabel(m, lane);
  const Icon = LANE_ICON[lane];
  const key = LANE_KEY[lane];
  const zero = settled && !count.failed && count.n === 0;
  const lit = settled && !zero && !count.failed && count.lamp !== 'neutral';
  const tip = count.failed
    ? tx(m.ml_lane_failed, { label, sources: count.failedSources.join(', ') })
    : tx(m.ml_lane_tip, { label, count: count.n, hint: laneHint(m, lane), key });

  return (
    <Tooltip content={tip} placement="bottom">
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        onClick={(e) => onPress(lane, e.currentTarget)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-keyshortcuts={key}
        aria-label={tip}
        data-testid={`decision-lane-${lane}`}
        data-count={count.failed ? 'failed' : settled ? count.n : 'pending'}
        data-urgency={lit ? URGENCY[count.lamp] || undefined : undefined}
        data-next={lit && isNext ? '' : undefined}
        data-zero={zero ? '' : undefined}
        data-failed={count.failed ? '' : undefined}
        data-open={open ? '' : undefined}
        className={`au-chip au-l-${count.lamp} rounded-input hover:bg-transparent ${count.failed ? 'text-status-error' : zero ? 'text-muted-foreground' : 'text-foreground'} ${fit === 0 ? 'px-2! [&>span]:gap-1.5' : 'px-1.5! [&>span]:gap-1'} [&>span]:inline-flex [&>span]:items-center`}
      >
        <span className="relative inline-flex">
          <Icon className="h-4 w-4" aria-hidden />
          {lit && <Lamp tone={count.lamp} breathe={isNext} className="au-chip-lamp" />}
        </span>
        <span className="typo-caption text-current" data-testid={`decision-lane-${lane}-name`}>{label}</span>
        {count.failed ? (
          <TriangleAlert className="h-4 w-4 text-status-error" aria-hidden data-testid={`decision-lane-${lane}-failed`} />
        ) : (
          <span className="relative inline-flex h-5 min-w-[0.8rem] items-center justify-center">
            {settled
              ? <span className="au-count typo-body-lg tabular-nums text-foreground">{count.n}</span>
              : <span className="au-hero-tile inline-block h-4 w-3 rounded-interactive" aria-hidden />}
          </span>
        )}
      </Button>
    </Tooltip>
  );
});
