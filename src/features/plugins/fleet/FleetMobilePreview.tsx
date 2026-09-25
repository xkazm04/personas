import { useMemo, useState } from 'react';
import { Hourglass, Smartphone, Send } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { FLEET_STATE_META, fleetStateCounts } from './fleetStateMeta';
import { useNowTick, formatAgo } from './relativeAgo';
import { replyToSession } from './replyToSession';

/**
 * Mobile companion preview — a render of the fleet glance view inside a phone
 * frame, fed by the operator's *live* session data. This lets the remote glance
 * surface be designed and validated locally, long before the paired mobile
 * client exists.
 *
 * It carries EXACTLY ONE verb: replying to a session that is blocked on a
 * human. `FleetPairDevice` already promises a paired phone allowlisted
 * verdicts, and `FleetNeedsYouBanner` calls its inline reply "the core
 * remote-approve gesture the phone companion will mirror" — so a frame that
 * could not perform that gesture was the one thing this preview existed to
 * validate and could not. Both surfaces now go through `replyToSession`, so
 * they cannot drift into sending it differently.
 *
 * It is still not a second control plane: no kill, no spawn, no broadcast. A
 * verb the phone will not have does not belong in the rehearsal of it.
 *
 * The per-state chips read `FLEET_STATE_META` — the ONE palette + order every
 * fleet glance surface shares. This file used to keep a private six-entry copy
 * of that list, and the copy had drifted: `finished` and `hibernated` were
 * missing, so a fleet holding either counted them in the "N sessions" header
 * and then rendered no chip for them. The header and the chips disagreed, and
 * the two states it silently dropped are exactly the pair the rest of Fleet
 * treats as terminal — the same drift that once let the broadcast composer
 * target hibernated sessions.
 */

