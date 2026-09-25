// RemoteTerminalMirror — the drawer's read-only view of the remote terminal.
//
// Permanent chrome (the title strip) with the xterm under it. Until the first
// chunk of the tail arrives, a calm ghost sits OVER the empty terminal body -
// never a spinner (overview-loading law: a surface loading its data shows a
// ghost under its chrome). The ghost only fades; nothing moves or loops.

import { useRef } from 'react';
import { SquareTerminal } from 'lucide-react';
import { useFleetTerminalConfig } from '@/features/plugins/fleet/useFleetTerminalConfig';
import { useTranslation } from '@/i18n/useTranslation';
import { useRemoteTerminalMirror } from './useRemoteTerminalMirror';

/** Ghost line widths - a terminal-shaped silhouette, not a progress signal. */
const GHOST_LINES = ['62%', '48%', '71%', '35%', '56%'];

export function RemoteTerminalMirror({ jobId, device }: { jobId: string; device: string }) {
  const { t, tx } = useTranslation();
  // Font, size and theme follow the operator's fleet terminal settings.
  useFleetTerminalConfig();
  const container = useRef<HTMLDivElement>(null);
  const received = useRemoteTerminalMirror(jobId, container, t.monitor.remote_output_skipped);

  return (
    <section
      aria-label={t.monitor.remote_terminal_title}
      className="overflow-hidden rounded-card border border-primary/10 bg-secondary/15"
      data-testid="remote-terminal-mirror"
    >
      <div className="flex h-8 items-center gap-1.5 border-b border-primary/10 px-3">
        <SquareTerminal className="h-3.5 w-3.5 text-foreground" aria-hidden />
        <span className="typo-label text-foreground">{t.monitor.remote_terminal_title}</span>
      </div>
      <div className="relative h-72">
        <div ref={container} className="absolute inset-0 px-2 py-1.5" data-testid="remote-terminal-host" />
        {!received && (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col gap-2 px-3 py-3 animate-fade-in"
            data-testid="remote-terminal-ghost"
          >
            <span className="sr-only" role="status">{tx(t.monitor.remote_terminal_waiting, { device })}</span>
            {GHOST_LINES.map((w, i) => (
              <span key={i} aria-hidden className="h-2.5 rounded-interactive bg-foreground/[0.06]" style={{ width: w }} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default RemoteTerminalMirror;
