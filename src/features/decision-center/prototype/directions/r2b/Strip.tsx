/**
 * Level 1 — the strip, as it will sit in the Activity CommandBar: ONE
 * continuous segmented control (seven decision segments, a double rule, the
 * Ready segment) with a raised plate that slides to the open segment, then the
 * one inverted control — Triage all, its total as a figure — and a 440 px
 * stand-in for the bar's existing fleet tally + layout switch.
 *
 * Width honesty: the strip measures itself and drops segment labels to
 * tooltips (glyph + lamp + figure) when labels would not fit beside the
 * stand-in, so the row never wraps at a 1280 px window.
 */
import { useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { LayoutGroup } from 'framer-motion';
import { Layers } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { DECISION_CHIPS, chipOf, type ChipCount, type DecisionItem, type HubChip } from '../../../model/decisionModel';
import { RollingCount, StripChip } from './StripChip';

export function Strip({ counts, items, openChip, chipRefs, onChip, onTriageAll }: {
  counts: Record<HubChip, ChipCount>;
  items: DecisionItem[];
  openChip: HubChip | null;
  chipRefs: MutableRefObject<Partial<Record<HubChip | 'all', HTMLButtonElement | null>>>;
  onChip: (chip: HubChip) => void;
  onTriageAll: () => void;
}) {
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
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
  }, [compact]);
  const first = items[0];
  const nextChip = first ? chipOf(first.kind) : null;
  const plateOn = openChip ?? nextChip;
  const total = DECISION_CHIPS.reduce((n, c) => n + (counts[c].failed ? 0 : counts[c].n), 0);

  const chip = (c: HubChip) => (
    <StripChip
      key={c}
      ref={(el) => { chipRefs.current[c] = el; }}
      chip={c}
      count={counts[c]}
      compact={compact}
      isNext={c === nextChip}
      open={openChip === c}
      plate={plateOn === c}
      onPress={() => onChip(c)}
    />
  );

  return (
    <div ref={rowRef} className="r2b-strip" data-compact={compact || undefined} data-testid="r2b-strip">
      <LayoutGroup id="r2b-strip">
        <div className="r2b-seg-group" role="group" aria-label="Decisions">
          {DECISION_CHIPS.map(chip)}
          <span className="r2b-seg-gap" aria-hidden />
          {chip('ready')}
        </div>
      </LayoutGroup>
      <Tooltip content={first ? `Walk all ${total} in order — starts with “${first.title}”` : 'Nothing waiting'} placement="bottom">
        <Button
          ref={(el) => { chipRefs.current.all = el; }}
          variant="primary"
          size="sm"
          onClick={onTriageAll}
          disabled={total === 0}
          icon={<Layers className="h-4 w-4" aria-hidden />}
          data-testid="r2b-triage-all"
          className="r2b-triage whitespace-nowrap"
        >
          <span className="typo-heading text-current">{compact ? 'All' : 'Triage all'}</span>
          <RollingCount n={total} />
        </Button>
      </Tooltip>
      <div className="r2b-standin typo-caption" aria-hidden>
        fleet tally · layout switch · simulation toggle (440 px)
      </div>
    </div>
  );
}
