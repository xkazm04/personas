import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { FLEET_STATE_META } from './fleetStateMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { OptionChip } from '@/features/shared/components/forms/OptionChip';

/**
 * Glanceable fleet summary — a row of colored count pills, one per
 * lifecycle state that currently has sessions. Reuses the two-axis dot
 * palette so the at-a-glance read matches the per-session dots below.
 *
 * Each pill is a filter toggle: clicking narrows the session list to that
 * state; clicking the active pill (or "all") clears the filter. This is the
 * desktop shape of the mobile companion's glance view — the same compact
 * status summary a phone would render remotely.
 *
 * Palette + order come from `fleetStateMeta`, shared with the footer status
 * cluster so a state can't read violet here and blue there.
 */

interface FleetSummaryPillsProps {
  /** Count of sessions in each state. */
  counts: Record<FleetSessionState, number>;
  /** Currently-applied state filter, or null for "all". */
  activeFilter: FleetSessionState | null;
  /** Toggle a state filter (passing the active state clears it). */
  onToggle: (state: FleetSessionState) => void;
}

export function FleetSummaryPills({ counts, activeFilter, onToggle }: FleetSummaryPillsProps) {
  const { t, tx } = useTranslation();
  const visible = FLEET_STATE_META.filter((m) => counts[m.id] > 0);
  if (visible.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="fleet-summary-pills">
      {visible.map((m) => {
        const label = t.plugins.fleet[m.labelKey];
        const active = activeFilter === m.id;
        return (
          <Tooltip content={active ? t.plugins.fleet.filter_clear : tx(t.plugins.fleet.filter_by, { label })} key={m.id}><OptionChip data-testid={`fleet-pill-${m.id}`} onSelect={() => onToggle(m.id)} selected={active}><span className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${m.dot}`} aria-hidden="true" />
            <span>{label}</span>
            <span className="font-semibold num">{counts[m.id]}</span></span></OptionChip></Tooltip>
        );
      })}
    </div>
  );
}
