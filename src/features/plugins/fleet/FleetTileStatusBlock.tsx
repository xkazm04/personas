import { CheckCircle2, Sparkle, Clock } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { useTranslation } from '@/i18n/useTranslation';
import { useNowTick, formatAgo } from './relativeAgo';
import { FleetContextPill } from './sub_grid/FleetContextPill';
import type { FleetLabelKey } from './FleetStatusDots';

/**
 * Lightweight "what's it doing" block for an **autonomous** grid tile — a
 * session that does NOT need the operator (running / spawning / idle / stale).
 * No xterm, no PTY subscription, no ring poll: just the high-level state, a
 * heartbeat, and the conversation-size pill. Athena still has full visibility
 * via the backend (operative memory + ring + transcript), so dropping the live
 * terminal here blinds nobody — it just keeps a 9-tile grid calm and cheap.
 *
 * `pointer-events-none` so a click falls through to the tile, which promotes the
 * session to the focused (live) terminal — the manual "peek" escape hatch.
 *
 * (`awaiting_input` renders a real terminal instead; `exited`/`hibernated` never
 * reach the live grid, so they're absent from the visual map below.)
 */
const STATE_VIS: Partial<
  Record<FleetSessionState, { Icon?: typeof CheckCircle2; labelKey: FleetLabelKey; accent: string }>
> = {
  // `running` is intentionally icon-LESS — a spinning loader on every working
  // tile is visual noise at scale (10+ CLIs). The blue label alone reads as
  // "Working" without the distraction; the other (non-animated) states keep a
  // static glance icon.
  running: { labelKey: 'state_working', accent: 'text-blue-400' },
  spawning: { Icon: Sparkle, labelKey: 'state_spawning', accent: 'text-cyan-400' },
  idle: { Icon: CheckCircle2, labelKey: 'state_idle', accent: 'text-emerald-400' },
  stale: { Icon: Clock, labelKey: 'state_stale', accent: 'text-orange-400' },
};

export function FleetTileStatusBlock({ session: s }: { session: FleetSession }) {
  const { t } = useTranslation();
  const now = useNowTick();
  const vis = STATE_VIS[s.state] ?? STATE_VIS.idle!;
  const { Icon } = vis;

  return (
    <div
      data-testid={`fleet-tile-status-${s.id}`}
      className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[#0a0a0c] px-3 py-3 text-center"
    >
      {Icon && <Icon className={`w-6 h-6 ${vis.accent}`} aria-hidden="true" />}
      <span className={`typo-caption font-medium ${vis.accent}`}>{t.plugins.fleet[vis.labelKey]}</span>
      <span className="typo-caption tabular-nums">
        {formatAgo(t, Number(s.lastActivityMs), now)}
      </span>
      <FleetContextPill claudeSessionId={s.claudeSessionId} />
    </div>
  );
}
