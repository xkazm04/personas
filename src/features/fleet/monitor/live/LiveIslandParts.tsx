// Signal Island parts — the pieces LiveCommsStack assembles: the header-seated
// capsule (newest message), the full cards of the opened island, and the small
// shared marks (ringed avatar, event chip, glyph + acknowledge cluster, the
// draining lifeline). See LiveCommsStack.tsx for the metaphor.

import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { liveSourceFor } from './liveExternal';
import {
  LiveAvatar, TYPE_ICON, authorAccent, authorName, liveMessageType,
  type LiveMessage, type LiveVariantProps,
} from './liveModel';

export const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

export type OpenFn = (m: LiveMessage) => void;

/** Body-click routing: a non-channel feed (Notepad) opens through the host /
 *  its own `open`; channel rows open Conversations on the line. */
export function makeOpen({ onOpenConversation, onOpenExternal }: Pick<LiveVariantProps, 'onOpenConversation' | 'onOpenExternal'>): OpenFn {
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

/** Glyph + acknowledge — shared by capsule and cards. Tooltips open to the
 *  RIGHT: below would sit under the opened island's cards. */
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

/** The capsule's underline, draining left-to-right over what is left of the
 *  message's lifetime. Frozen (not drained) while the island is held open —
 *  the host pauses the clock for exactly that span. Keyed by its remaining
 *  time so a resume restarts the drain from where it froze. */
function Lifeline({ accent, remainingMs, lifetimeMs, paused }: {
  accent: string; remainingMs: number; lifetimeMs: number; paused: boolean;
}) {
  const frac = Math.max(0, Math.min(1, remainingMs / lifetimeMs));
  return (
    <motion.span
      key={`${remainingMs}-${paused}`}
      aria-hidden
      className="absolute inset-x-8 bottom-0 h-px origin-left"
      style={{ background: `linear-gradient(90deg, ${accent}, ${mix(accent, 35)})` }}
      initial={{ scaleX: frac }}
      animate={{ scaleX: paused ? frac : 0 }}
      transition={{ duration: paused ? 0 : remainingMs / 1000, ease: 'linear' }}
    />
  );
}

/** The header-seated capsule carrying the newest message. */
export function IslandCapsule({ m, waiting, remainingMs, lifetimeMs, paused, onDismiss, onOpen }: {
  m: LiveMessage; waiting: number; remainingMs: number; lifetimeMs: number; paused: boolean;
  onDismiss: (id: string) => void; onOpen: OpenFn;
}) {
  const accent = authorAccent(m);
  return (
    <div
      data-testid={m.source === 'notepad' ? `live-stack-notepad-${m.noteId}` : undefined}
      data-source={m.source ?? 'channel'}
      className={`relative flex h-[38px] w-full items-center gap-2 overflow-hidden rounded-full border bg-background/95 pl-1.5 pr-1.5 shadow-elevation-3 backdrop-blur-md ${
        m.alert ? 'border-status-warning/45' : 'border-primary/15'
      }`}
      style={{ backgroundImage: `linear-gradient(90deg, ${mix(accent, 22)}, transparent 55%)` }}
    >
      <button
        type="button"
        onClick={() => onOpen(m)}
        data-testid={m.source === 'notepad' ? `live-stack-notepad-open-${m.noteId}` : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <RingedAvatar m={m} size="sm" />
        <span className="typo-title max-w-[30%] flex-shrink-0 truncate" style={{ color: accent }}>
          {authorName(m)}
        </span>
        {m.context && <span className="typo-caption max-w-[30%] flex-shrink-0 truncate text-foreground">{m.context}</span>}
        {m.message && <span className="typo-body min-w-0 flex-1 truncate text-foreground">{m.message}</span>}
      </button>
      {waiting > 0 && (
        <span className="typo-label flex-shrink-0 rounded-full bg-primary/15 px-1.5 text-primary">+{waiting}</span>
      )}
      <ActCluster m={m} onDismiss={onDismiss} />
      <Lifeline accent={accent} remainingMs={remainingMs} lifetimeMs={lifetimeMs} paused={paused} />
    </div>
  );
}

/** One full card in the opened island. `withActions` is false for the head
 *  message, whose inline actions already ride in the tray under the capsule. */
export function IslandCard({ m, index, withActions, reducedMotion, onDismiss, onOpen }: {
  m: LiveMessage; index: number; withActions: boolean; reducedMotion: boolean;
  onDismiss: (id: string) => void; onOpen: OpenFn;
}) {
  const accent = authorAccent(m);
  const actions = withActions ? liveSourceFor(m)?.renderActions?.(m) : null;
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
      <button type="button" onClick={() => onOpen(m)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
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
