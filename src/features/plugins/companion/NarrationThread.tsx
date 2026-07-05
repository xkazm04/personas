/**
 * NarrationThread — the visible halves of the narration timeline
 * (see `narrationTimeline.ts` for the data model; named differently from
 * it because Windows' case-insensitive FS can't host both
 * `narrationTimeline.ts` and `NarrationTimeline.tsx`):
 *
 * - `NarrationLiveLog` renders under the *streaming* bubble: the trail of
 *   beats + tool calls so far this turn. The streaming bubble's status
 *   line is the bold "now"; this log is the history beneath it.
 * - `NarrationTrail` renders under a *completed* bubble: a collapsed
 *   one-liner ("What I did — 7 steps · 48s") that expands to the full
 *   trail. Session-scoped, like the recall strip.
 *
 * Both render nothing for an empty timeline, so they're safe to mount
 * unconditionally.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { formatDuration } from '@/lib/utils/formatters';
import { phaseLabel } from './extractStreamPhase';
import type { NarrationEntry, StoredNarration } from './narrationTimeline';

/** Keep the live log glanceable — older rows collapse into "+N earlier". */
const LIVE_MAX_ROWS = 5;

function EntryRow({ entry }: { entry: NarrationEntry }) {
  const { t, tx } = useTranslation();
  const label =
    entry.kind === 'beat'
      ? entry.text ?? ''
      : phaseLabel(t, tx, {
          kind: 'tool_use',
          toolName: entry.toolName,
          detail: entry.detail,
        });
  const icon =
    entry.kind === 'beat' ? (
      <Sparkles className="w-3 h-3 text-primary shrink-0" />
    ) : entry.endedAt != null ? (
      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
    ) : (
      <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />
    );
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5">{icon}</span>
      <span
        className={
          entry.kind === 'beat'
            ? 'typo-caption italic text-foreground'
            : 'typo-caption text-foreground'
        }
      >
        {label}
      </span>
      {entry.kind === 'tool' && entry.endedAt != null && (
        <span className="typo-caption tabular-nums text-foreground ml-auto shrink-0">
          {formatDuration(entry.endedAt - entry.at)}
        </span>
      )}
    </li>
  );
}

export function NarrationLiveLog({ entries }: { entries: NarrationEntry[] }) {
  const { t, tx } = useTranslation();
  if (entries.length === 0) return null;
  const c = t.plugins.companion;
  const hidden = Math.max(0, entries.length - LIVE_MAX_ROWS);
  const visible = hidden > 0 ? entries.slice(hidden) : entries;
  return (
    <div
      className="rounded-card border border-foreground/10 bg-foreground/[0.04] px-3 py-2"
      role="log"
      aria-label={c.narration_live_label}
      data-testid="companion-narration-live"
    >
      <ul className="space-y-1">
        {hidden > 0 && (
          <li className="typo-caption tabular-nums text-foreground">
            {tx(c.narration_earlier, { count: hidden })}
          </li>
        )}
        {visible.map((e) => (
          <EntryRow key={e.id} entry={e} />
        ))}
      </ul>
    </div>
  );
}

export function NarrationTrail({ narration }: { narration: StoredNarration }) {
  const { t, tx } = useTranslation();
  const { shouldAnimate } = useMotion();
  const [open, setOpen] = useState(false);
  // Beats now persist as their own conversational aside messages (Phase A/B),
  // so the collapsed trail keeps only the tool-call history with durations —
  // its unique value — and never double-shows the beats.
  const toolEntries = narration.entries.filter((e) => e.kind === 'tool');
  if (toolEntries.length === 0) return null;
  const c = t.plugins.companion;
  const count = toolEntries.length;
  const steps = tx(count === 1 ? c.narration_steps_one : c.narration_steps_other, {
    count,
  });
  const duration = formatDuration(
    Math.max(0, narration.endedAt - narration.startedAt),
  );

  const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];
  // Gentle appear when the trail is first promoted under a finished reply —
  // fires once on mount, so it never re-plays on transcript re-renders. Under
  // reduced motion it snaps in with no fade/slide.
  const appear = shouldAnimate
    ? { initial: { opacity: 0, y: 3 }, animate: { opacity: 1, y: 0 } }
    : { initial: false as const, animate: { opacity: 1, y: 0 } };

  return (
    <motion.div
      {...appear}
      transition={{ duration: shouldAnimate ? 0.24 : 0, ease }}
      data-testid="companion-narration-trail"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? c.narration_hide : c.narration_show}
        className={`group/trail inline-flex max-w-full items-center gap-1.5 rounded-interactive px-2 py-1 typo-caption transition-colors hover:bg-foreground/[0.06] ${
          open ? 'bg-foreground/[0.05]' : ''
        }`}
      >
        <motion.span
          className="flex shrink-0 text-foreground/45 group-hover/trail:text-foreground/70"
          aria-hidden
          initial={false}
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: shouldAnimate ? 0.2 : 0, ease }}
        >
          <ChevronRight className="w-3 h-3" />
        </motion.span>
        <span className="truncate">
          <span className="font-medium text-foreground/85">{c.narration_trail_label}</span>
          <span className="text-foreground/45"> — {steps} · {duration}</span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="trail-details"
            initial={shouldAnimate ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={shouldAnimate ? { height: 0, opacity: 0 } : { opacity: 0 }}
            transition={{ duration: shouldAnimate ? 0.22 : 0, ease }}
            className="overflow-hidden"
          >
            <ul className="mt-1 space-y-1.5 rounded-card border border-foreground/10 bg-foreground/[0.04] px-3 py-2">
              {toolEntries.map((e) => (
                <EntryRow key={e.id} entry={e} />
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
