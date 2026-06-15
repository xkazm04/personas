// Variant A — COMMS STACK.
//
// Metaphor: a messaging app's notification stack. Each incoming channel message
// is a chat bubble that slides up + fades in at the bottom-right and stacks
// upward, newest nearest the eye. The latest 3 stay live; older ones collapse
// into a "+N more" chip. A team-colour rail anchors every bubble to its source
// team. Hover pauses the natural timeout and reveals the dismiss control; the
// body redirects into the Timeline. This is the most familiar / chat-like read.

import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import {
  LiveAvatar, authorAccent, authorName, COPY, LIVE_TTL_MS,
  type LiveMessage, type LiveVariantProps,
} from './liveModel';

const MAX_VISIBLE = 3;

function Bubble({
  m, onDismiss, onOpenTimeline, onHover, reducedMotion,
}: {
  m: LiveMessage;
  onDismiss: (id: string) => void;
  onOpenTimeline: (teamId?: string) => void;
  onHover: (id: string, hovered: boolean) => void;
  reducedMotion: boolean;
}) {
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
      className="group pointer-events-auto relative w-[324px] overflow-hidden rounded-card border border-primary/15 bg-background/95 shadow-elevation-3 backdrop-blur-md"
      style={{ boxShadow: `inset 3px 0 0 ${m.alert ? 'var(--color-status-warning)' : m.teamColor}` }}
    >
      <button
        type="button"
        onClick={() => onOpenTimeline(m.teamId)}
        title={COPY.openTimeline}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        <LiveAvatar m={m} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="typo-body font-semibold truncate" style={{ color: accent }}>
              {authorName(m)}
            </span>
            <span className={`typo-caption uppercase tracking-wider flex-shrink-0 ${m.tone}`}>{m.event}</span>
            <span className="ml-auto flex-shrink-0 typo-caption text-foreground/45">
              <RelativeTime timestamp={m.at} />
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: m.teamColor }} />
            <span className="typo-caption text-foreground/50 truncate">{m.teamName}</span>
          </div>
          {m.message && (
            <p className="mt-1 typo-body text-foreground/85 line-clamp-2">{m.message}</p>
          )}
        </div>
      </button>

      {/* Dismiss — revealed on hover; skips the natural timeout. */}
      <button
        type="button"
        onClick={() => onDismiss(m.id)}
        aria-label={COPY.dismiss}
        title={COPY.dismiss}
        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-primary/15 bg-background/80 text-foreground/55 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>

      {/* Finite auto-dismiss progress rail (paused on hover via CSS data attr). */}
      {!reducedMotion && (
        <div className="h-0.5 bg-foreground/[0.06]">
          <motion.div
            className="h-full"
            style={{ backgroundColor: accent, opacity: 0.5 }}
            initial={{ width: '100%' }}
            animate={{ width: '0%' }}
            transition={{ duration: LIVE_TTL_MS / 1000, ease: 'linear' }}
          />
        </div>
      )}
    </motion.div>
  );
}

function LiveCommsStackImpl({ messages, onDismiss, onDismissAll, onOpenTimeline, onHover, reducedMotion }: LiveVariantProps) {
  if (messages.length === 0) return null;
  const visible = messages.slice(0, MAX_VISIBLE);
  const overflow = messages.length - visible.length;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-[324px] flex-col items-end gap-2">
      {/* Overflow + clear-all chip sits above the newest bubble. */}
      <AnimatePresence initial={false}>
        {overflow > 0 && (
          <motion.div
            key="overflow"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto flex items-center gap-2 self-end rounded-full border border-primary/12 bg-secondary/80 px-2.5 py-1 backdrop-blur-sm"
          >
            <span className="typo-caption text-foreground/70">{COPY.more(overflow)}</span>
            <button
              type="button"
              onClick={onDismissAll}
              className="typo-caption font-medium text-foreground/55 transition-colors hover:text-foreground"
            >
              {COPY.dismissAll}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Newest at the BOTTOM (nearest the corner), like a chat thread. */}
      <div className="flex w-full flex-col-reverse gap-2">
        <AnimatePresence initial={false}>
          {visible.map((m) => (
            <Bubble
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

export const LiveCommsStack = memo(LiveCommsStackImpl);
export default LiveCommsStack;
