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
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
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
  return (
    <div data-testid="companion-narration-trail">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? c.narration_hide : c.narration_show}
        className="inline-flex items-center gap-1.5 rounded-interactive px-1.5 py-0.5 typo-caption text-foreground hover:bg-foreground/[0.06] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" aria-hidden />
        )}
        <span>
          {c.narration_trail_label} — {steps} · {duration}
        </span>
      </button>
      {open && (
        <ul className="mt-1 space-y-1 rounded-card border border-foreground/10 bg-foreground/[0.04] px-3 py-2">
          {toolEntries.map((e) => (
            <EntryRow key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </div>
  );
}
