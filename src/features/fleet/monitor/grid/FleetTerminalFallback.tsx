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
import { MoonStar, RefreshCw, Send, TerminalSquare } from 'lucide-react';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { ModalSection } from '@/features/shared/components/modals/ModalShell';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { sessionRecap } from '@/api/fleet/fleet';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionRecap } from '@/lib/bindings/FleetSessionRecap';
import { replyToSession } from '@/features/plugins/fleet/replyToSession';
import { redrawTerminal } from '@/features/plugins/fleet/fleetTerminalManager';

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

/**
 * A sleeping row's body: why it is asleep and what it last said, each on its own
 * inset panel (`ModalSection`), so nothing floats over the modal's backdrop. The
 * Wake button lives in the modal's footer; when a wake fails, the refusal is
 * shown HERE rather than as a toast - the terminal modal sits on the portal tier
 * (z 10000) and a toast renders underneath it, which is why a failed wake used to
 * look like a button that ignored the click.
 */
export function SleepingSessionPanel({
  session, wakeError,
}: {
  session: FleetSession;
  /** The raw refusal of the last wake attempt, or null. */
  wakeError: unknown;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const lastWords = useLastWords(session.claudeSessionId);
  return (
    <div className="flex flex-col gap-4" data-testid="fleet-terminal-sleeping">
      {wakeError !== null && (
        <div data-testid="fleet-terminal-wake-error">
          <InlineErrorBanner
            title={m.terminal_wake_failed}
            message={`${resolveErrorTranslated(t, extractMessage(wakeError)).message} ${m.terminal_wake_failed_hint}`}
          />
        </div>
      )}
      <ModalSection label={m.terminal_asleep_label}>
        <div className="flex items-start gap-3">
          <MoonStar className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="typo-body-lg text-foreground">{session.stateReason ?? t.plugins.fleet.doze_tooltip}</p>
            <p className="mt-1 typo-caption">
              {m.grid_session_recap_last_activity} <RelativeTime timestamp={Number(session.lastActivityMs)} />
            </p>
          </div>
        </div>
      </ModalSection>
      {lastWords && (
        <ModalSection label={m.grid_session_recap_last_said}>
          <p className="max-h-[32vh] overflow-y-auto whitespace-pre-wrap typo-body text-foreground">{lastWords}</p>
        </ModalSection>
      )}
    </div>
  );
}

/** A terminal-less row that is not asleep: headless, queued or exited. */
export function NoTerminalPanel({ text }: { text: string }) {
  return (
    <ModalSection>
      <div className="flex items-center gap-3" data-testid="fleet-terminal-none">
        <TerminalSquare className="h-5 w-5 flex-shrink-0 text-primary" aria-hidden />
        <p className="typo-body-lg text-foreground">{text}</p>
      </div>
    </ModalSection>
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
    <form onSubmit={send} className="flex w-full items-center gap-2" data-testid="fleet-terminal-reply">
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
