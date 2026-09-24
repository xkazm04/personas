import type { ReactNode } from 'react';
import { FolderGit2, Gauge, Maximize2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Badge } from '@/features/shared/components/display/Badge';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';

import type { NoteSaveState } from '../../notepadStore';
import { noteStatusMeta } from '../../noteStatusMeta';
import { CARD_TEXT_LIMIT, visibleLength } from '../../noteText';
import { SaveDot } from '../../parts/SaveDot';
import type { DeskForecast } from '../deskForecast';

/** The project a note belongs to — its name, never a raw id. */
export function ProjectLabel({
  projectId,
  projects,
  className = '',
}: {
  projectId: string | null;
  projects: readonly DevProject[];
  className?: string;
}) {
  const { t } = useTranslation();
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
  return (
    <span className={`flex items-center gap-1.5 min-w-0 typo-caption ${project ? 'text-foreground/75' : 'text-foreground/50'} ${className}`}>
      <FolderGit2 className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
      <span className="truncate">{project?.name ?? t.notepad.project_none}</span>
    </span>
  );
}

/**
 * The goals bar — the milestone's `goalsDone / goalsTotal` as a 2px rule under
 * the title.
 *
 * HIDDEN at `goalsTotal === 0`, which is not the same as 0%: a milestone with no
 * goals yet has nothing to be a fraction of, and an empty bar would read as "no
 * progress" rather than "nothing decomposed". The fill takes the note's own
 * status tone, so the card carries one colour rather than two.
 */
