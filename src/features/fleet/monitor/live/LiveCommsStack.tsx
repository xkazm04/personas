// LIVE COMMS STACK — the corner pop-up layer for incoming team-channel messages.
//
// Presentation: a MESSENGER BUBBLE (chosen via /prototype over a flat toast and
// a Slack-transcript row). Each incoming channel message reads like an agent DM:
// the avatar sits OUTSIDE a rounded speech bubble (bottom-left, anchored by a
// small tail) and the message itself is the hero. The author line is the author
// and nothing else — the team/project tag was dropped (the persona name carries
// recognition; a per-project logo is the future affordance) and so was the
// relative time.
//
// THE CORNER CLUSTER carries everything that is ABOUT the message rather than
// part of it: the type glyph (directive / decision / channel, event text in its
// tooltip) and the acknowledge button, side by side at the top-right. The glyph
// used to sit beside the author name, where it interrupted the one line the eye
// reads first and — being inside the body button — made an INDICATOR part of
// the open target. Out here it indicates and nothing more, which is what it was
// always for. Alerts tint the bubble + tail warning. Newest sits nearest the
// corner; the latest 3 stay live and older ones fold into a "+N more · clear
// all" chip.
//
// Lifecycle (redesigned 2026-08-26): NO auto-timeout — cards showed and hid
// too quickly. A card stays until the operator ACKNOWLEDGES it via the check
// icon button (marks it read persistently; it is never displayed again) or
// clicks the body — which opens CONVERSATIONS, the room with a composer in it,
// rather than the merged Timeline it used to open.

import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, MessagesSquare, Scale, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import {
  LiveAvatar, authorAccent, authorName, liveMessageType, type LiveMessageType,
  type LiveMessage, type LiveVariantProps,
} from './liveModel';

const MAX_VISIBLE = 3;
// +20% over the original 352 (operator request) — the wider card gives the
// message line room now that it is the only prose in the bubble.
const STACK_WIDTH = 422;

/** The corner cluster's type glyph. Tone matches the event label vocabulary
 *  the card used to spell out; the event text itself rides in the tooltip so
 *  no information is lost. */
const TYPE_ICON: Record<LiveMessageType, { Icon: LucideIcon; cls: string }> = {
  decision: { Icon: Scale, cls: 'text-status-warning' },
  directive: { Icon: User, cls: 'text-emerald-400' },
  channel: { Icon: MessagesSquare, cls: 'text-foreground/60' },
};

function BubbleRow({
  m, onDismiss, onOpenConversation, reducedMotion,
}: {
  m: LiveMessage;
  onDismiss: (id: string) => void;
  onOpenConversation: (teamId?: string) => void;
  reducedMotion: boolean;
}) {
  const { t } = useTranslation();
  const accent = authorAccent(m);
  const type = liveMessageType(m);
  const TypeGlyph = TYPE_ICON[type];
  return (
    <motion.div
      layout={!reducedMotion}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="group pointer-events-auto flex w-full items-end gap-2"
    >
      {/* Avatar anchored to the bubble's bottom-left, like a chat thread. */}
      <LiveAvatar m={m} size="md" />

      <div className="relative min-w-0 flex-1">
        {/* Tail — a small rotated square fused to the bubble's lower-left. */}
        <span
          aria-hidden
          className={`absolute -left-1 bottom-2.5 h-2.5 w-2.5 rotate-45 rounded-[2px] border-b border-l ${
            m.alert ? 'border-status-warning/30 bg-status-warning/15' : 'border-primary/12 bg-secondary/40'
          }`}
        />
        <Tooltip content={t.monitor.live_open_conversation} placement="left">
          <button
            type="button"
            onClick={() => onOpenConversation(m.teamId)}
            className={`relative block w-full overflow-hidden rounded-2xl rounded-bl-md border px-3 py-2.5 text-left shadow-elevation-2 backdrop-blur-md transition-colors ${
              m.alert
                ? 'border-status-warning/35 bg-status-warning/[0.06] hover:bg-status-warning/[0.1]'
                : 'border-primary/12 bg-secondary/40 hover:bg-secondary/55'
            }`}
          >
            {/* The author line is the author. No team/project tag (the persona
                name carries recognition; a per-project logo is the future
                affordance), no relative time (discarded with the timeout), and
                since this pass no type glyph either — it is in the corner
                cluster below. `pr-14` reserves that corner so a long name
                truncates instead of sliding under the two icons. */}
            <div className="flex items-center pr-14">
              <span className="typo-caption font-semibold truncate" style={{ color: accent }}>{authorName(m)}</span>
            </div>
            {m.message && (
              <p className="mt-1 typo-body text-foreground line-clamp-3">{m.message}</p>
            )}
          </button>
        </Tooltip>

        {/* THE CORNER CLUSTER — what this message IS, and the one act on it.
            Outside the body button on purpose: nesting either inside it would
            put a control inside a control (invalid, and the browser drops one
            of them), and the glyph is an indicator that should not also be a
            fifth of the open target. */}
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
          <Tooltip content={m.event} placement="top">
            <span
              role="img"
              aria-label={m.event}
              className="flex h-5 w-5 items-center justify-center"
            >
              <TypeGlyph.Icon className={`h-3.5 w-3.5 flex-shrink-0 ${TypeGlyph.cls}`} aria-hidden />
            </span>
          </Tooltip>
          {/* Acknowledge — always visible (no auto-timeout anymore): marks the
              message read and it is never displayed again. */}
          <Tooltip content={t.monitor.live_dismiss} placement="top">
            <button
              type="button"
              onClick={() => onDismiss(m.id)}
              aria-label={t.monitor.live_dismiss}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-primary/15 bg-background/90 text-foreground transition-colors hover:text-status-success hover:border-status-success/40 focus-visible:text-status-success"
            >
              <Check className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>
      </div>
    </motion.div>
  );
}

function LiveCommsStackImpl({ messages, onDismiss, onDismissAll, onOpenConversation, reducedMotion }: LiveVariantProps) {
  const { t, tx } = useTranslation();
  if (messages.length === 0) return null;
  const visible = messages.slice(0, MAX_VISIBLE);
  const overflow = messages.length - visible.length;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2" style={{ width: STACK_WIDTH }}>
      {/* Overflow + clear-all chip sits above the newest message. */}
      <AnimatePresence initial={false}>
        {overflow > 0 && (
          <motion.div
            key="overflow"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto flex items-center gap-2 self-end rounded-full border border-primary/12 bg-secondary/80 px-2.5 py-1 backdrop-blur-sm"
          >
            <span className="typo-caption text-foreground">{tx(t.monitor.live_more, { count: overflow })}</span>
            <button
              type="button"
              onClick={onDismissAll}
              className="typo-caption font-medium text-primary transition-colors hover:text-primary/80"
            >
              {t.monitor.live_clear_all}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Newest at the BOTTOM (nearest the corner), like a chat thread. */}
      <div className="flex w-full flex-col-reverse gap-2">
        <AnimatePresence initial={false}>
          {visible.map((m) => (
            <BubbleRow
              key={m.id}
              m={m}
              onDismiss={onDismiss}
              onOpenConversation={onOpenConversation}
              reducedMotion={reducedMotion}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * @catalog Bottom-right chat-bubble stack of live channel-message pop-ups (latest 3 + overflow chip): acknowledge-to-mark-read (persistent, no auto-timeout), corner type glyph, open-in-Conversations on body click.
 */
export const LiveCommsStack = memo(LiveCommsStackImpl);
export default LiveCommsStack;
