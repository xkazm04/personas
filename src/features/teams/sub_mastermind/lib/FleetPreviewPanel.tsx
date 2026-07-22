// CLI window preview popover — opened from a Fleet dock node on any canvas
// layer. Embeds the managed live terminal (FleetTerminalPane — master retired
// the polled tile-preview path, so the durable xterm manager is the one
// terminal surface). The pane is interactive: typing goes straight to the
// PTY; the reply row remains for quick submit-with-Enter messages. Headless
// and exited sessions have no TTY — they get a status body instead.
import { useState } from 'react';
import { Send, X } from 'lucide-react';

import { writeInput } from '@/api/fleet/fleet';
import { FleetTerminalPane } from '@/features/plugins/fleet/FleetTerminalPane';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { silentCatch } from '@/lib/silentCatch';

import { FLEET_INK, mix, MONO } from './ink';

const COPY = {
  demo: 'Demo session — no live terminal behind this node.',
  gone: 'Session is no longer running.',
  headless: 'Headless session — no terminal window. State and insights live in the Fleet grid.',
  placeholder: 'Reply to this session…',
  send: 'Send',
  close: 'Hide preview',
};

export function FleetPreviewPanel({ sessionId, session, onClose }: {
  sessionId: string;
  /** Live session row from the fleet store — null for demo/vanished sessions. */
  session: FleetSession | null;
  onClose: () => void;
}) {
  const [reply, setReply] = useState('');
  const live = session !== null && session.state !== 'exited' && session.mode !== 'headless';
  const ink = FLEET_INK[session?.state ?? 'exited'] ?? 'var(--status-neutral)';
  const label = session ? session.name ?? session.title ?? session.projectLabel : sessionId;

  const send = () => {
    const text = reply.trim();
    if (!text || !live) return;
    writeInput(sessionId, `${text}\r`).catch(silentCatch('mastermind fleet reply'));
    setReply('');
  };

  return (
    <div
      className="absolute bottom-16 right-3 z-20 w-[440px] rounded-card border border-primary/15 bg-secondary/95 shadow-elevation-3 overflow-hidden"
      data-testid="mm-fleet-preview"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ink, boxShadow: `0 0 6px ${mix(ink, 60)}` }} aria-hidden />
        <span className="typo-body font-medium text-foreground truncate">{label}</span>
        <span className="typo-caption text-foreground/55 shrink-0" style={{ fontFamily: MONO }}>
          {(session?.state ?? 'exited').replace('_', ' ')}
        </span>
        {session?.stateReason && <span className="typo-caption text-foreground/45 truncate">— {session.stateReason}</span>}
        <button
          type="button"
          onClick={onClose}
          aria-label={COPY.close}
          className="ml-auto shrink-0 p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-fleet-preview-close"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <div className="h-[260px] bg-background/80">
        {live ? (
          <FleetTerminalPane sessionId={sessionId} className="h-full" autoFocus={false} />
        ) : (
          <p className="typo-caption text-foreground/50 px-3 py-4">
            {session ? (session.mode === 'headless' ? COPY.headless : COPY.gone) : COPY.demo}
          </p>
        )}
      </div>

      {live && (
        <div className="flex items-center gap-1.5 px-2 py-2 border-t border-primary/10">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder={COPY.placeholder}
            className="flex-1 min-w-0 px-2.5 py-1.5 typo-caption rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40"
            data-testid="mm-fleet-reply-input"
          />
          <button
            type="button"
            onClick={send}
            disabled={reply.trim().length === 0}
            aria-label={COPY.send}
            className="shrink-0 p-1.5 rounded-interactive text-primary hover:bg-primary/10 disabled:opacity-40 transition-colors focus-ring"
            data-testid="mm-fleet-reply-send"
          >
            <Send className="w-4 h-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
