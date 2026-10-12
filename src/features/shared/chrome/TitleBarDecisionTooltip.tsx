import type { Translations } from '@/i18n/generated/types';
import { useTranslation } from '@/i18n/useTranslation';
import {
  DECISION_CHIPS,
  type ChipCount,
  type DecisionChip,
  type HubChip,
} from '@/features/decision-center/model/decisionModel';

/** A decision chip's name, as the badge's tooltip and the Home widget print it. */
export function decisionChipLabel(chip: DecisionChip, t: Translations): string {
  const m = t.monitor;
  switch (chip) {
    case 'gates': return m.dc_consumers_chip_gates;
    case 'proposals': return m.dc_consumers_chip_proposals;
    case 'backlog': return m.dc_consumers_chip_backlog;
    case 'incidents': return m.dc_consumers_chip_incidents;
    case 'council': return m.dc_consumers_chip_council;
    case 'reports': return m.dc_consumers_chip_reports;
    case 'chat': return m.dc_consumers_chip_chat;
  }
}

/**
 * The decision badge's tooltip: the badge's own line, then one row per decision
 * chip in strip order — so the number on the capsule can be read back as the
 * sum it is. A chip whose source did not answer says so instead of printing a
 * number (the roster's "never a confident 0" law).
 */
export function TitleBarDecisionTooltip({
  heading,
  counts,
}: {
  heading: string;
  counts: Record<HubChip, ChipCount>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-40 flex-col gap-0.5" data-testid="titlebar-decision-tooltip">
      <span className="typo-caption text-foreground">{heading}</span>
      {DECISION_CHIPS.map((chip) => {
        const c = counts[chip];
        return (
          <span key={chip} className="flex items-center justify-between gap-4 typo-caption">
            <span>{decisionChipLabel(chip, t)}</span>
            <span className={`tabular-nums ${c.n > 0 ? 'text-foreground' : ''}`}>
              {c.failed ? t.monitor.dc_consumers_chip_failed : c.n}
            </span>
          </span>
        );
      })}
    </div>
  );
}
