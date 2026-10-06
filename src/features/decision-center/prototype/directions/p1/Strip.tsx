/**
 * Level 1 — the strip, as it will sit in the Activity CommandBar: Triage-all
 * lead (the total and the first item), the seven decision chips, a divider,
 * the Ready chip, then a 440 px stand-in for the CommandBar's own controls so
 * the width is honest.
 */
import { ListChecks } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import {
  chipOf, DECISION_CHIPS, type ChipCount, type DecisionItem, type HubChip,
} from '../../../model/decisionModel';
import { COPY } from './copy';
import { StripChip } from './StripChip';

interface StripProps {
  items: DecisionItem[];
  counts: Record<HubChip, ChipCount>;
  openChip: HubChip | null;
  onToggle: (chip: HubChip) => void;
  onTriageAll: () => void;
}

export function Strip({ items, counts, openChip, onToggle, onTriageAll }: StripProps) {
  const first = items[0];
  const nextChip = first ? chipOf(first.kind) : null;
  const total = items.length;

  return (
    <div className="flex min-h-[52px] flex-shrink-0 flex-nowrap items-center gap-4 border-b border-border px-3 py-2" data-testid="p1-strip-row">
      <div className="p1-strip flex min-w-0 flex-1 flex-nowrap items-center gap-0.5" role="toolbar" aria-label={COPY.strip.triageAll}>
        <Tooltip content={first ? `${COPY.strip.next}: ${first.title}` : COPY.strip.none} placement="bottom">
          <Button
            variant="primary"
            size="sm"
            onClick={onTriageAll}
            disabled={total === 0}
            data-p1-chip="all"
            data-testid="p1-triage-all"
            className="mr-1 shrink-0 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-2"
            icon={<ListChecks className="h-4 w-4" aria-hidden />}
          >
            <span className="p1-triage-label typo-label">{COPY.strip.triageAll}</span>
            <AnimatedCounter value={total} mode="roll" className="typo-label tabular-nums" />
          </Button>
        </Tooltip>
        {DECISION_CHIPS.map((chip) => (
          <StripChip
            key={chip}
            chip={chip}
            count={counts[chip]}
            open={openChip === chip}
            next={nextChip === chip}
            onToggle={onToggle}
          />
        ))}
        <span className="p1-divider" aria-hidden />
        <StripChip chip="ready" count={counts.ready} open={openChip === 'ready'} next={false} onToggle={onToggle} />
        {first && (
          <span className="ml-3 min-w-0 flex-1 truncate typo-caption" data-testid="p1-next-line">
            <span className="typo-label text-primary">{COPY.strip.next}</span> {first.title}
          </span>
        )}
      </div>
      <div className="p1-placeholder" aria-hidden>
        <span className="typo-caption">{COPY.strip.fleetPlaceholder}</span>
      </div>
    </div>
  );
}

/** A quiet stand-in for the fleet floor so the strip reads in context. */
export function FloorStandIn() {
  return (
    <div className="p1-floor min-h-0 flex-1" aria-hidden>
      {Array.from({ length: 24 }, (_, i) => <div key={i} className="p1-tile" />)}
    </div>
  );
}
