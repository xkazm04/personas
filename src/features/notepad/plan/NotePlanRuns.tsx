// What has actually been run against this note, newest first.
//
// The Ship tab has never had this. Its only record of a run was the ingest
// summary held in `useShipMilestoneRun`'s state — one run, gone on remount, and
// only if you pressed Ingest yourself. `dev_note_runs` is append-only and the
// ticker writes to it, so the pad can answer "what has happened to this?"
// without the operator having pressed anything.
import { useCallback, useEffect, useState } from 'react';
import { PencilRuler, Rocket, SquareTerminal, Target } from 'lucide-react';

import { listNoteRuns } from '@/api/notepad';
import { Badge } from '@/features/shared/components/display/Badge';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevNoteRun } from '@/lib/bindings/DevNoteRun';
import type { ShipMilestoneIngestSummary } from '@/lib/bindings/ShipMilestoneIngestSummary';
import type { Translations } from '@/i18n/generated/types';
import { silentCatch } from '@/lib/silentCatch';

import { ShipRunSummary } from './ShipMilestoneRun';

/**
 * Parse a `ship_milestone` run's stored report.
 *
 * BOUNDARY PARSE, and the invariant it rests on is narrow: `summaryJson` is
 * TEXT written by the `/ship-milestone` skill through `dev_tools_ship_milestone_ingest`,
 * whose Rust side validated it against `ShipMilestoneIngestSummary` before
 * storing it. The binding is therefore the shape of anything that got PAST that
 * door — but a row can also predate a schema change, or have been written by a
 * skill version this build has never seen, and neither of those is something
 * the type system knows.
 *
 * So the check is structural, not a cast: the four counters must really be
 * numbers and the two lists must really be arrays. A row that fails is DROPPED
 * from the runs list rather than defaulted — a summary showing `0 updated` for a
 * run that updated nine items is a lie the operator cannot detect, and an absent
 * row at least reads as absent.
 */
function parseIngestSummary(raw: string | null): ShipMilestoneIngestSummary | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    const numeric = ['itemsUpdated', 'ratingsSet', 'descriptionsSet', 'itemsReported'];
    if (numeric.some((k) => typeof o[k] !== 'number')) return null;
    if (!Array.isArray(o.proposedAdditions) || !Array.isArray(o.questionsAsked)) return null;
    // Every field the panel reads has now been checked against the wire value,
    // which is what this assertion names: the shape is verified, not assumed.
    return parsed as ShipMilestoneIngestSummary;
  } catch {
    // Malformed JSON in a column that should only ever hold a validated report.
    // Worth a Sentry breadcrumb; not worth a toast on a tab the operator opened
    // to read history.
    silentCatch('notepad run summary parse')(new Error('unparseable dev_note_runs.summary_json'));
    return null;
  }
}

/** The label + glyph for a run kind. Unknown kinds render their raw token with
 *  the neutral glyph rather than being hidden — a run this build cannot name is
 *  still a run that happened. */
function kindMeta(kind: string, t: Translations): { label: string; Icon: typeof Rocket } {
  switch (kind) {
    case 'note_task': return { label: t.notepad.run_kind_note_task, Icon: SquareTerminal };
    case 'ship_milestone': return { label: t.notepad.run_kind_ship_milestone, Icon: Rocket };
    case 'athena_goals': return { label: t.notepad.run_kind_athena_goals, Icon: Target };
    default: return { label: kind, Icon: PencilRuler };
  }
}

/** A non-ship run's report is free text under a `summary` key (the `/note-task`
 *  `result.json` body). Read it defensively for the same reason as above. */
function plainSummary(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const summary = (parsed as Record<string, unknown>).summary;
    return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
  } catch {
    return null;
  }
}

function RunRow({ run, onCompose }: { run: DevNoteRun; onCompose: () => void }) {
  const { t } = useTranslation();
  const { label, Icon } = kindMeta(run.kind, t);
  const ingest = run.kind === 'ship_milestone' ? parseIngestSummary(run.summaryJson) : null;
  const text = ingest ? null : plainSummary(run.summaryJson);
  const running = run.status === 'running';

  return (
    <li className="rounded-card border border-primary/10 bg-secondary/10 px-3 py-2.5" data-testid={`note-run-${run.id}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Icon className="w-3.5 h-3.5 text-foreground/60 shrink-0" aria-hidden />
        <span className="typo-title">{label}</span>
        <Badge
          variant={running ? 'cyan' : run.status === 'completed' ? 'emerald' : 'red'}
          size="sm"
        >
          {/* A running row says so in WORDS. Never a spinner: this is a surface
              reporting state, not a control the operator just pressed. */}
          {running ? t.notepad.run_running : run.status}
        </Badge>
        <RelativeTime timestamp={run.startedAt} className="typo-caption text-foreground/60" />
      </div>

      {ingest ? (
        // Proposed additions render as PROPOSALS. `ShipRunSummary` surfaces them
        // and offers no way to apply them, which is the ingest door's own rule.
        <ShipRunSummary summary={ingest} onDismiss={onCompose} />
      ) : text ? (
        <p className="typo-caption text-foreground/70 mt-1.5 whitespace-pre-wrap">{text}</p>
      ) : null}
    </li>
  );
}

export function NotePlanRuns({ noteId, onCompose }: {
  noteId: string;
  /** The "Compose" shortcut a summary's dismiss offers — a proposed addition is
   *  acted on by opening the composer, never by the panel applying it. */
  onCompose: () => void;
}) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<DevNoteRun[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let alive = true;
    listNoteRuns(noteId)
      .then((rows) => {
        if (!alive) return;
        // Newest first is THIS surface's decision, not the command's ordering.
        setRuns([...rows].sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
        setLoading(false);
      })
      .catch((e) => {
        silentCatch('notepad list runs')(e);
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [noteId]);

  useEffect(load, [load]);

  // Ghost UNDER nothing — this tab has no permanent chrome of its own, so the
  // ghost IS the geometry of the rows it replaces, and only while there is
  // genuinely nothing to show (loading law 1).
  if (loading && runs.length === 0) {
    return (
      <ul className="flex flex-col gap-2" aria-hidden data-testid="note-runs-ghost">
        {[0, 1].map((i) => (
          <li key={i} className="h-16 rounded-card bg-secondary/25" />
        ))}
      </ul>
    );
  }

  if (runs.length === 0) {
    return (
      <p className="typo-caption text-foreground/60 rounded-card border border-dashed border-primary/15 px-3 py-4 text-center" data-testid="note-runs-empty">
        {t.notepad.runs_empty}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="note-runs-list">
      {runs.map((run) => (
        <RunRow key={run.id} run={run} onCompose={onCompose} />
      ))}
    </ul>
  );
}
