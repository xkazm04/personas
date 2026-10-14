/**
 * Level 1 under the `lanes` setting — the four lane buttons (Breach, Sign,
 * Accept, Talk, keys `1`-`4`), Orphans (`O`) after a divider, then the Ready
 * chip, which is not a decision and keeps its own peek until it moves to the
 * Queue view's header (PLAN section 2).
 *
 * A SLOT like the chip `Strip`: it takes counts and reports presses; the lane
 * hub owns the data. The same width honesty: it measures itself and drops the
 * lane names to the tooltips when they would not fit.
 */
import '../../deck/aurora.css';
import { useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import type { ChipCount } from '../../model/decisionModel';
import { OPERATOR_LANES, type LaneCounts, type LaneKey } from '../../lanes/laneModel';
import { StripChip } from '../visual/StripChip';
import { LaneButton } from './LaneButton';

export type LanePeekKey = LaneKey | 'ready';
export type LaneRefs = MutableRefObject<Partial<Record<LanePeekKey, HTMLButtonElement | null>>>;

export function LaneStrip({ counts, settled, ready, open, refs, onLane, onReady }: {
  counts: LaneCounts;
  settled: boolean;
  ready: ChipCount;
  open: LanePeekKey | null;
  refs: LaneRefs;
  onLane: (lane: LaneKey, anchor: HTMLElement) => void;
  onReady: () => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const still = useReducedMotion();
  const rowRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const labelWidth = useRef(0);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const fit = () => {
      if (!compact && row.scrollWidth > row.clientWidth + 1) {
        labelWidth.current = row.scrollWidth;
        setCompact(true);
      } else if (compact && labelWidth.current > 0 && row.clientWidth >= labelWidth.current) {
        setCompact(false);
      }
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
  }, [compact]);

  const lane = (l: LaneKey) => (
    <LaneButton
      key={l}
      ref={(el) => { refs.current[l] = el; }}
      lane={l}
      count={counts[l]}
      settled={settled}
      compact={compact}
      open={open === l}
      onPress={onLane}
    />
  );

  return (
    <div
      ref={rowRef}
      className="au-scope -mx-1 -my-1.5 flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden px-1 py-1.5"
      data-still={still ? '' : undefined}
    >
      <div
        className={`flex flex-nowrap items-center ${compact ? 'gap-0.5' : 'gap-1'}`}
        role="group"
        aria-label={m.ml_lanes_aria}
        data-testid="decision-lanes"
      >
        {OPERATOR_LANES.map(lane)}
        <span className={`h-6 w-px bg-gradient-to-b from-transparent via-primary/25 to-transparent ${compact ? 'mx-0.5' : 'mx-1'}`} aria-hidden />
        {lane('orphan')}
        <StripChip
          ref={(el) => { refs.current.ready = el; }}
          chip="ready"
          count={ready}
          compact={compact}
          isNext={false}
          open={open === 'ready'}
          onPress={onReady}
        />
      </div>
    </div>
  );
}
