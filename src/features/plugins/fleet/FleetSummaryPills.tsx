import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { Translations } from '@/i18n/generated/types';

/**
 * Glanceable fleet summary — a row of colored count pills, one per
 * lifecycle state that currently has sessions. Reuses the two-axis dot
 * palette so the at-a-glance read matches the per-session dots below.
 *
 * Each pill is a filter toggle: clicking narrows the session list to that
 * state; clicking the active pill (or "all") clears the filter. This is the
 * desktop shape of the mobile companion's glance view — the same compact
 * status summary a phone would render remotely.
 */

type FleetTranslations = Translations['plugins']['fleet'];

const STATE_META: ReadonlyArray<{
  id: FleetSessionState;
  /** Tailwind dot fill. */
  dot: string;
  /** plugins.fleet key for the short label. */
  labelKey: keyof FleetTranslations;
}> = [
  { id: 'awaiting_input', dot: 'bg-violet-400', labelKey: 'state_awaiting_input' },
  { id: 'running', dot: 'bg-blue-400', labelKey: 'state_working' },
  { id: 'spawning', dot: 'bg-cyan-400', labelKey: 'state_spawning' },
  { id: 'idle', dot: 'bg-emerald-400', labelKey: 'state_idle' },
  { id: 'stale', dot: 'bg-orange-400', labelKey: 'state_stale' },
  { id: 'hibernated', dot: 'bg-indigo-400', labelKey: 'state_hibernated' },
  { id: 'exited', dot: 'bg-zinc-500', labelKey: 'state_exited' },
];

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
  const visible = STATE_META.filter((m) => counts[m.id] > 0);
  if (visible.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="fleet-summary-pills">
      {visible.map((m) => {
        const label = t.plugins.fleet[m.labelKey];
        const active = activeFilter === m.id;
        return (
          <button
            key={m.id}
            type="button"
            data-testid={`fleet-pill-${m.id}`}
            aria-pressed={active}
            onClick={() => onToggle(m.id)}
            title={active ? t.plugins.fleet.filter_clear : tx(t.plugins.fleet.filter_by, { label })}
            className={`flex items-center gap-1.5 rounded-interactive border px-2 py-0.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${
              active
                ? 'border-primary/40 bg-primary/15 text-foreground'
                : 'border-primary/10 bg-secondary/40 text-foreground hover:bg-secondary/60'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${m.dot}`} aria-hidden="true" />
            <span>{label}</span>
            <span className="font-semibold tabular-nums">{counts[m.id]}</span>
          </button>
        );
      })}
    </div>
  );
}