export function GoalsBar({ note, summary }: { note: DevNote; summary: NotePlanSummary }) {
  const { t, tx } = useTranslation();
  if (summary.goalsTotal <= 0) return null;
  const done = Math.min(summary.goalsDone, summary.goalsTotal);
  const pct = Math.round((done / summary.goalsTotal) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={summary.goalsTotal}
      aria-valuenow={done}
      aria-label={tx(t.notepad.desk_goals_progress, { done, total: summary.goalsTotal })}
      data-testid={`notepad-card-goals-${note.id}`}
      className="h-0.5 w-full rounded-full bg-secondary/50 overflow-hidden"
    >
      {/* Width is the DATA, so it is the one thing that cannot be a token. */}
      <div className={`h-full ${noteStatusMeta(note.status).tone.fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The card's state as a GLYPH — icon only, no word. The colour and the icon
 * both come from `noteStatusMeta`, so the badge reads the same as the tab
 * strip and the timeline; the word moves to the tooltip and the accessible
 * name, where it costs the card's one horizontal row nothing.
 */
export function NoteStatusGlyph({
  status,
  label,
  detail,
  testId,
}: {
  status: DevNote['status'];
  label: string;
  /** Hover-only extra line (e.g. the stamp's age). Never rendered on the card. */
  detail?: ReactNode;
  testId?: string;
}) {
  const meta = noteStatusMeta(status);
  return (
    <Tooltip
      placement="bottom"
      content={detail ? <span className="flex items-center gap-1.5">{label}<span aria-hidden>·</span>{detail}</span> : label}
    >
      <Badge variant={meta.badgeVariant} size="xs" role="img" aria-label={label} data-testid={testId}>
        <meta.Icon className="w-3.5 h-3.5" aria-hidden />
      </Badge>
    </Tooltip>
  );
}

/**
 * The milestone's stamp as a glyph — the cut or shipped icon.
 *
 * REPLACES the plain status badge on a linked card rather than sitting beside
 * it. WHEN the stamp landed is kept, but only in the tooltip. Returns null when
 * the summary carries neither stamp, and the caller falls back to the ordinary
 * status glyph.
 */
export function PlanStampBadge({ note, summary }: { note: DevNote; summary: NotePlanSummary }) {
  const { t } = useTranslation();
  const shipped = Boolean(summary.shippedAt);
  const stamp = shipped ? summary.shippedAt : summary.cutAt;
  if (!stamp) return null;
  return (
    <NoteStatusGlyph
      status={shipped ? 'shipped' : 'cut'}
      label={shipped ? t.notepad.status_shipped : t.notepad.status_cut}
      detail={<RelativeTime timestamp={stamp} format="elapsed" />}
      testId={`notepad-card-stamp-${note.id}`}
    />
  );
}

/**
 * The card's ONE metadata row: last touched · save state · characters used ·
 * open. The count shows only on a draft — the one state whose text can still
 * change — counts VISIBLE characters (markers are formatting, not text), and
 * turns amber past the card limit, which is also the reason such a card shows
 * a faded rendering instead of an editable one.
 *
 * A linked card gains ONE line above it: the project's cycle-time forecast for
 * this milestone. It is a whole line rather than another chip in the row because
 * it is the only thing on the card that is a PREDICTION, and a prediction that
 * has to be told apart from a measurement by its position in a dense row will
 * not be.
 */
export function NoteCardFooter({
  note,
  saveState,
  forecast,
  onOpen,
  rail,
  railShown = false,
  onRailFocusChange,
}: {
  note: DevNote;
  saveState: NoteSaveState;
  /** Absent for an unlinked note, a shipped one, and a project below the
   *  evidence bar — see `deskForecast.ts`. */
  forecast?: DeskForecast;
  onOpen: () => void;
  /** The lifecycle rail. It shares the metadata's slot: while it is shown the
   *  metadata fades out under it, so revealing it moves nothing on the card. */
  rail?: ReactNode;
  railShown?: boolean;
  /** Keyboard focus entered / left the rail — focus alone reveals it. */
  onRailFocusChange?: (focused: boolean) => void;
}) {
  const { t, tx } = useTranslation();
  const length = visibleLength(note.bodyMd);
  return (
    <footer className="flex flex-col gap-1">
      {forecast && (
        <p
          className="flex items-center gap-1.5 min-w-0 typo-caption text-foreground/85"
          data-testid={`notepad-card-forecast-${note.id}`}
        >
          <Gauge className="w-3 h-3 shrink-0 text-status-info" aria-hidden />
          <span className="truncate tabular-nums">
            {tx(
              forecast.basis === 'cut' ? t.notepad.desk_forecast_cut : t.notepad.desk_forecast_today,
              { date: forecast.date },
            )}
          </span>
        </p>
      )}
      <div className="flex items-center gap-2 typo-caption text-foreground/60">
        <div
          className="relative flex-1 min-w-0 h-7 flex items-center"
          onFocus={() => onRailFocusChange?.(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onRailFocusChange?.(false);
          }}
        >
          <span
            className={`flex items-center gap-2 min-w-0 transition-opacity duration-150 ${rail && railShown ? 'opacity-0' : 'opacity-100'}`}
            aria-hidden={rail && railShown ? true : undefined}
          >
            <RelativeTime timestamp={note.updatedAt} format="elapsed" />
            <SaveDot state={saveState} />
            {note.status === 'draft' && (
              <>
                <span aria-hidden>·</span>
                <span
                  className={`tabular-nums ${length > CARD_TEXT_LIMIT ? 'text-status-warning' : ''}`}
                  data-testid={`notepad-card-count-${note.id}`}
                >
                  {length}/{CARD_TEXT_LIMIT}
                </span>
              </>
            )}
          </span>
          {rail}
        </div>
        <Tooltip content={t.notepad.overview_open}>
          <button
            type="button"
            onClick={onOpen}
            aria-label={t.notepad.overview_open}
            data-testid={`notepad-card-open-${note.id}`}
            className="shrink-0 w-7 h-7 rounded-input flex items-center justify-center text-foreground/60 hover:text-foreground hover:bg-secondary/50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-ring"
          >
            <Maximize2 className="w-3.5 h-3.5" aria-hidden />
          </button>
        </Tooltip>
      </div>
    </footer>
  );
}

/** Ghost grid under the overview's chrome while the first fetch is in flight. */
export function OverviewGhost() {
  return (
    <div className="grid grid-cols-4 gap-4" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-52 rounded-card bg-secondary/20" />
      ))}
    </div>
  );
}
