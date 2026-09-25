// The terminal modal's honest states - what it shows INSTEAD of a black pane,
// and the one-line answer it offers beside a live one.
//
// Measured 2026-09-25 on the live registry: every `awaiting_input` interactive
// session on the board had `childPid: null`, `lastPtyOutputMs: 0` and
// `dozing: true`, with the reason "Recovered after an app restart - its live
// connection was lost". There is no process and no output ring behind such a
// row, so mounting a terminal for it painted an empty box the operator could
// not tell from a session that had simply not printed yet. The Fleet page has
// always woken a dozing row the moment it is selected (`useFleetOverlayActions`
// "wake on return"); the Monitor never did. `SleepingSessionPanel` is that
// gesture here - explicit rather than automatic, because a wake spawns
// `claude --resume` and consumes a slot - with the session's own last words
// above it, so the operator knows what they are waking it up to answer.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MoonStar, RefreshCw, Send } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { sessionRecap } from '@/api/fleet/fleet';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionRecap } from '@/lib/bindings/FleetSessionRecap';
import { replyToSession } from '@/features/plugins/fleet/replyToSession';
import { redrawTerminal } from '@/features/plugins/fleet/fleetTerminalManager';
import { RecapField } from './RecapField';

/** A row with no process on this side: asleep (dozing / hibernated). */
export function isSleeping(s: FleetSession): boolean {
  return s.dozing || s.state === 'hibernated';
}

/** The session's last words, read from its transcript - the cheap read. */
function useLastWords(claudeSessionId: string | null) {
  const [recap, setRecap] = useState<FleetSessionRecap | null>(null);
  useEffect(() => {
    if (!claudeSessionId) return;
    let live = true;
    sessionRecap(claudeSessionId)
      .then((r) => { if (live) setRecap(r); })
      .catch(silentCatch('fleet-terminal:recap'));
    return () => { live = false; };
  }, [claudeSessionId]);
  return recap?.awaySummary ?? recap?.lastAssistantText ?? null;
}

export function SleepingSessionPanel({
  session, onWake,
}: {
  session: FleetSession;
  /** Resume the conversation; resolves once the woken row is in the store. */
  onWake: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const lastWords = useLastWords(session.claudeSessionId);
  const canWake = !!session.claudeSessionId;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center" data-testid="fleet-terminal-sleeping">
      <MoonStar className="h-6 w-6 text-primary" aria-hidden />
      <p className="max-w-xl typo-body-lg text-foreground">{session.stateReason ?? f.doze_tooltip}</p>
      <p className="typo-caption text-foreground">
        {t.monitor.grid_session_recap_last_activity} <RelativeTime timestamp={Number(session.lastActivityMs)} />
      </p>
      {lastWords && (
        <div className="max-h-[40%] w-full max-w-2xl overflow-y-auto rounded-card border border-border bg-secondary/20 p-3 text-left">
          <RecapField label={t.monitor.grid_session_recap_last_said} value={lastWords} emphasis />
        </div>
      )}
      <AsyncButton
        variant="primary"
        size="md"
        onClick={onWake}
        disabled={!canWake}
        autoFocus
        data-testid="fleet-terminal-wake"
      >
        {f.wake_session}
      </AsyncButton>
    </div>
  );
}

/** A terminal-less row that is not asleep: headless, queued or exited. */
export function NoTerminalPanel({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center" data-testid="fleet-terminal-none">
      <p className="max-w-xl typo-body text-foreground">{text}</p>
    </div>
  );
}

/**
 * One line into the session's prompt, under the live terminal - for a session
 * that is waiting on the operator. Enter sends (with the submitting carriage
 * return, `replyToSession`), and the terminal keeps its own keyboard for
 * anything a line cannot say (arrow-key menus). Redraw asks the TUI for a full
 * frame when the pane is still blank.
 */
export function SessionReplyBar({ session }: { session: FleetSession }) {
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const name = session.name ?? session.projectLabel;
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const line = text.trim();
    if (!line) return;
    if (await replyToSession(session.id, line)) setText('');
    inputRef.current?.focus();
  };
  return (
    <form onSubmit={send} className="flex flex-shrink-0 items-center gap-2 border-t border-border px-3 py-2" data-testid="fleet-terminal-reply">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={tx(f.reply_placeholder, { name })}
        aria-label={tx(f.reply_to, { name })}
        className={`${INPUT_FIELD} min-w-0 flex-1`}
        data-testid="fleet-terminal-reply-input"
      />
      <AsyncButton type="button" variant="primary" size="sm" onClick={() => send()} disabled={!text.trim()} icon={<Send className="h-3.5 w-3.5" />}>
        {f.reply_send}
      </AsyncButton>
      <Tooltip content={t.common.refresh}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => redrawTerminal(session.id)}
          aria-label={t.common.refresh}
          data-testid="fleet-terminal-redraw"
          icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        />
      </Tooltip>
    </form>
  );
}
