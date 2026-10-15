import type { Translations } from '@/i18n/generated/types';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionChip } from '@/features/decision-center/model/decisionModel';
import { laneLabel } from '@/features/decision-center/lanes/laneMeta';
import { OPERATOR_LANES, type LaneCounts } from '@/features/decision-center/lanes/laneModel';

/** A decision chip's name, as the Home widget's drawer prints it (the badge's tooltip reads lanes since the WP10 cutover). */
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
 * The decision badge's tooltip: the badge's own line, then one row per lane
 * the badge counts (Breach, Sign, Accept, Talk, in the command bar's order),
 * so the number on the capsule reads back as the sum it is. Orphans are not a
 * card the operator holds and are not in the badge, so not here either. A
 * lane whose source did not answer says so instead of printing a number (the
 * roster's "never a confident 0" law); before the first lanes read settles
 * there is no breakdown to read, only the heading.
 */
export function TitleBarDecisionTooltip({
  heading,
  lanes,
  settled,
}: {
  heading: string;
  lanes: LaneCounts;
  /** The first lanes snapshot read settled; before it the rows would be guesses. */
  settled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-40 flex-col gap-0.5" data-testid="titlebar-decision-tooltip">
      <span className="typo-caption text-foreground">{heading}</span>
      {settled && OPERATOR_LANES.map((lane) => {
        const c = lanes[lane];
        return (
          <span key={lane} className="flex items-center justify-between gap-4 typo-caption" data-testid={`titlebar-decision-lane-${lane}`}>
            <span>{laneLabel(t.monitor, lane)}</span>
            <span className={`tabular-nums ${c.n > 0 && !c.failed ? 'text-foreground' : ''}`}>
              {c.failed ? t.monitor.dc_consumers_chip_failed : c.n}
            </span>
          </span>
        );
      })}
    </div>
  );
}
