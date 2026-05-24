import { useState } from 'react';
import { Hourglass, MessageSquare, Send, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useNowTick, formatAgo } from './relativeAgo';

/**
 * Attention banner — the desktop precursor to the "something needs a human"
 * push alert in the mobile companion. Renders only when one or more sessions
 * are `awaiting_input`, listing each as a chip the operator can either jump
 * to (focus its terminal) or reply to inline — typing an answer that's
 * written straight to the session's PTY without leaving the grid. That inline
 * reply is the core remote-approve gesture the phone companion will mirror.
 *
 * Presentation only: the awaiting subset, jump handler, and reply handler are
 * supplied by the grid page, which owns the store read and IPC writes.
 */
interface FleetNeedsYouBannerProps {
  /** Sessions currently in the `awaiting_input` state. */
  waiting: FleetSession[];
  /** Focus a session by id (mounts its terminal pane). */
  onJump: (id: string) => void;
  /** Write a line to a session's stdin (unblocks it without opening the terminal). */
  onReply: (id: string, text: string) => Promise<void>;
}

export function FleetNeedsYouBanner({ waiting, onJump, onReply }: FleetNeedsYouBannerProps) {
  const { t, tx } = useTranslation();
  const now = useNowTick();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  if (waiting.length === 0) return null;

  const replyTarget = replyTo ? waiting.find((s) => s.id === replyTo) : null;
  // If the targeted session left the awaiting set, drop the open reply row.
  if (replyTo && !replyTarget) {
    setReplyTo(null);
    setText('');
  }

  const submit = async () => {
    if (!replyTo || !text.trim() || sending) return;
    setSending(true);
    try {
      await onReply(replyTo, text);
      setText('');
      setReplyTo(null);
    } finally {
      setSending(false);
    }
  };

  const label =
    waiting.length === 1
      ? tx(t.plugins.fleet.needs_input_one, { count: waiting.length })
      : tx(t.plugins.fleet.needs_input_other, { count: waiting.length });

  return (
    <div
      role="region"
      aria-label={t.plugins.fleet.needs_you_aria}
      data-testid="fleet-needs-you"
      className="mb-3 rounded-card border border-violet-400/30 bg-violet-400/10 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute inset-0 rounded-full bg-violet-400 opacity-60 animate-ping" />
          <span className="relative h-2 w-2 rounded-full bg-violet-400" />
        </span>
        <Hourglass className="w-3.5 h-3.5 text-violet-300 shrink-0" aria-hidden="true" />
        <span className="typo-caption font-semibold text-violet-200 mr-1">{label}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {waiting.map((s) => {
            const name = s.name ?? s.projectLabel;
            return (
              <span
                key={s.id}
                className="flex items-center overflow-hidden rounded-interactive border border-violet-400/30 bg-violet-400/10 text-[11px] text-violet-100"
              >
                <button
                  type="button"
                  data-testid={`fleet-needs-you-chip-${s.id}`}
                  onClick={() => onJump(s.id)}
                  title={t.plugins.fleet.jump_to_session}
                  className="px-2 py-0.5 transition-colors hover:bg-violet-400/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400/60"
                >
                  {name}
                  <span className="ml-1 text-violet-300/80">· {formatAgo(t, Number(s.lastActivityMs), now)}</span>
                </button>
                <button
                  type="button"
                  data-testid={`fleet-needs-you-reply-${s.id}`}
                  onClick={() => { setReplyTo(s.id); setText(''); }}
                  aria-label={tx(t.plugins.fleet.reply_to, { name })}
                  title={tx(t.plugins.fleet.reply_to, { name })}
                  className="border-l border-violet-400/30 px-1.5 py-0.5 transition-colors hover:bg-violet-400/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400/60"
                >
                  <MessageSquare className="w-3 h-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {replyTarget && (
        <form
          data-testid="fleet-reply-row"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          className="mt-2 flex items-center gap-2"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setReplyTo(null); setText(''); } }}
            placeholder={tx(t.plugins.fleet.reply_placeholder, { name: replyTarget.name ?? replyTarget.projectLabel })}
            autoFocus
            className="min-w-0 flex-1 rounded-input border border-violet-400/30 bg-secondary/40 px-2 py-1 text-[12px] text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400/60"
          />
          <button
            type="submit"
            data-testid="fleet-reply-send"
            disabled={!text.trim() || sending}
            className="flex items-center gap-1 rounded-interactive bg-violet-500/80 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-violet-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400/60"
          >
            <Send className="w-3 h-3" aria-hidden="true" />
            {sending ? t.plugins.fleet.reply_sending : t.plugins.fleet.reply_send}
          </button>
          <button
            type="button"
            onClick={() => { setReplyTo(null); setText(''); }}
            aria-label={t.plugins.fleet.reply_cancel}
            title={t.plugins.fleet.reply_cancel}
            className="rounded-interactive p-1 text-foreground transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </form>
      )}
    </div>
  );
}
