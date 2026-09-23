import { memo, useState } from 'react';
import { CalendarClock, Clock, MessageSquare, Send } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';

import {
  NOTE_LIFECYCLE_BRAINSTORM, NOTE_LIFECYCLE_PLAN, noteLifecycleFor, noteStatusMeta,
} from '../../noteStatusMeta';
import type { DeskForecast } from '../deskForecast';
import { splitHighlight } from '../deskModel';
import { PlanStampBadge } from '../parts/NoteCardBits';
import { railNextStep, type RailNext } from '../parts/NoteLifecycleRail';
import type { NoteRail } from './questlogModel';

/** Everything a row needs to know about one goal that is not on the goal itself.
 *  Assembled once for the whole desk by `QuestLogOverview`, never per row. */
export interface GoalSignals {
  /** Unread entries from an agent or Athena. The operator's own comments are
   *  born read, so any unread count means somebody is waiting on a reading. */
  unread: number;
  /** An agent or Athena is on this goal right now; ISO start of the work. */
  workingSince: string | null;
  /** Whole days past the milestone's target date, or 0. */
  lateDays: number;
  /** On the rail the operator is currently looking down. Off-rail rows dim in
   *  place — the rail is a lens, not a filter. */
  onRail: boolean;
}

export const NO_SIGNALS: GoalSignals = Object.freeze({ unread: 0, workingSince: null, lateDays: 0, onRail: true });

/** The marks that follow a title. Deliberately the same set in both the line
 *  form and the dense sentence form, so folding a run never drops a reading. */
const Marks = memo(function Marks({ signals }: { signals: GoalSignals }) {
  const { t, tx } = useTranslation();
  return (
    <>
      {signals.unread > 0 && (
        <span className="ql-tag text-brand-rose">{t.notepad.desk_needs_you}</span>
      )}
      {signals.workingSince && (
        <span className="ql-tag text-status-pending">
          <RelativeTime timestamp={signals.workingSince} format="elapsed" showTooltip={false} />
        </span>
      )}
      {signals.lateDays > 0 && (
        <span className="ql-tag text-status-error">
          <Clock aria-hidden />
          {tx(t.notepad.desk_days_late, { count: signals.lateDays })}
        </span>
      )}
      {signals.unread > 0 && (
        <span className="ql-tag text-foreground/85">
          <MessageSquare aria-hidden />
          {signals.unread}
        </span>
      )}
    </>
  );
});

/** The first token of the find query, lit inside the title. */
function Title({ title, query }: { title: string; query: string }) {
  const split = query.trim() ? splitHighlight(title, query) : null;
  if (!split) return <>{title}</>;
  return (
    <>
      {split.pre}
      <mark className="bg-primary/30 text-foreground rounded-[2px] px-[1px]">{split.hit}</mark>
      {split.post}
    </>
  );
}

interface QuestRowProps {
  note: DevNote;
  signals: GoalSignals;
  /** True for every goal after the first in a run of one status: it draws a
   *  wire instead of repeating the glyph. */
  wired: boolean;
  rail: NoteRail;
  selected: boolean;
  query: string;
  matched: boolean;
  /** Present only for the goal the cursor is on AND the operator expanded. */
  detail?: RowDetail;
  onSelect: () => void;
  onOpen: () => void;
}

/**
 * One goal, one line.
 *
 * Three tracks: a mark gutter that carries the single most urgent signal, a
 * glyph column that either names the status or wires this goal to the one above
 * it, and the title — **whole, never clipped, never behind a hover**. That last
 * rule is the constraint the whole layout is built around; if a title cannot
 * fit, the fit ladder changes the type and then the form, and when it runs out
 * the column scrolls and says what is below. It never shortens a title.
 */
export const QuestRow = memo(function QuestRow({
  note, signals, wired, rail, selected, query, matched, detail, onSelect, onOpen,
}: QuestRowProps) {
  const { t } = useTranslation();
  const meta = noteStatusMeta(note.status);
  const waiting = signals.unread > 0;
  const searching = query.trim().length > 0;

  const cls = [
    'ql-row',
    `is-rail-${rail}`,
    meta.tone.text,
    waiting ? 'is-waiting' : '',
    signals.onRail ? '' : 'is-off',
    selected ? 'is-selected' : '',
    searching && matched ? 'is-hit' : '',
    searching && !matched ? 'is-dim' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="ql-rowwrap" data-goal-id={note.id}>
    <button
      type="button"
      className={cls}
      aria-current={selected ? 'true' : undefined}
      aria-expanded={detail ? true : undefined}
      onPointerDown={onSelect}
      onClick={onOpen}
    >
      <span className="ql-mark">
        {waiting ? (
          <span className="ql-bang" aria-label={t.notepad.desk_needs_you}>!</span>
        ) : signals.workingSince ? (
          <span className="w-1.5 h-1.5 rounded-full bg-status-pending" aria-hidden />
        ) : signals.lateDays > 0 ? (
          <Clock className="w-3 h-3 text-status-error" aria-hidden />
        ) : null}
      </span>
      <span className="ql-glyph">
        {wired ? (
          <>
            <i className="ql-wire" aria-hidden />
            <span className="sr-only">{meta.labelKey(t)}</span>
          </>
        ) : (
          <>
            <meta.Icon aria-hidden />
            <span className="sr-only">{meta.labelKey(t)}</span>
          </>
        )}
      </span>
      <span className="ql-title">
        <Title title={note.title} query={query} />
        <Marks signals={signals} />
      </span>
    </button>
    {detail && <QuestRowDetail note={note} {...detail} />}
    </div>
  );
});

