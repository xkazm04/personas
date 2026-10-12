/**
 * DeckDispatchModal — the surface a batch of accepted ideas is actually sent
 * from.
 *
 * The rail's bar is `clamp(18rem, …, 36rem)` wide and could only ever offer a
 * count, three mode pills and a stepper. Three problems with that, and the
 * operator named the first two:
 *
 *  1. A reviewer about to spend real money and real wall-clock saw a NUMBER,
 *     never the work. This is the last place they can look at what they said
 *     yes to, so the left half is the ideas themselves, readable.
 *  2. There was nowhere to say WHICH strand a piece of work goes down. The
 *     right half is the lanes, as columns.
 *  3. The three modes were a vocabulary (`single` / `batch` / `parallel`) for
 *     one number, and all three produced identical behaviour because the
 *     executor ignored the number. The executor honours it now; the modes are
 *     gone and the lane COUNT is the only control.
 *
 * **An unassigned idea is legal and common** and the modal says so rather
 * than leaving it to be discovered: it goes into one shared pool and runs on
 * whichever lane frees up first. Pinning is for the cases where order matters
 * (two ideas touching the same file, a migration before what reads it); the
 * default is to let the pool sort it out.
 */
import { useMemo, useState } from 'react';

import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { BaseModal } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';
import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';

import { DeckLaneBoard, DRAG_TYPE } from './DeckLaneBoard';
import type { AcceptedDispatch } from './useAcceptedDispatch';

const TITLE_ID = 'deck-dispatch-modal-title';

/** The lane an idea is pinned to, as the select's value. `''` is unpinned —
 *  a select cannot hold `undefined` and `-1` would be a magic number on the
 *  wire of a control a human reads. */
const UNPINNED = '';

export function DeckDispatchModal({
  ctl,
  onClose,
}: {
  ctl: AcceptedDispatch;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const [sending, setSending] = useState(false);

  const picked = useMemo(
    () => ctl.rows.filter((row) => ctl.selected.has(row.id)),
    [ctl.rows, ctl.selected],
  );

  const laneOptions = useMemo(
    () => [
      { value: UNPINNED, label: m.triage_dispatch_unassigned },
      ...Array.from({ length: ctl.lanes }, (_, lane) => ({
        value: String(lane),
        label: tx(m.triage_dispatch_lane_name, { n: lane + 1 }),
      })),
    ],
    [ctl.lanes, m, tx],
  );

  return (
    <BaseModal
      isOpen
      onClose={sending ? () => {} : onClose}
      titleId={TITLE_ID}
      size="xl"
      staggerChildren={false}
      panelClassName="flex max-h-[80vh] flex-col"
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h2 id={TITLE_ID} className="typo-title">
          {m.triage_dispatch_title}
        </h2>
        <p className="typo-caption">
          {tx(m.triage_dispatch_subtitle, { count: picked.length })}
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 md:grid-cols-2">
        <section className="flex min-h-0 flex-col gap-2" aria-label={m.triage_dispatch_work_heading}>
          <span className="typo-label text-foreground">{m.triage_dispatch_work_heading}</span>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {picked.map((row) => (
              <WorkRow
                key={row.id}
                row={row}
                lane={ctl.assignments.get(row.id)}
                options={laneOptions}
                onAssign={ctl.assign}
                disabled={sending}
              />
            ))}
          </ul>
        </section>

        <DeckLaneBoard
          lanes={ctl.lanes}
          setLanes={ctl.setLanes}
          picked={picked}
          assignments={ctl.assignments}
          assign={ctl.assign}
          disabled={sending}
        />
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
        <p className="typo-caption min-w-0 flex-1">{m.triage_dispatch_unassigned_note}</p>
        <Button variant="ghost" disabled={sending} onClick={onClose}>
          {t.common.cancel}
        </Button>
        <AsyncButton
          variant="primary"
          disabled={picked.length === 0}
          onClick={async () => {
            setSending(true);
            try {
              await ctl.dispatch();
              onClose();
            } finally {
              setSending(false);
            }
          }}
        >
          {tx(m.triage_dispatch_confirm, { count: picked.length })}
        </AsyncButton>
      </footer>
    </BaseModal>
  );
}

function WorkRow({
  row,
  lane,
  options,
  onAssign,
  disabled,
}: {
  row: UndispatchedIdea;
  lane: number | undefined;
  options: { value: string; label: string }[];
  onAssign: (id: string, lane: number | null) => void;
  disabled: boolean;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;

  return (
    <li
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, row.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="flex items-center gap-2 rounded-card border border-border bg-secondary/20 px-2 py-1.5"
    >
      <div className="min-w-0 flex-1">
        <p className="typo-body truncate text-foreground">{row.title}</p>
        <p className="typo-caption truncate">
          {row.projectName ?? m.triage_rail_group_none}
        </p>
      </div>
      <ThemedSelect
        filterable
        hideSearch
        options={options}
        value={lane === undefined ? UNPINNED : String(lane)}
        onValueChange={(value) => onAssign(row.id, value === UNPINNED ? null : Number(value))}
        disabled={disabled}
        aria-label={tx(m.triage_dispatch_assign_aria, { title: row.title })}
        wrapperClassName="w-[9.5rem] shrink-0"
      />
    </li>
  );
}
