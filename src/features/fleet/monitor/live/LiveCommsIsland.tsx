// LIVE COMMS · SIGNAL ISLAND — prototype variant B (wildcard, boosted UI).
//
// Metaphor: a DYNAMIC ISLAND grown out of the title bar. The newest message is
// a single dark capsule that sits in the header's top-center: the author's
// accent washes in from the left, the avatar wears an accent ring, the event
// is a typed chip, and an accent hairline underlines the capsule (the seat of
// the future 10s lifeline). Everything older does not compete for the header —
// it forms a DECK: slivers peeking out from under the capsule, one per waiting
// message, in each author's colour, so "how many and from whom" reads without
// a single word.
//
// Hover (or keyboard focus) OPENS the island: the deck unfolds beneath the
// capsule into full cards — avatar, author, event chip, team, three lines of
// message, the glyph + acknowledge cluster — with the overflow / clear-all
// footer. Leaving collapses it back to the capsule. No ambient motion: the
// only animation is entry, exit and the hover-gated unfold.

import { memo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { liveSourceFor } from './liveExternal';
import {
  LiveAvatar, TYPE_ICON, authorAccent, authorName, liveMessageType,
  type LiveMessage, type LiveVariantProps,
} from './liveModel';

const MAX_VISIBLE = 3;
const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
type OpenFn = (m: LiveMessage) => void;

/** Body-click routing shared with the corner stack: a non-channel feed
 *  (Notepad) opens through the host / its own `open`; channel rows open
 *  Conversations on the line. */
function makeOpen({ onOpenConversation, onOpenExternal }: Pick<LiveVariantProps, 'onOpenConversation' | 'onOpenExternal'>): OpenFn {
  return (m) => {
    const source = liveSourceFor(m);
    if (source && onOpenExternal) onOpenExternal(m);
    else if (source?.open) source.open(m);
    else onOpenConversation(m.teamId, m.personaId, m.id);
  };
}

/** Author avatar with an accent ring — the island's identity mark. */
function RingedAvatar({ m, size }: { m: LiveMessage; size: 'sm' | 'md' }) {
  return (
    <span className="flex-shrink-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${mix(authorAccent(m), 55)}` }}>
      <LiveAvatar m={m} size={size} />
    </span>
  );
}

function EventChip({ m }: { m: LiveMessage }) {
  return (
    <span className={`typo-label flex-shrink-0 rounded-full border border-primary/10 bg-secondary/50 px-2 ${m.tone}`}>
      {m.event}
    </span>
  );
}

/** Glyph + acknowledge — shared by capsule and cards. */
function ActCluster({ m, onDismiss }: { m: LiveMessage; onDismiss: (id: string) => void }) {
  const { t } = useTranslation();
  const TypeGlyph = TYPE_ICON[liveMessageType(m)];
  return (
    <div className="flex flex-shrink-0 items-center gap-1">
      <Tooltip content={m.event} placement="right">
        <span role="img" aria-label={m.event} className="flex h-6 w-6 items-center justify-center">
          <TypeGlyph.Icon className={`h-3.5 w-3.5 ${TypeGlyph.cls}`} aria-hidden />
        </span>
      </Tooltip>
      <Tooltip content={t.monitor.live_dismiss} placement="right">
        <button
          type="button"
          onClick={() => onDismiss(m.id)}
          aria-label={t.monitor.live_dismiss}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/15 bg-background/80 text-foreground transition-colors hover:border-status-success/40 hover:text-status-success focus-visible:text-status-success"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

/** The header-seated capsule carrying the newest message. */
function IslandCapsule({ m, waiting, onDismiss, onOpen }: {
  m: LiveMessage; waiting: number;
  onDismiss: (id: string) => void; onOpen: OpenFn;
}) {
  const accent = authorAccent(m);
  return (
    <div
      className={`relative flex h-[38px] w-full items-center gap-2 overflow-hidden rounded-full border bg-background/95 pl-1.5 pr-1.5 shadow-elevation-3 backdrop-blur-md ${
        m.alert ? 'border-status-warning/45' : 'border-primary/15'
      }`}
      style={{ backgroundImage: `linear-gradient(90deg, ${mix(accent, 22)}, transparent 55%)` }}
    >
      <button
        type="button"
        onClick={() => onOpen(m)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <RingedAvatar m={m} size="sm" />
        <span className="typo-title max-w-[30%] flex-shrink-0 truncate" style={{ color: accent }}>
          {authorName(m)}
        </span>
        {m.message && <span className="typo-body min-w-0 flex-1 truncate text-foreground">{m.message}</span>}
      </button>
      {waiting > 0 && (
        <span className="typo-label flex-shrink-0 rounded-full bg-primary/15 px-1.5 text-primary">+{waiting}</span>
      )}
      <ActCluster m={m} onDismiss={onDismiss} />
      {/* Accent hairline — the capsule's underline (future lifeline seat). */}
      <span aria-hidden className="absolute inset-x-8 bottom-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
    </div>
  );
}

/** One full card in the opened island. */
function IslandCard({ m, onDismiss, onOpen, reducedMotion, index }: {
  m: LiveMessage; index: number; reducedMotion: boolean;
  onDismiss: (id: string) => void; onOpen: OpenFn;
}) {
  const accent = authorAccent(m);
  const actions = liveSourceFor(m)?.renderActions?.(m);
  return (
    <motion.div
      layout={!reducedMotion}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0, transition: { delay: reducedMotion ? 0 : index * 0.04 } }}
      exit={{ opacity: 0 }}
      className={`relative flex flex-wrap items-start gap-3 overflow-hidden rounded-card border bg-background/95 p-3 shadow-elevation-2 ${
        m.alert ? 'border-status-warning/40' : 'border-primary/12'
      }`}
      style={{ backgroundImage: `linear-gradient(135deg, ${mix(accent, 14)}, transparent 45%)` }}
    >
      <button
        type="button"
        onClick={() => onOpen(m)}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        <RingedAvatar m={m} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="typo-title truncate" style={{ color: accent }}>{authorName(m)}</span>
            <EventChip m={m} />
          </span>
          <span className="typo-caption mt-0.5 flex items-center gap-1.5 text-foreground">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: m.teamColor }} />
            {m.context ?? m.teamName}
          </span>
          {m.message && <span className="typo-body mt-1.5 line-clamp-3 block text-foreground">{m.message}</span>}
        </span>
      </button>
      <ActCluster m={m} onDismiss={onDismiss} />
      {actions && <div className="w-full pl-11">{actions}</div>}
    </motion.div>
  );
}

function LiveCommsIslandImpl({ messages, onDismiss, onDismissAll, onOpenConversation, onOpenExternal, reducedMotion }: LiveVariantProps) {
  const { t, tx } = useTranslation();
  const [open, setOpen] = useState(false);
  const onOpen = makeOpen({ onOpenConversation, onOpenExternal });
  if (messages.length === 0) return null;
  const [head, ...rest] = messages;
  const deck = rest.slice(0, MAX_VISIBLE - 1);
  const overflow = messages.length - 1 - deck.length;

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-[5px] z-[10000] -translate-x-1/2"
      style={{ width: 'min(520px, 46vw)' }}
    >
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
            <IslandCapsule m={head!} waiting={messages.length - 1} onDismiss={onDismiss} onOpen={onOpen} />
          </motion.div>
        </AnimatePresence>

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
              <IslandCard m={head!} index={0} onDismiss={onDismiss} onOpen={onOpen} reducedMotion={reducedMotion} />
              {deck.map((m, i) => (
                <IslandCard key={m.id} m={m} index={i + 1} onDismiss={onDismiss} onOpen={onOpen} reducedMotion={reducedMotion} />
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

export const LiveCommsIsland = memo(LiveCommsIslandImpl);
