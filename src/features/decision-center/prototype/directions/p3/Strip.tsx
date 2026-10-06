/**
 * Level 1 — the switchboard. Seven decision chips + Ready, then the queue HEAD
 * printed in words (the one thing to do first), then Triage all. A 440 px
 * placeholder stands in for the CommandBar's fleet tally so the width is honest.
 */
import { useRef, type ReactNode, type RefObject } from 'react';
import { Activity, Play } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import {
  chipOf, DECISION_CHIPS,
  type ChipCount, type DecisionItem, type HubChip,
} from '../../../model/decisionModel';
import { CHIP_META, TIER_TONE, TONE_FILL, tierOf } from './model';
import { StripChip } from './StripChip';

interface Props {
  items: DecisionItem[];
  counts: Record<HubChip, ChipCount>;
  openChip: HubChip | null;
  reduced: boolean;
  onChip: (chip: HubChip) => void;
  onTriageAll: () => void;
  onOpenHead: () => void;
  /** Renders the peek under the chip that owns it. */
  renderPeek: (chip: HubChip, anchor: RefObject<HTMLElement | null>) => ReactNode;
}

export function Strip({ items, counts, openChip, reduced, onChip, onTriageAll, onOpenHead, renderPeek }: Props) {
  const head = items[0];
  const headChip = head ? chipOf(head.kind) : null;
  const total = DECISION_CHIPS.reduce((n, c) => n + counts[c].n, 0);
  const chipCell = (chip: HubChip) => (
    <ChipCell key={chip} chip={chip} count={counts[chip]} open={openChip === chip} first={chip === headChip}
      reduced={reduced} onChip={onChip} renderPeek={renderPeek} />
  );
  return (
    <div className="p3-strip flex h-[60px] flex-shrink-0 items-center gap-2 border-b border-border px-3" data-testid="p3-strip">
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10" aria-hidden>
        <Activity className="h-4 w-4 text-primary" />
      </span>
      <div className="flex flex-shrink-0 items-center gap-0.5" role="group" aria-label="Decisions by kind">
        {DECISION_CHIPS.map(chipCell)}
        <span className="mx-1.5 h-8 w-px bg-border" aria-hidden />
        {chipCell('ready')}
      </div>
      <div className="p3-head-wrap min-w-0 flex-1 items-center gap-2">
        {head ? (
          <Tooltip content={`Most urgent: ${head.title} — ${CHIP_META[headChip!].label}`} placement="bottom"
            triggerClassName="flex min-w-0 max-w-full">
            <Button variant="ghost" size="sm" onClick={onOpenHead} className="min-w-0 max-w-full overflow-hidden [&>span]:min-w-0" data-testid="p3-head">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${TONE_FILL[TIER_TONE[tierOf(head)]]}`} aria-hidden />
                <span className="typo-label flex-shrink-0 text-status-error">First</span>
                <span className="typo-body min-w-0 truncate text-foreground">{head.title}</span>
              </span>
            </Button>
          </Tooltip>
        ) : (
          <span className="typo-caption">All clear</span>
        )}
      </div>
      <Tooltip content={`Triage all — walk all ${total} items, most urgent first`} placement="bottom">
        <Button
          variant="accent"
          tone="highlight"
          size="sm"
          onClick={onTriageAll}
          disabled={total === 0}
          icon={<Play className="h-3.5 w-3.5" aria-hidden />}
          aria-label={`Triage all ${total}`}
          data-testid="p3-triage-all"
          className="ml-auto flex-shrink-0"
        >
          <span className="typo-body"><span className="p3-wide">Triage all </span><span className="typo-data tabular-nums">{total}</span></span>
        </Button>
      </Tooltip>
      <div className="p3-placeholder flex items-center justify-center" aria-hidden>
        <span className="typo-caption">Fleet tally · layout · simulation (440 px)</span>
      </div>
    </div>
  );
}

function ChipCell({ chip, count, open, first, reduced, onChip, renderPeek }: {
  chip: HubChip; count: ChipCount; open: boolean; first: boolean; reduced: boolean;
  onChip: (chip: HubChip) => void; renderPeek: Props['renderPeek'];
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="relative">
      <StripChip chip={chip} count={count} open={open} first={first} reduced={reduced} onPress={onChip} />
      {renderPeek(chip, ref)}
    </div>
  );
}
