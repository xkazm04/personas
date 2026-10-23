/**
 * Level 1 of the Decision Center — the four lane buttons (Breach, Sign,
 * Accept, Talk, keys `1`-`4`), Orphans (`O`) after a divider, then the Ready
 * chip, which is not a decision and keeps its own peek until it moves to the
 * Queue view's header (PLAN section 2).
 *
 * A SLOT: it takes counts and reports presses; the lane hub owns the data.
 * Width honesty: it measures itself and, while the row would not fit, Ready's
 * label goes to its tooltip and the gaps tighten. The lane names stay: a lane
 * is read by its name, not its glyph. It steps back up when the row has the
 * width it needed. The most urgent lane holding something is the lead and
 * wears the lead tint.
 */
import '../../deck/aurora.css';
import { useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import type { ChipCount } from '../../model/decisionModel';
import { URGENCY } from '../../deck/deckMeta';
import { OPERATOR_LANES, type LaneCounts, type LaneKey } from '../../lanes/laneModel';
import { ReadyChip } from './ReadyChip';
import { LaneButton, type LaneFit } from './LaneButton';

export type LanePeekKey = LaneKey | 'ready';
export type LaneRefs = MutableRefObject<Partial<Record<LanePeekKey, HTMLButtonElement | null>>>;

/** The lane the eye should land on first: the most urgent operator lane holding something. */
export function leadLane(counts: LaneCounts): LaneKey | null {
  let best: LaneKey | null = null;
  let rank = 0;
  for (const lane of OPERATOR_LANES) {
    const c = counts[lane];
    if (c.failed || c.n === 0) continue;
    const r = URGENCY[c.lamp] + 1;
    if (r > rank) { best = lane; rank = r; }
  }
  return best;
}

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
  const [fit, setFit] = useState<LaneFit>(0);
  /** The row width each level needed when it overflowed (index = level). */
  const needed = useRef<number[]>([]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      if (fit < 1 && row.scrollWidth > row.clientWidth + 1) {
        needed.current[fit] = row.scrollWidth;
        setFit((fit + 1) as LaneFit);
      } else if (fit > 0 && (needed.current[fit - 1] ?? Infinity) <= row.clientWidth) {
        setFit((fit - 1) as LaneFit);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [fit]);
  const compact = fit > 0;
  const lead = leadLane(counts);

  const lane = (l: LaneKey) => (
    <LaneButton
      key={l}
      ref={(el) => { refs.current[l] = el; }}
      lane={l}
      count={counts[l]}
      settled={settled}
      fit={fit}
      isNext={l === lead}
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
        <ReadyChip
          ref={(el) => { refs.current.ready = el; }}
          count={ready}
          compact={compact}
          open={open === 'ready'}
          onPress={onReady}
        />
      </div>
    </div>
  );
}
