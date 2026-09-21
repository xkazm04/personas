// LIVE COMMS · HEADER BUBBLE — prototype variant A (styling preserved).
//
// The same messenger bubble as the corner stack — avatar outside a rounded
// speech bubble, accent author line, alert warning tint, the glyph + check
// corner cluster — re-seated in the TITLE BAR's top-center, where the eye
// already rests. To fit the 48px header band the bubble goes single-line:
// author and message share one row, the message truncates, and hovering a row
// unfolds it to three lines. Newest sits IN the header; older ones hang below
// it (newest-first, reading downward), the latest 3 stay live and the rest fold
// into the same "+N more · clear all" chip.
//
// Layering: the title bar is `z-index: 9999` and a window drag region, so the
// layer sits above it and every interactive island carries `titlebar-nodrag`
// (a real right-click / drag inside a drag region goes to the window frame).

import { memo } from 'react';
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

function HeaderBubbleRow({
  m, onDismiss, onOpenConversation, onOpenExternal, reducedMotion,
}: {
  m: LiveMessage;
  onDismiss: (id: string) => void;
  onOpenConversation: LiveVariantProps['onOpenConversation'];
  onOpenExternal?: LiveVariantProps['onOpenExternal'];
  reducedMotion: boolean;
}) {
  const { t } = useTranslation();
  const accent = authorAccent(m);
  const TypeGlyph = TYPE_ICON[liveMessageType(m)];
  // A non-channel feed (Notepad) lends its own verbs — same routing as the
  // corner stack: where the body goes, and inline controls under it.
  const source = liveSourceFor(m);
  const actions = source?.renderActions?.(m);
  const openLabel = m.source === 'notepad' ? t.notepad.stack_open_note : t.monitor.live_open_conversation;
  return (
    <motion.div
      layout={!reducedMotion}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="titlebar-nodrag group pointer-events-auto flex w-full items-start gap-2"
    >
      <span className="mt-0.5"><LiveAvatar m={m} size="sm" /></span>

      <div className="relative min-w-0 flex-1">
        {/* Tail — fused to the bubble's left edge, pointing at the avatar. */}
        <span
          aria-hidden
          className={`absolute -left-1 top-2.5 h-2.5 w-2.5 rotate-45 rounded-[2px] border-b border-l ${
            m.alert ? 'border-status-warning/30 bg-status-warning/15' : 'border-primary/12 bg-secondary/40'
          }`}
        />
        <div
          data-source={m.source ?? 'channel'}
          className={`relative w-full overflow-hidden rounded-2xl rounded-tl-md border shadow-elevation-2 backdrop-blur-md transition-colors ${
            m.alert
              ? 'border-status-warning/35 bg-status-warning/[0.06] hover:bg-status-warning/[0.1]'
              : 'border-primary/12 bg-secondary/40 hover:bg-secondary/55'
          }`}
        >
        <Tooltip content={openLabel} placement="left">
          <button
            type="button"
            onClick={() => {
              if (source && onOpenExternal) onOpenExternal(m);
              else if (source?.open) source.open(m);
              else onOpenConversation(m.teamId, m.personaId, m.id);
            }}
            className="relative flex w-full items-start gap-2 py-1.5 pl-3 pr-14 text-left"
          >
            <span className="typo-caption mt-0.5 max-w-[35%] flex-shrink-0 truncate" style={{ color: accent }}>
              {m.context ? `${authorName(m)} · ${m.context}` : authorName(m)}
            </span>
            {m.message && (
              <span className="typo-body min-w-0 flex-1 truncate text-foreground group-hover:line-clamp-3 group-hover:whitespace-normal">
                {m.message}
              </span>
            )}
          </button>
        </Tooltip>
        {actions && <div className="px-3 pb-2">{actions}</div>}
        </div>

        {/* The corner cluster, unchanged in meaning: what the message IS, and
            the one act on it. Tooltips open to the RIGHT — below would sit
            under the rows that hang from the header. */}
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
          <Tooltip content={m.event} placement="right">
            <span role="img" aria-label={m.event} className="flex h-5 w-5 items-center justify-center">
              <TypeGlyph.Icon className={`h-3.5 w-3.5 flex-shrink-0 ${TypeGlyph.cls}`} aria-hidden />
            </span>
          </Tooltip>
          <Tooltip content={t.monitor.live_dismiss} placement="right">
            <button
              type="button"
              onClick={() => onDismiss(m.id)}
              aria-label={t.monitor.live_dismiss}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-primary/15 bg-background/90 text-foreground transition-colors hover:border-status-success/40 hover:text-status-success focus-visible:text-status-success"
            >
              <Check className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>
      </div>
    </motion.div>
  );
}

function LiveCommsHeaderBubbleImpl({ messages, onDismiss, onDismissAll, onOpenConversation, onOpenExternal, reducedMotion }: LiveVariantProps) {
  const { t, tx } = useTranslation();
  if (messages.length === 0) return null;
  const visible = messages.slice(0, MAX_VISIBLE);
  const overflow = messages.length - visible.length;

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-1.5 z-[10000] flex -translate-x-1/2 flex-col items-center gap-1.5"
      style={{ width: 'min(480px, 44vw)' }}
    >
      {/* Newest at the TOP — inside the header band — older ones hang below. */}
      <AnimatePresence initial={false}>
        {visible.map((m) => (
          <HeaderBubbleRow
            key={m.id}
            m={m}
            onDismiss={onDismiss}
            onOpenConversation={onOpenConversation}
            onOpenExternal={onOpenExternal}
            reducedMotion={reducedMotion}
          />
        ))}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {overflow > 0 && (
          <motion.div
            key="overflow"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="titlebar-nodrag pointer-events-auto flex items-center gap-2 rounded-full border border-primary/12 bg-secondary/80 px-2.5 py-1 backdrop-blur-sm"
          >
            <span className="typo-caption text-foreground">{tx(t.monitor.live_more, { count: overflow })}</span>
            <button
              type="button"
              onClick={onDismissAll}
              className="typo-caption text-primary transition-colors hover:text-primary/80"
            >
              {t.monitor.live_clear_all}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const LiveCommsHeaderBubble = memo(LiveCommsHeaderBubbleImpl);
