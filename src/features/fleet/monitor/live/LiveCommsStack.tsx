// LIVE COMMS STACK — the corner pop-up layer for incoming team-channel messages.
//
// Presentation: a MESSENGER BUBBLE (chosen via /prototype over a flat toast and
// a Slack-transcript row). Each incoming channel message reads like an agent DM:
// the avatar sits OUTSIDE a rounded speech bubble (bottom-left, anchored by a
// small tail) and the message itself is the hero, with the author (in their
// accent), a "# channel" pill, and a relative time in the header, and the event
// ("needs your review", "handoff") as a small status label. Alerts tint the
// bubble + tail warning. Newest sits nearest the corner; the latest 3 stay live
// and older ones fold into a "+N more · clear all" chip. Hover pauses the
// natural timeout and reveals the dismiss control; the body opens the Timeline.

import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import {
  LiveAvatar, authorAccent, authorName, LIVE_TTL_MS,
  type LiveMessage, type LiveVariantProps,
} from './liveModel';

const MAX_VISIBLE = 3;
const STACK_WIDTH = 352;

function BubbleRow({
  m, onDismiss, onOpenTimeline, onHover, reducedMotion,
}: {
  m: LiveMessage;
  onDismiss: (id: string) => void;
  onOpenTimeline: (teamId?: string) => void;
  onHover: (id: string, hovered: boolean) => void;
  reducedMotion: boolean;
}) {
  const { t } = useTranslation();
  const accent = authorAccent(m);
  return (
    <motion.div
      layout={!reducedMotion}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      onMouseEnter={() => onHover(m.id, true)}
      onMouseLeave={() => onHover(m.id, false)}
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
        <button
          type="button"
          onClick={() => onOpenTimeline(m.teamId)}
          title={t.monitor.live_open_timeline}
          className={`relative block w-full overflow-hidden rounded-2xl rounded-bl-md border px-3 py-2.5 text-left shadow-elevation-2 backdrop-blur-md transition-colors ${
            m.alert
              ? 'border-status-warning/35 bg-status-warning/[0.06] hover:bg-status-warning/[0.1]'
              : 'border-primary/12 bg-secondary/40 hover:bg-secondary/55'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="typo-caption font-semibold truncate" style={{ color: accent }}>{authorName(m)}</span>
            {/* Channel pill — anchors the message to its team channel. */}
            <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 typo-caption text-foreground/70">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: m.teamColor }} />
              <span className="max-w-[120px] truncate">{m.teamName}</span>
            </span>
            <span className="ml-auto flex-shrink-0 typo-caption text-foreground/55">
              <RelativeTime timestamp={m.at} />
            </span>
          </div>
          <span className={`mt-1 inline-block typo-label ${m.tone}`}>{m.event}</span>
          {m.message && (
            <p className="mt-1 typo-body text-foreground line-clamp-3">{m.message}</p>
          )}

          {/* Finite auto-dismiss rail (paused on hover by the host). */}
          {!reducedMotion && (
            <motion.span
              className="absolute inset-x-0 bottom-0 block h-0.5 origin-left"
              style={{ backgroundColor: accent, opacity: 0.5 }}
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: LIVE_TTL_MS / 1000, ease: 'linear' }}
            />
          )}
        </button>

        {/* Dismiss — revealed on hover; skips the natural timeout. */}
        <button
          type="button"
          onClick={() => onDismiss(m.id)}
          aria-label={t.monitor.live_dismiss}
          title={t.monitor.live_dismiss}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-primary/15 bg-background/90 text-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </motion.div>
  );
}

function LiveCommsStackImpl({ messages, onDismiss, onDismissAll, onOpenTimeline, onHover, reducedMotion }: LiveVariantProps) {
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
              onOpenTimeline={onOpenTimeline}
              onHover={onHover}
              reducedMotion={reducedMotion}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * @catalog Bottom-right chat-bubble stack of live channel-message pop-ups (latest 3 + overflow chip) with click-to-dismiss, hover-paused auto-timeout, and open-in-Timeline.
 */
export const LiveCommsStack = memo(LiveCommsStackImpl);
export default LiveCommsStack;
