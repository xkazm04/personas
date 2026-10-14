/**
 * One mandate-lane button on the command bar (setting `lanes`): the lane's
 * glyph with its lamp, its name, the count and the key that opens it, printed
 * inside the control (`1`-`4`, `O`).
 *
 * Same aurora reading as a chip (`StripChip`): lit by its lamp only when it
 * holds something; dark and pressable at zero; a source that did not answer
 * shows the failed mark and a tooltip naming the sources, never a 0.
 */
import { forwardRef } from 'react';
import { TriangleAlert } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { URGENCY } from '../../deck/deckMeta';
import { Keycap, Lamp } from '../../deck/parts';
import { LANE_ICON, LANE_KEY, laneHint, laneLabel } from '../../lanes/laneMeta';
import type { LaneCount, LaneKey } from '../../lanes/laneModel';

export interface LaneButtonProps {
  lane: LaneKey;
  count: LaneCount;
  /** The first snapshot read settled; before it the count is a ghost, never 0. */
  settled: boolean;
  compact: boolean;
  open: boolean;
  onPress: (lane: LaneKey, anchor: HTMLElement) => void;
}

export const LaneButton = forwardRef<HTMLButtonElement, LaneButtonProps>(function LaneButton(
  { lane, count, settled, compact, open, onPress },
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
          <TriangleAlert className="h-4 w-4 text-status-error" aria-hidden data-testid={`decision-lane-${lane}-failed`} />
        ) : settled ? (
          <span className="au-count typo-body-lg tabular-nums text-foreground">{count.n}</span>
        ) : (
          <span className="au-hero-tile inline-block h-4 w-3 rounded-interactive" aria-hidden />
        )}
        <Keycap>{key}</Keycap>
      </Button>
    </Tooltip>
  );
});
