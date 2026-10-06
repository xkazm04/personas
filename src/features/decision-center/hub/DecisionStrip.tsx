/**
 * DecisionStrip — the hub's level 1: seven decision chips, a divider, the
 * `ready` chip, and "Triage all".
 *
 * A SLOT, not a design: it takes counts and reports presses, and holds no
 * state and no data. The prototype direction the operator picks replaces this
 * file's markup; the props are the seam (decision-center spark, A3).
 */
import { ListChecks } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { DECISION_CHIPS, type ChipCount, type HubChip } from '../model/decisionModel';
import { StripChip } from './StripChip';

export interface DecisionStripProps {
  counts: Record<HubChip, ChipCount>;
  /** The chip whose peek is open, or null. */
  active: HubChip | null;
  /** A chip was pressed; `anchor` is the chip, for the peek to hang from. */
  onPick: (chip: HubChip, anchor: HTMLElement) => void;
  onTriageAll: () => void;
  /** Nothing to triage, or the first item is still loading. */
  triageAllDisabled?: boolean;
  /** True while "Triage all" waits for the roster to load. */
  triageAllBusy?: boolean;
}

export function DecisionStrip({
  counts, active, onPick, onTriageAll, triageAllDisabled = false, triageAllBusy = false,
}: DecisionStripProps) {
  const { t } = useTranslation();
  const m = t.monitor;

  return (
    <div className="flex items-center gap-1" role="group" aria-label={m.dc_hub_strip_aria} data-testid="decision-strip">
      {DECISION_CHIPS.map((chip) => (
        <StripChip key={chip} chip={chip} count={counts[chip]} active={active === chip} onPress={onPick} />
      ))}
      <span className="mx-1 h-5 w-px flex-shrink-0 bg-border" aria-hidden />
      <StripChip chip="ready" count={counts.ready} active={active === 'ready'} onPress={onPick} />
      <Tooltip content={m.dc_hub_triage_all_tip}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onTriageAll}
          disabled={triageAllDisabled}
          loading={triageAllBusy}
          icon={<ListChecks className="h-3.5 w-3.5" />}
          aria-label={m.dc_hub_triage_all}
          data-testid="decision-triage-all"
          className="ae-win ae-focus ml-1 rounded-input px-2 py-1"
        >
          <span className="hidden typo-caption text-foreground @[48rem]:inline">{m.dc_hub_triage_all}</span>
        </Button>
      </Tooltip>
    </div>
  );
}
