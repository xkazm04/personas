/**
 * Level 1 — the strip, in the Activity CommandBar: seven decision chips in
 * strip order, a divider, the Ready chip, and "Triage all".
 *
 * A SLOT: it takes counts and reports presses; the hub owns the data.
 *
 * Width honesty: the strip measures itself and drops chip labels to tooltips
 * (icon + lamp + count) when labels would not fit the band's free width, so the
 * bar never wraps at a 1280 px window beside the fleet tally and the layout
 * switch. The row clips (it is how overflow is measured), so it carries its own
 * breathing room for the chips' glow and focus ring and gives it back with a
 * negative margin — the bar's height does not change.
 */
import '../../deck/aurora.css';
import { useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { Layers } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import { DECISION_CHIPS, type ChipCount, type HubChip } from '../../model/decisionModel';
import { leadChip } from '../chipMeta';
import { StripChip } from './StripChip';

export type StripRefs = MutableRefObject<Partial<Record<HubChip | 'all', HTMLButtonElement | null>>>;

export function Strip({ counts, total, openChip, chipRefs, onChip, onTriageAll }: {
  counts: Record<HubChip, ChipCount>;
  /** Sum of the seven decision chips (the roster's `total`). */
  total: number;
  openChip: HubChip | null;
  chipRefs: StripRefs;
  onChip: (chip: HubChip, anchor: HTMLElement) => void;
  onTriageAll: (anchor: HTMLElement) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const still = useReducedMotion();
  const rowRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const labelWidth = useRef(0);

  // Labels while they fit: measured, not guessed. In label mode an overflowing
  // row records the width labels need and goes compact; a compact row goes
  // back to labels once it is at least that wide again.
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

  const lead = leadChip(counts);

  const chip = (c: HubChip) => (
    <StripChip
      key={c}
      ref={(el) => { chipRefs.current[c] = el; }}
      chip={c}
      count={counts[c]}
      compact={compact}
      isNext={c === lead}
      open={openChip === c}
      onPress={onChip}
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
        aria-label={m.dc_hub_strip_aria}
        data-testid="decision-strip"
      >
        {DECISION_CHIPS.map(chip)}
        <span className={`h-6 w-px bg-gradient-to-b from-transparent via-primary/25 to-transparent ${compact ? 'mx-0.5' : 'mx-1'}`} aria-hidden />
        {chip('ready')}
      </div>
      <Tooltip content={total > 0 ? tx(m.dc_hub_triage_all_walk_tip, { count: total }) : m.dc_hub_triage_all_none} placement="bottom">
        <Button
          ref={(el) => { chipRefs.current.all = el; }}
          variant="primary"
          size="sm"
          onClick={(e) => onTriageAll(e.currentTarget)}
          disabled={total === 0}
          icon={<Layers className="h-4 w-4" aria-hidden />}
          aria-label={m.dc_hub_triage_all}
          data-testid="decision-triage-all"
          className={`au-triage au-sheen flex-shrink-0 whitespace-nowrap rounded-input ${compact ? 'pl-1.5! pr-1!' : 'pl-3! pr-1!'} [&>span:last-child]:inline-flex [&>span:last-child]:items-center [&>span:last-child]:gap-2`}
        >
          {compact ? m.dc_hub_triage_all_short : m.dc_hub_triage_all}
          <span className="au-triage-count au-count inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-interactive px-1.5 typo-body-lg tabular-nums">{total}</span>
        </Button>
      </Tooltip>
    </div>
  );
}
