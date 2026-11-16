// CLI window preview popover — opened from a Fleet node on any canvas layer.
// Embeds the managed live terminal (FleetTerminalPane): fully interactive, so
// the user types directly into the rendered window — no separate reply row.
// Headless and exited sessions have no TTY — they get a status body instead.
import { X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';

import { FleetTerminalPane } from '@/features/plugins/fleet/FleetTerminalPane';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';

import { fleetStateLabel as stateLabel } from './fleetMeta';
import { FLEET_INK, MONO } from './ink';

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
      className="absolute bottom-16 right-3 z-20 w-[440px] rounded-card border border-hair bg-secondary/95 shadow-elevation-3 overflow-hidden"
      data-testid="mm-fleet-preview"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hair">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ink }} aria-hidden />
        <span className="typo-body text-foreground truncate">{label}</span>
        <span className="typo-caption text-ink-3 shrink-0" style={{ fontFamily: MONO }}>
          {stateLabel(t, session?.state ?? 'exited')}
        </span>
        {session?.stateReason && <span className="typo-caption text-ink-3 truncate">— {session.stateReason}</span>}
        <Button variant="ghost" size="icon-sm" className="ml-auto shrink-0" onClick={onClose} aria-label={t.mastermind.fleet_close_preview} data-testid="mm-fleet-preview-close">
          <X className="w-4 h-4" aria-hidden />
        </Button>
      </div>

      <div className="h-[280px] bg-background/80">
        {live ? (
          <FleetTerminalPane sessionId={sessionId} className="h-full" autoFocus={false} live={session?.state !== 'hibernated'} />
        ) : (
          <p className="typo-caption text-ink-3 px-3 py-4">
            {session ? (session.mode === 'headless' ? t.mastermind.fleet_headless : t.mastermind.fleet_gone) : t.mastermind.fleet_demo}
          </p>
        )}
      </div>
    </div>
  );
}
