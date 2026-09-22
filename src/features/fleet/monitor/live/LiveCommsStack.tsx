// LIVE COMMS STACK — the SIGNAL ISLAND: incoming channel / Notepad messages as
// a Dynamic-Island capsule grown out of the title bar's top-center.
//
// Chosen via /prototype (2026-09-21) over the bottom-right messenger bubbles
// and a header-seated copy of them: the header is where the eye already rests,
// and a single capsule there costs the page nothing.
//
// THE CAPSULE carries the newest message: the author's accent washes in from
// the left, the avatar wears an accent ring, the note/context caption and the
// message follow on one line, then the "+N waiting" badge and the glyph +
// acknowledge cluster. Its accent hairline is the LIFELINE — it drains over the
// message's 10s lifetime. Older messages form a DECK: author-coloured slivers
// peeking out under the capsule, so "how many, and from whom" reads wordlessly.
// A feed's inline verbs (Notepad verdicts) ride in a tray under the capsule.
//
// Hover / keyboard focus OPENS the island into full cards (avatar, author,
// event chip, context or team, three lines, cluster) with the overflow and
// clear-all footer — and HOLDS it: the host pauses every lifetime while the
// operator reads, and resumes them on leave.
//
// Lifecycle: each message lives 10s from arrival (host-owned, see
// LiveChannelOverlay); overlapping lifetimes stack. Acknowledge marks it read
// for good; a body click opens Conversations (or the feed's own `open`).
//
// Layering: the title bar is `z-index: 9999` and a window drag region, so the
// island sits above it and carries `titlebar-nodrag` (a real right-click or
// drag inside a drag region goes to the window frame).

import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { liveSourceFor } from './liveExternal';
import { LIVE_LIFETIME_MS, authorAccent, type LiveVariantProps } from './liveModel';
import { IslandCapsule, IslandCard, makeOpen, mix } from './LiveIslandParts';

const MAX_VISIBLE = 3;

function SignalIsland({
  messages, onDismiss, onDismissAll, onOpenConversation, onOpenExternal, reducedMotion, deadlines, onHoldChange,
}: LiveVariantProps) {
  const { t, tx } = useTranslation();
  const [open, setOpen] = useState(false);
  const onOpen = makeOpen({ onOpenConversation, onOpenExternal });

  // Holding the island open pauses the host's clock; unmounting releases it.
  useEffect(() => { onHoldChange?.(open); }, [open, onHoldChange]);
  useEffect(() => () => onHoldChange?.(false), [onHoldChange]);

  const [head, ...rest] = messages;
  const deck = rest.slice(0, MAX_VISIBLE - 1);
  const overflow = messages.length - 1 - deck.length;
  const deadline = deadlines?.get(head!.id);
  const remainingMs = deadline === undefined ? LIVE_LIFETIME_MS : Math.max(0, deadline - Date.now());
  const headActions = liveSourceFor(head!)?.renderActions?.(head!);

  return (
    <div className="pointer-events-none fixed left-1/2 top-[5px] z-[10000] -translate-x-1/2" style={{ width: 'min(520px, 46vw)' }}>
      <div
        className="titlebar-nodrag pointer-events-auto relative"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
      >
        {/* Collapsed deck — author-coloured slivers under the capsule. */}
        {!open && deck.map((m, i) => (
          <motion.span
            key={m.id}
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute left-1/2 h-[38px] -translate-x-1/2 rounded-full border border-primary/10 bg-secondary/70 shadow-elevation-1"
            style={{ top: 5 * (i + 1), width: `${92 - i * 6}%`, zIndex: -1 - i, borderBottomColor: mix(authorAccent(m), 70) }}
          />
        ))}

        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={head!.id}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          >
            <IslandCapsule
              m={head!}
              waiting={messages.length - 1}
              remainingMs={remainingMs}
              lifetimeMs={LIVE_LIFETIME_MS}
              paused={open || reducedMotion}
              onDismiss={onDismiss}
              onOpen={onOpen}
            />
          </motion.div>
        </AnimatePresence>

        {/* The head's inline verbs (a Notepad verdict) — always in reach. */}
        {headActions && (
          <div className="mx-6 -mt-px rounded-b-card border border-t-0 border-primary/15 bg-background/95 px-3 py-2 shadow-elevation-2">
            {headActions}
          </div>
        )}

        {/* Opened island — the deck unfolds into full cards. The top padding
            bridges the gap so the pointer never leaves the hover target. */}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              className="absolute inset-x-0 top-full flex flex-col gap-2 pt-2"
            >
              <IslandCard m={head!} index={0} withActions={false} onDismiss={onDismiss} onOpen={onOpen} reducedMotion={reducedMotion} />
              {deck.map((m, i) => (
                <IslandCard key={m.id} m={m} index={i + 1} withActions onDismiss={onDismiss} onOpen={onOpen} reducedMotion={reducedMotion} />
              ))}
              {messages.length > 1 && (
                <div className="flex items-center justify-end gap-3 px-1">
                  {overflow > 0 && <span className="typo-caption text-foreground">{tx(t.monitor.live_more, { count: overflow })}</span>}
                  <button
                    type="button"
                    onClick={onDismissAll}
                    className="typo-caption rounded-full border border-primary/15 bg-background/90 px-2.5 py-1 text-primary transition-colors hover:text-primary/80"
                  >
                    {t.monitor.live_clear_all}
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function LiveCommsStackImpl(props: LiveVariantProps) {
  // Unmount the island when empty, so its open/hold state never outlives the
  // messages it was about (a removed element never fires mouseleave).
  if (props.messages.length === 0) return null;
  return <SignalIsland {...props} />;
}

/**
 * @catalog Title-bar "Signal Island" for live channel / Notepad messages: newest in a top-center capsule with a draining 10s lifeline, older ones as a colour deck; hover opens full cards and pauses the clock; acknowledge-to-mark-read, open-in-Conversations on body click.
 */
export const LiveCommsStack = memo(LiveCommsStackImpl);
export default LiveCommsStack;
