import { memo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { noteStatusMeta } from '../../noteStatusMeta';
import { splitHighlight } from '../deskModel';
import { goalFraction, journeyOf } from './journey';
import { dotsFor, type GoalRowProps } from './goalRowModel';

/**
 * LEDGER — the desk as a ruled book.
 *
 * The bet: a goal is an ENTRY, and entries are read down a margin. There is no
 * box, no fill and no badge; the row is a line of type with a ruled margin, and
 * every state is a mark IN that margin rather than decoration around the text.
 * Selection thickens the rule instead of painting the row, so the eye tracks a
 * single moving edge down the column.
 *
 * The expansion continues the same rule: one hairline beneath the title,
 * carrying the journey as ticks and the sub-goal progress as ink laid along it.
 * Nothing in it is a word — the marks are the reading.
 */
export const GoalRow = memo(function GoalRow({
  note, signals, wired, rail, selected, query, matched, detail, onSelect, onOpen, onContextMenu,
}: GoalRowProps) {
  const { t, tx } = useTranslation();
  const meta = noteStatusMeta(note.status);
  const waiting = signals.unread > 0;
  const searching = query.trim().length > 0;
  const hit = searching ? splitHighlight(note.title, query) : null;
  const unread = dotsFor(signals.unread);

  return (
    <div
      className="rw rw-ledger"
      data-goal-id={note.id}
      data-state={selected ? 'selected' : waiting ? 'waiting' : undefined}
      data-rail={rail}
      onContextMenu={(e) => { onSelect(); onContextMenu(e); }}
    >
      <button
        type="button"
        className={`rw-line ${meta.tone.text}${signals.onRail ? '' : ' is-off'}${searching && !matched ? ' is-dim' : ''}${searching && matched ? ' is-hit' : ''}`}
        aria-current={selected ? 'true' : undefined}
        onPointerDown={onSelect}
        onClick={onOpen}
      >
        {/* The margin. One rule, one mark — this is the whole vocabulary. */}
        <span className="rw-margin" aria-hidden>
          <i className="rw-rule" />
          {wired ? <i className="rw-cont" /> : <meta.Icon />}
        </span>
        <span className="rw-body">
          <span className="rw-title">
            {hit ? (<>{hit.pre}<mark>{hit.hit}</mark>{hit.post}</>) : note.title}
          </span>
          <span className="rw-marks">
            {waiting && (
              <span className="rw-mk rw-wait" title={t.notepad.desk_needs_you} aria-label={t.notepad.desk_needs_you}>
                {unread.overflow ? unread.overflow : Array.from({ length: unread.dots }, (_, i) => <i key={i} />)}
              </span>
            )}
            {signals.workingSince && (
              <span className="rw-mk rw-work" aria-label={t.notepad.status_in_progress}><i /></span>
            )}
            {signals.lateDays > 0 && (
              <span
                className="rw-mk rw-late"
                aria-label={tx(t.notepad.desk_days_late, { count: signals.lateDays })}
                title={tx(t.notepad.desk_days_late, { count: signals.lateDays })}
              >
                <i />
              </span>
            )}
          </span>
        </span>
      </button>

      {detail && <GoalRowDetail note={note} detail={detail} />}
    </div>
  );
});

function GoalRowDetail({ note, detail }: { note: GoalRowProps['note']; detail: NonNullable<GoalRowProps['detail']> }) {
  const { t, tx } = useTranslation();
  const { steps, at } = journeyOf(note);
  const frac = goalFraction(detail.summary?.goalsTotal, detail.summary?.goalsDone);

  return (
    <div className="rw-detail rw-ledger-detail">
      {/* The rule continues, and the journey is ruled ONTO it: ticks for the
          steps, ink for how far the sub-goals have run. */}
      <ol className="rw-ticks" aria-label={t.notepad.rail_label}>
        {steps.map((step, i) => {
          const m = noteStatusMeta(step);
          return (
            <li
              key={step}
              className={`rw-tick ${i < at ? 'is-past' : i === at ? 'is-now' : 'is-ahead'} ${i <= at ? m.tone.text : ''}`}
              aria-current={i === at ? 'step' : undefined}
              title={m.labelKey(t)}
            >
              <i />
              <span className="sr-only">{m.labelKey(t)}</span>
            </li>
          );
        })}
      </ol>
      {frac !== null && detail.summary && (
        <span
          className="rw-ink"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={detail.summary.goalsTotal}
          aria-valuenow={detail.summary.goalsDone}
          aria-label={tx(t.notepad.desk_goals_progress, {
            done: detail.summary.goalsDone,
            total: detail.summary.goalsTotal,
          })}
        >
          {/* Width is the DATA, so it is the one thing that cannot be a token. */}
          <i className={noteStatusMeta(note.status).tone.fill} style={{ width: `${Math.round(frac * 100)}%` }} />
        </span>
      )}
    </div>
  );
}
