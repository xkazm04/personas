// Variant C — PULSE STRIP.
//
// Metaphor: a heads-up status line. By default a single slim capsule sits in
// the corner — a live pulse, the team/new count, and the newest one-liner —
// deliberately low-noise. Clicking expands it UPWARD into a glass panel of the
// latest 3 rich rows; each row redirects into the Timeline. The panel
// auto-collapses when traffic goes idle, and the whole capsule fades out once
// every message has aged out. The most restrained of the three directions.

import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronUp, X } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import {
  LiveAvatar, authorAccent, authorName, COPY,
  type LiveMessage, type LiveVariantProps,
} from './liveModel';

const PANEL_ROWS = 3;
const IDLE_COLLAPSE_MS = 6000;

function Row({
  m, onDismiss, onOpenTimeline,
}: {
  m: LiveMessage;
  onDismiss: (id: string) => void;
  onOpenTimeline: (teamId?: string) => void;
}) {
  return (
    <div
      className="group/row flex items-start gap-2.5 rounded-interactive px-2 py-1.5 transition-colors hover:bg-foreground/[0.03]"
      style={{ boxShadow: `inset 2px 0 0 ${m.alert ? 'var(--color-status-warning)' : m.teamColor}` }}
    >
      <LiveAvatar m={m} size="sm" />
      <button type="button" onClick={() => onOpenTimeline(m.teamId)} title={COPY.openTimeline} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="typo-caption font-semibold truncate" style={{ color: authorAccent(m) }}>{authorName(m)}</span>
          <span className={`typo-caption uppercase tracking-wider flex-shrink-0 ${m.tone}`}>{m.event}</span>
          <span className="ml-auto flex-shrink-0 typo-caption text-foreground/40"><RelativeTime timestamp={m.at} /></span>
        </div>
        {m.message && <p className="mt-0.5 typo-caption text-foreground/70 line-clamp-2">{m.message}</p>}
      </button>
      <button
        type="button"
        onClick={() => onDismiss(m.id)}
        aria-label={COPY.dismiss}
        className="mt-0.5 flex-shrink-0 text-foreground/40 opacity-0 transition-opacity hover:text-foreground group-hover/row:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function LivePulseStripImpl({ messages, onDismiss, onDismissAll, onOpenTimeline, reducedMotion }: LiveVariantProps) {
  const [open, setOpen] = useState(false);
  const newestId = messages[0]?.id;
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New traffic re-opens nothing, but DOES reset the idle-collapse timer while
  // the panel is open — so the panel stays up through an active burst, then
  // folds away once things go quiet.
  useEffect(() => {
    if (!open) return;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setOpen(false), IDLE_COLLAPSE_MS);
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [open, newestId]);

  if (messages.length === 0) return null;
  const newest = messages[0]!;
  const teams = new Set(messages.map((m) => m.teamId)).size;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-[340px] flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            className="pointer-events-auto w-full overflow-hidden rounded-card border border-primary/15 bg-background/95 shadow-elevation-4 backdrop-blur-md"
          >
            <div className="flex items-center gap-2 border-b border-primary/8 px-3 py-2">
              <span className="typo-caption font-medium uppercase tracking-wider text-foreground/60">{COPY.title}</span>
              <button
                type="button"
                onClick={onDismissAll}
                className="ml-auto typo-caption font-medium text-foreground/55 transition-colors hover:text-foreground"
              >
                {COPY.dismissAll}
              </button>
            </div>
            <div className="space-y-0.5 p-1.5">
              {messages.slice(0, PANEL_ROWS).map((m) => (
                <Row key={m.id} m={m} onDismiss={onDismiss} onOpenTimeline={onOpenTimeline} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The always-present capsule. */}
      <motion.button
        layout={!reducedMotion}
        type="button"
        onClick={() => setOpen((v) => !v)}
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full border border-primary/15 bg-background/95 py-1.5 pl-3 pr-2.5 shadow-elevation-3 backdrop-blur-md transition-colors hover:bg-foreground/[0.03]"
      >
        <span className="relative flex h-2 w-2 flex-shrink-0">
          {!reducedMotion && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-success/60" />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-status-success" />
        </span>
        <span className="typo-caption font-medium text-foreground/70 tabular-nums flex-shrink-0">
          {COPY.teamsActive(teams, messages.length)}
        </span>
        <span className="h-3 w-px flex-shrink-0 bg-primary/15" />
        <span className="typo-caption text-foreground/55 truncate">
          <span className="font-medium" style={{ color: authorAccent(newest) }}>{authorName(newest)}</span>
          {' '}{newest.event}
        </span>
        <ChevronUp className={`h-3.5 w-3.5 flex-shrink-0 text-foreground/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </motion.button>
    </div>
  );
}

export const LivePulseStrip = memo(LivePulseStripImpl);
export default LivePulseStrip;
