import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { FleetTransition } from '@/stores/slices/system/fleetSlice';
import type { FleetLabelKey } from './FleetStatusDots';

/**
 * Tiny inline timeline of a session's recent lifecycle transitions — one
 * colored tick per state change, oldest → newest, using the shared status
 * palette. Lets you spot a flapping session (rapid alternation) or one
 * that's been stuck in a single colour at a glance, without opening it.
 *
 * Fed by the in-memory `fleetTransitions` ring-buffer; renders nothing until
 * there are at least two recorded states.
 */

const STATE_BAR: Record<FleetSessionState, { bg: string; labelKey: FleetLabelKey }> = {
  spawning: { bg: 'bg-cyan-400', labelKey: 'state_spawning' },
  running: { bg: 'bg-blue-400', labelKey: 'state_working' },
  awaiting_input: { bg: 'bg-violet-400', labelKey: 'state_awaiting_input' },
  idle: { bg: 'bg-emerald-400', labelKey: 'state_idle' },
  stale: { bg: 'bg-orange-400', labelKey: 'state_stale' },
  exited: { bg: 'bg-zinc-500', labelKey: 'state_exited' },
};

const MAX_TICKS = 10;

export function FleetStateSparkline({ transitions }: { transitions: FleetTransition[] }) {
  const { t } = useTranslation();
  if (transitions.length < 2) return null;
  const recent = transitions.slice(-MAX_TICKS);
  return (
    <span
      role="img"
      aria-label={t.plugins.fleet.history_label}
      data-testid="fleet-state-sparkline"
      className="flex items-end gap-px shrink-0"
    >
      {recent.map((tr, i) => {
        const cfg = STATE_BAR[tr.state];
        return (
          <span
            key={`${tr.at}-${i}`}
            title={t.plugins.fleet[cfg.labelKey]}
            className={`h-3 w-0.5 rounded-full ${cfg.bg} ${i === recent.length - 1 ? '' : 'opacity-60'}`}
          />
        );
      })}
    </span>
  );
}