export interface RowDetail {
  summary?: NotePlanSummary;
  forecast?: DeskForecast;
  onAdvance: (next: RailNext) => Promise<void>;
}

/**
 * The second row, opened on the selected goal only.
 *
 * It is the journey plus the readings a one-line row has no space for, and it
 * is drawn HERE rather than borrowed from the card: `NoteLifecycleRail` is
 * `position: absolute` by design — it overlays a card's footer — so inline it
 * contributes no height at all (measured: the rail rendered 154px out of flow
 * while this strip collapsed to 12px), and 154px is most of a journal column
 * anyway. What is reused is the part that matters, `railNextStep`: the same
 * pure function the card asks "what is the one move from here", so the two
 * surfaces can never offer different next steps.
 */
function QuestRowDetail({ note, summary, forecast, onAdvance }: { note: DevNote } & RowDetail) {
  const { t, tx } = useTranslation();
  const [advancing, setAdvancing] = useState(false);
  // Pick the rail that actually CONTAINS this status, and only fall back to the
  // one the milestone implies. A goal whose status and milestone disagree is not
  // supposed to exist, but when it does the journey should still say where the
  // goal is rather than silently marking every step as unreached.
  const byStatus = [NOTE_LIFECYCLE_PLAN, NOTE_LIFECYCLE_BRAINSTORM].find((l) => l.includes(note.status));
  const steps = byStatus ?? noteLifecycleFor(note.milestoneId);
  const at = steps.indexOf(note.status);
  const next = railNextStep(note);
  const done = summary ? Math.min(summary.goalsDone, summary.goalsTotal) : 0;

  return (
    <div className="ql-detail">
      {/* The journey: where this goal has been, where it is, what is left. */}
      <ol className="ql-journey" aria-label={t.notepad.rail_label}>
        {steps.map((step, i) => {
          const meta = noteStatusMeta(step);
          const state = i < at ? 'is-past' : i === at ? 'is-now' : 'is-ahead';
          return (
            <li key={step} className={`ql-step ${state} ${i <= at ? meta.tone.text : ''}`}>
              <i className={`ql-pip ${i <= at ? meta.tone.fill : ''}`} aria-hidden />
              <span>{meta.labelKey(t)}</span>
            </li>
          );
        })}
      </ol>

      <div className="ql-detail-reads">
        {summary && summary.goalsTotal > 0 && (
          <span className="typo-label text-foreground/85 inline-flex items-center gap-1.5">
            <span className="h-1 w-12 rounded-full bg-secondary/50 overflow-hidden inline-block align-middle">
              {/* Width is the DATA, so it is the one thing that cannot be a token. */}
              <span
                className={`block h-full ${noteStatusMeta(note.status).tone.fill}`}
                style={{ width: `${Math.round((done / summary.goalsTotal) * 100)}%` }}
              />
            </span>
            {tx(t.notepad.desk_goals_progress, { done, total: summary.goalsTotal })}
          </span>
        )}
        {summary && <PlanStampBadge note={note} summary={summary} />}
        {forecast && (
          <span className="typo-label text-foreground/85 inline-flex items-center gap-1">
            <CalendarClock className="w-3 h-3" aria-hidden />
            {tx(
              forecast.basis === 'cut' ? t.notepad.desk_forecast_cut : t.notepad.desk_forecast_today,
              { date: forecast.date },
            )}
          </span>
        )}
        {note.dispatchTarget && (
          <span className="typo-label text-foreground/85 inline-flex items-center gap-1">
            <Send className="w-3 h-3" aria-hidden />
            {note.dispatchTarget === 'fleet' ? t.notepad.desk_hint_publish : t.notepad.desk_hint_goals}
          </span>
        )}
      </div>

      {next && (
        <AsyncButton
          size="sm"
          variant="secondary"
          className="ml-auto shrink-0"
          isLoading={advancing}
          disabled={Boolean(next.blockedKey)}
          title={next.blockedKey ? t.notepad[next.blockedKey] : undefined}
          onClick={async () => {
            setAdvancing(true);
            try { await onAdvance(next); } finally { setAdvancing(false); }
          }}
        >
          {noteStatusMeta(next.status).labelKey(t)}
        </AsyncButton>
      )}
    </div>
  );
}

interface QuestItemProps {
  note: DevNote;
  signals: GoalSignals;
  selected: boolean;
  query: string;
  matched: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

/**
 * One goal inside a folded run — the dense form the last rungs of the fit
 * ladder reach for. The title is still whole and still carries every mark; only
 * the line break between goals is given up, and a middot takes its place.
 */
export const QuestItem = memo(function QuestItem({
  note, signals, selected, query, matched, onSelect, onOpen,
}: QuestItemProps) {
  const { t } = useTranslation();
  const waiting = signals.unread > 0;
  const searching = query.trim().length > 0;

  const cls = [
    'ql-item',
    waiting ? 'is-waiting' : '',
    signals.onRail ? '' : 'is-off',
    selected ? 'is-selected' : '',
    searching && matched ? 'is-hit' : '',
    searching && !matched ? 'is-dim' : '',
  ].filter(Boolean).join(' ');

  return (
    // A span, not a button: this sits INSIDE a flowing sentence and has to wrap
    // across lines with `box-decoration-break: clone`, which a button cannot do.
    // It therefore carries the keyboard activation a button would have given it.
    <span
      className={cls}
      data-goal-id={note.id}
      role="button"
      tabIndex={-1}
      onPointerDown={onSelect}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onSelect();
        onOpen();
      }}
    >
      {waiting && <span className="ql-bang" aria-label={t.notepad.desk_needs_you}>!</span>}
      <Title title={note.title} query={query} />
      <Marks signals={signals} />
    </span>
  );
});
