import { memo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { noteStatusMeta } from '../../../noteStatusMeta';
import { splitHighlight } from '../../deskModel';
import { goalFraction, journeyOf } from './journey';
import { dotsFor, type RowViewProps } from './types';

/**
 * CIRCUIT — the desk as a board, and the wire is the idea.
 *
 * The bet: the journal already draws a wire down a run of one status; take that
 * literally and the whole row becomes a trace. A goal is a component ON the
 * trace, its state is the node's shape, and a run is one unbroken line rather
 * than repeated icons. Selection energises the trace — the line lights from the
 * node outward — so movement reads as current flowing, not as a box moving.
 *
 * The expansion branches OFF the trace: the journey is a track of nodes wired
 * in series, the sub-goals are a segmented bus under it, and everything else is
 * a terminal on the end. It is the same drawing at a different scale, which is
 * the point of designing the row and its expansion together.
 */
export const RowCircuit = memo(function RowCircuit({
  note, signals, wired, rail, selected, query, matched, detail, onSelect, onOpen, onContextMenu,
}: RowViewProps) {
  const { t, tx } = useTranslation();
  const meta = noteStatusMeta(note.status);
  const waiting = signals.unread > 0;
  const searching = query.trim().length > 0;
  const hit = searching ? splitHighlight(note.title, query) : null;
  const unread = dotsFor(signals.unread);

  return (
    <div
      className="rw rw-circuit"
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
        <span className="rw-trace" aria-hidden>
          <i className="rw-wire-in" />
          {/* A wired goal is a junction on the run, not a repeat of its icon. */}
          {wired ? <i className="rw-node rw-node-sm" /> : <i className="rw-node"><meta.Icon /></i>}
          <i className="rw-wire-out" />
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
            {signals.workingSince && <span className="rw-mk rw-work" aria-label={t.notepad.status_in_progress}><i /></span>}
            {signals.lateDays > 0 && (
              <span
                className="rw-mk rw-late"
                aria-label={tx(t.notepad.desk_days_late, { count: signals.lateDays })}
                title={tx(t.notepad.desk_days_late, { count: signals.lateDays })}
              ><i /></span>
            )}
          </span>
        </span>
      </button>

      {detail && <CircuitDetail note={note} detail={detail} />}
    </div>
  );
});

function CircuitDetail({ note, detail }: { note: RowViewProps['note']; detail: NonNullable<RowViewProps['detail']> }) {
  const { t, tx } = useTranslation();
  const { steps, at } = journeyOf(note);
  const frac = goalFraction(detail.summary?.goalsTotal, detail.summary?.goalsDone);
  const total = detail.summary?.goalsTotal ?? 0;
  const done = detail.summary?.goalsDone ?? 0;

  return (
    <div className="rw-detail rw-circuit-detail">
      <i className="rw-branch" aria-hidden />
      <ol className="rw-track" aria-label={t.notepad.rail_label}>
        {steps.map((step, i) => {
          const m = noteStatusMeta(step);
          return (
            <li
              key={step}
              className={`rw-stop ${i < at ? 'is-past' : i === at ? 'is-now' : 'is-ahead'} ${i <= at ? m.tone.text : ''}`}
              aria-current={i === at ? 'step' : undefined}
              title={m.labelKey(t)}
            >
              <i className="rw-stop-dot" />
              <span className="sr-only">{m.labelKey(t)}</span>
            </li>
          );
        })}
      </ol>
      {frac !== null && total > 0 && (
        <span
          className="rw-bus"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label={tx(t.notepad.desk_goals_progress, { done, total })}
        >
          {/* One cell per sub-goal while they are countable by eye; past that a
              bar is the honest rendering, because 14 cells is not a count. */}
          {total <= 8
            ? Array.from({ length: total }, (_, i) => (
              <i key={i} className={i < done ? noteStatusMeta(note.status).tone.fill : undefined} />
            ))
            : <i className={`rw-bus-bar ${noteStatusMeta(note.status).tone.fill}`} style={{ width: `${Math.round(frac * 100)}%` }} />}
        </span>
      )}
      {note.dispatchTarget && (
        <i
          className="rw-terminal"
          aria-label={note.dispatchTarget === 'fleet' ? t.notepad.desk_hint_publish : t.notepad.desk_hint_goals}
          title={note.dispatchTarget === 'fleet' ? t.notepad.desk_hint_publish : t.notepad.desk_hint_goals}
        />
      )}
    </div>
  );
}