export function FleetMobilePreview() {
  const { t, tx } = useTranslation();
  const now = useNowTick();
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));

  // The id is what makes a chip addressable; this list used to carry only a
  // display name, which is why nothing here could reach a session.
  const { counts, total, waitingItems } = useMemo(() => {
    const waiting: { id: string; name: string; lastActivityMs: number }[] = [];
    for (const s of sessions) {
      if (s.state === 'awaiting_input') {
        waiting.push({ id: s.id, name: s.name ?? s.projectLabel, lastActivityMs: Number(s.lastActivityMs) });
      }
    }
    return { counts: fleetStateCounts(sessions), total: sessions.length, waitingItems: waiting };
  }, [sessions]);

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  // A session that stopped waiting while its composer was open is no longer a
  // valid target — sending then would answer a prompt that is gone.
  const replyTarget = replyTo ? waitingItems.find((w) => w.id === replyTo) : null;
  if (replyTo && !replyTarget) {
    setReplyTo(null);
    setReplyText('');
  }

  const submitReply = async () => {
    if (!replyTarget || !replyText.trim() || sending) return;
    setSending(true);
    try {
      const ok = await replyToSession(replyTarget.id, replyText);
      // Clear only on success. A failed send that emptied the field would cost
      // the operator the answer they just typed, on top of the failure.
      if (ok) {
        setReplyText('');
        setReplyTo(null);
      }
    } finally {
      setSending(false);
    }
  };

  const sessionCount =
    total === 1
      ? tx(t.plugins.fleet.sessions_one, { count: total })
      : tx(t.plugins.fleet.sessions_other, { count: total });

  return (
    <div
      className="border border-primary/10 rounded-modal px-4 py-4 bg-secondary/20"
      data-testid="fleet-mobile-preview"
    >
      <div className="flex items-center gap-2 mb-1">
        <Smartphone className="w-4 h-4 text-primary" aria-hidden="true" />
        <p className="typo-caption text-foreground">{t.plugins.fleet.preview_title}</p>
      </div>
      <p className="text-[14px] text-foreground leading-relaxed mb-3">{t.plugins.fleet.preview_desc}</p>

      <div className="flex justify-center">
        {/* Phone frame */}
        <div className="relative w-[260px] rounded-[2.25rem] border-4 border-primary/20 bg-[#0a0a0c] p-2 shadow-elevation-2">
          <div className="absolute left-1/2 top-2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-primary/25" aria-hidden="true" />
          {/* Screen. NOT aria-hidden: the phone FRAME is decorative, but what
              is on the screen is the operator's real, live fleet — session
              totals, per-state counts, and which sessions are waiting on them.
              Hiding the whole subtree left a screen-reader user with the
              heading, the description, and then silence. Only the frame
              chrome (notch above) carries aria-hidden. */}
          <div
            className="mt-5 rounded-[1.6rem] bg-background/90 px-4 py-4 min-h-[300px]"
            data-testid="fleet-mobile-preview-screen"
          >
            <p className="typo-label text-foreground mb-0.5">Personas</p>
            <p className="text-[17px] font-semibold text-foreground">Fleet</p>
            <p className="text-[13px] text-foreground mb-3">{sessionCount}</p>

            {total === 0 ? (
              <p className="text-[14px] text-foreground py-8 text-center">{t.plugins.fleet.preview_no_sessions}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {FLEET_STATE_META.filter((m) => counts[m.id] > 0).map((m) => (
                    <span
                      key={m.id}
                      className="flex items-center gap-1.5 rounded-interactive border border-primary/10 bg-secondary/40 px-2 py-0.5 text-[13px] text-foreground"
                    >
                      <span className={`h-2 w-2 rounded-full ${m.dot}`} aria-hidden="true" />
                      <span>{t.plugins.fleet[m.labelKey]}</span>
                      <span className="font-semibold tabular-nums">{counts[m.id]}</span>
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 mb-1.5">
                  <Hourglass className="w-3 h-3 text-violet-400" aria-hidden="true" />
                  <span className="typo-label text-foreground">
                    {waitingItems.length === 1
                      ? tx(t.plugins.fleet.needs_input_one, { count: waitingItems.length })
                      : tx(t.plugins.fleet.needs_input_other, { count: waitingItems.length })}
                  </span>
                </div>
                {waitingItems.length === 0 ? (
                  <p className="text-[14px] text-emerald-300">{t.plugins.fleet.preview_all_clear}</p>
                ) : (
                  <ul className="space-y-1">
                    {waitingItems.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-interactive border border-violet-400/25 bg-violet-400/10 px-2 py-1 text-[14px] text-violet-100"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            data-testid={`fleet-preview-reply-${item.id}`}
                            onClick={() => { setReplyTo(item.id); setReplyText(''); }}
                            aria-label={tx(t.plugins.fleet.reply_to, { name: item.name })}
                            className="truncate text-left transition-colors hover:text-violet-50"
                          >
                            {item.name}
                          </button>
                          <span className="shrink-0 text-violet-300/80">{formatAgo(t, item.lastActivityMs, now)}</span>
                        </div>
                        {replyTo === item.id && (
                          <div className="mt-1 flex items-center gap-1">
                            <input
                              type="text"
                              autoFocus
                              data-testid="fleet-preview-reply-input"
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); void submitReply(); }
                                if (e.key === 'Escape') { setReplyTo(null); setReplyText(''); }
                              }}
                              placeholder={tx(t.plugins.fleet.reply_placeholder, { name: item.name })}
                              className="min-w-0 flex-1 rounded-interactive border border-violet-400/30 bg-background/60 px-1.5 py-0.5 text-[13px] text-violet-50 placeholder:text-violet-300/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400/60"
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              data-testid="fleet-preview-reply-send"
                              disabled={!replyText.trim() || sending}
                              onClick={() => void submitReply()}
                              aria-label={sending ? t.plugins.fleet.reply_sending : t.plugins.fleet.reply_send}
                              className="shrink-0 border border-violet-400/30 bg-violet-400/15 text-violet-100 hover:bg-violet-400/25"
                            >
                              <Send className="w-3 h-3" aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
