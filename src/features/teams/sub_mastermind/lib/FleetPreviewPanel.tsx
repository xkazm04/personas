// CLI window preview popover — opened from a Fleet node on any canvas layer.
// Embeds the managed live terminal (FleetTerminalPane): fully interactive, so
// the user types directly into the rendered window — no separate reply row.
// Headless and exited sessions have no TTY — they get a status body instead.
import { X } from 'lucide-react';

import { FleetTerminalPane } from '@/features/plugins/fleet/FleetTerminalPane';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { Translations } from '@/i18n/generated/types';
import { useTranslation } from '@/i18n/useTranslation';

import { FLEET_INK, mix, MONO } from './ink';

/** Session state → the Fleet grid's own translated labels (never render the
 *  raw machine token — CLAUDE.md status-token rule). */
const stateLabel = (t: Translations, s: string) =>
  ({
    spawning: t.plugins.fleet.state_spawning,
    running: t.plugins.fleet.state_working,
    awaiting_input: t.plugins.fleet.state_awaiting_input,
    idle: t.plugins.fleet.state_idle,
    stale: t.plugins.fleet.state_stale,
    hibernated: t.plugins.fleet.state_hibernated,
    exited: t.plugins.fleet.state_exited,
  })[s] ?? s;

export function FleetPreviewPanel({ sessionId, session, onClose }: {
  sessionId: string;
  /** Live session row from the fleet store — null for demo/vanished sessions. */
  session: FleetSession | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const live = session !== null && session.state !== 'exited' && session.mode !== 'headless';
  const ink = FLEET_INK[session?.state ?? 'exited'] ?? 'var(--status-neutral)';
  const label = session ? session.name ?? session.title ?? session.projectLabel : sessionId;

  return (
    <div
      className="absolute bottom-16 right-3 z-20 w-[440px] rounded-card border border-primary/15 bg-secondary/95 shadow-elevation-3 overflow-hidden"
      data-testid="mm-fleet-preview"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ink, boxShadow: `0 0 6px ${mix(ink, 60)}` }} aria-hidden />
        <span className="typo-body font-medium text-foreground truncate">{label}</span>
        <span className="typo-caption text-foreground/55 shrink-0" style={{ fontFamily: MONO }}>
          {stateLabel(t, session?.state ?? 'exited')}
        </span>
        {session?.stateReason && <span className="typo-caption text-foreground/45 truncate">— {session.stateReason}</span>}
        <button
          type="button"
          onClick={onClose}
          aria-label={t.mastermind.fleet_close_preview}
          className="ml-auto shrink-0 p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-fleet-preview-close"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <div className="h-[280px] bg-background/80">
        {live ? (
          <FleetTerminalPane sessionId={sessionId} className="h-full" autoFocus={false} />
        ) : (
          <p className="typo-caption text-foreground/50 px-3 py-4">
            {session ? (session.mode === 'headless' ? t.mastermind.fleet_headless : t.mastermind.fleet_gone) : t.mastermind.fleet_demo}
          </p>
        )}
      </div>
    </div>
  );
}
