// R19 — Fleet as the wall's LLM engine for the unified setup rows
// (Evals / Security / Tests / Migrations).
//
// One dispatch = one live terminal, keyed `passport:<row>:<slug>` in the
// session name (same identity/dedup pattern as the cockpit bench). The wall
// polls the fleet registry and swaps each row's setup gear for a terminal
// icon tinted by the session state; clicking it opens the terminal modal —
// the same mechanism Mastermind's FleetPreviewPanel ships (an embedded
// managed FleetTerminalPane + a quick-reply row), lifted into a BaseModal.
import { useEffect, useMemo, useState } from 'react';
import { Send, X } from 'lucide-react';

import { listSessions, renameSession, spawnSession, writeInput } from '@/api/fleet/fleet';
import { useShallow } from 'zustand/react/shallow';

import { useSystemStore } from '@/stores/systemStore';
import { BaseModal } from '@/features/shared/components/modals';
import { FleetTerminalPane } from '@/features/plugins/fleet/FleetTerminalPane';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { silentCatch } from '@/lib/silentCatch';

import { INK } from './passportInk';

export function passportDispatchKey(rowKey: string, slug: string): string {
  return `passport:${rowKey}:${slug}`;
}

/** Session state → wall ink (mirrors the cockpit bench vocabulary). */
export const PASSPORT_FLEET_INK: Record<string, string> = {
  spawning: INK.violet,
  running: INK.violet,
  awaiting_input: INK.amber,
  idle: INK.teal,
  stale: 'rgba(148,163,184,.6)',
  hibernated: 'rgba(148,163,184,.45)',
};

/** Live fleet sessions per wall dispatch key — event-driven via the store's
 *  global FLEET_SESSION_* listeners (the same spine the Mastermind canvas
 *  uses): sub-second updates, zero polling. Replaces the old 5s listSessions
 *  interval. Exited sessions free their key — the row's gear returns. */
export function usePassportFleetSessions(): Map<string, FleetSession> {
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const fleetRefresh = useSystemStore((s) => s.fleetRefresh);
  const fleetStartSessionListeners = useSystemStore((s) => s.fleetStartSessionListeners);
  useEffect(() => {
    fleetStartSessionListeners();
    void fleetRefresh();
  }, [fleetRefresh, fleetStartSessionListeners]);
  return useMemo(() => {
    const m = new Map<string, FleetSession>();
    for (const s of sessions) {
      if (s.name && s.name.startsWith('passport:') && s.state !== 'exited') m.set(s.name, s);
    }
    return m;
  }, [sessions]);
}

/** Spawn the Fleet terminal in the PROJECT'S REPO ROOT, seeded with the
 *  direction prompt, and stamp the dispatch key as its name. Refuses to
 *  double-spawn while a non-exited session holds the key. */
export async function dispatchRowToFleet(key: string, cwd: string, prompt: string): Promise<string> {
  const snap = await listSessions();
  const running = snap.sessions.find((s) => s.name === key && s.state !== 'exited');
  if (running) throw new Error('A terminal is already working this row — open it from the cell icon, or kill it in Fleet first.');
  const sessionId = await spawnSession(cwd, [prompt]);
  await renameSession(sessionId, key);
  return sessionId;
}

const COPY = {
  gone: 'Session is no longer running.',
  headless: 'Headless session — no terminal window. State and insights live in the Fleet grid.',
  placeholder: 'Reply to this session…',
  send: 'Send',
};

/** The terminal modal — Mastermind's FleetPreviewPanel composition (managed
 *  FleetTerminalPane + reply row) hosted in a BaseModal so any wall cell can
 *  summon the specific terminal to check or react. */
export function PassportTerminalModal({ sessionId, session, onClose }: {
  sessionId: string;
  session: FleetSession | null;
  onClose: () => void;
}) {
  const [reply, setReply] = useState('');
  const live = session !== null && session.state !== 'exited' && session.mode !== 'headless';
  const ink = PASSPORT_FLEET_INK[String(session?.state ?? '')] ?? 'rgba(148,163,184,.5)';
  const label = session ? session.name ?? session.title ?? session.projectLabel : sessionId;

  const send = () => {
    const text = reply.trim();
    if (!text || !live) return;
    writeInput(sessionId, `${text}\r`).catch(silentCatch('passport fleet reply'));
    setReply('');
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="passport-terminal-title" portal maxWidthClass="max-w-3xl" staggerChildren={false}>
      <div data-testid="passport-terminal-modal">
        <div className="flex items-center gap-2 pb-2 border-b border-primary/10">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ink, boxShadow: `0 0 6px ${ink}88` }} aria-hidden />
          <h2 id="passport-terminal-title" className="typo-body font-medium text-foreground truncate">{label}</h2>
          <span className="typo-caption text-foreground/55 shrink-0">{String(session?.state ?? 'exited').replace('_', ' ')}</span>
          {session?.stateReason && <span className="typo-caption text-foreground/45 truncate">— {session.stateReason}</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto shrink-0 p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        <div className="h-[420px] bg-background/80 mt-2 rounded-card overflow-hidden">
          {live ? (
            <FleetTerminalPane sessionId={sessionId} className="h-full" autoFocus />
          ) : (
            <p className="typo-caption text-foreground/50 px-3 py-4">
              {session ? (session.mode === 'headless' ? COPY.headless : COPY.gone) : COPY.gone}
            </p>
          )}
        </div>

        {live && (
          <div className="flex items-center gap-1.5 pt-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              placeholder={COPY.placeholder}
              className="flex-1 min-w-0 px-2.5 py-1.5 typo-caption rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40"
              data-testid="passport-terminal-reply"
            />
            <button
              type="button"
              onClick={send}
              disabled={reply.trim().length === 0}
              aria-label={COPY.send}
              className="shrink-0 p-1.5 rounded-interactive text-primary hover:bg-primary/10 disabled:opacity-40 transition-colors focus-ring"
            >
              <Send className="w-4 h-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </BaseModal>
  );
}
