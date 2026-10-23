import { memo } from 'react';
import type { Proposal } from '@/lib/lensScan/wire';
import { useSheet } from '../controller/SheetContext';
import type { ItemFacts } from '../model/ledgerFacts';
import { LensTag, MetricMove, StateMark, VerdictChip } from './Marks';

export interface ItemRowProps {
  p: Proposal;
  fname: string;
  facts: ItemFacts | undefined;
  sel: boolean;
  /** The keyboard focus (J/K): the ring, and the row Tab lands on. */
  focus: boolean;
  /** Shown in the compare panel. */
  open: boolean;
  /** A decision on it is on its way to the store. */
  pending: boolean;
  onCheck(id: string): void;
  onFocus(id: string): void;
  onOpen(id: string): void;
}

/** Evidence at a glance: screens (or a performance item's runs) and the commit; a missing one is dimmed. */
function Evidence({ p, x }: { p: Proposal; x: ItemFacts | undefined }) {
  const { B, tx } = useSheet().text;
  const shots = x?.shots ?? 0, runs = x?.runs ?? 0;
  return (
    <span className="tr-ev">
      {runs > 1
        ? <span aria-label={tx(B.lg_ev_runs_label, { runs, after: x?.afters ?? 0 })}>⧗ {tx(B.lg_ev_runs, { runs, after: x?.afters ?? 0 })}</span>
        : <span className={shots ? undefined : 'no'} aria-label={shots ? tx(B.lg_ev_shots_label, { n: shots }) : B.lg_ev_no_shots}>▣ {shots || '–'}</span>}
      <span className={p.commit_sha ? undefined : 'no'} aria-label={p.commit_sha ? tx(B.lg_ev_commit_label, { sha: p.commit_sha.slice(0, 7) }) : B.lg_ev_no_commit}>± {p.commit_sha ? 1 : '–'}</span>
    </span>
  );
}

/**
 * One built item of a pack in the In packs table (bp ItemRow): checkbox, lens, feature with the item id (and its
 * attempt), title with the triage note, before -> after with the metric key, the verdict, evidence and the state. The
 * focused row wears a ring, the open row a stronger tint, the checked row the accent bar. A click opens it in the
 * compare panel; the checkbox checks it into the sheet's shared selection.
 */
export const ItemRow = memo(function ItemRow({ p, fname, facts: x, sel, focus, open, pending, onCheck, onFocus, onOpen }: ItemRowProps) {
  const { B, tx } = useSheet().text;
  const note = p.triage_note;
  return (
    <div role="row" className={'tr-row s-' + p.status + (sel ? ' tr-sel' : '') + (focus ? ' tr-fx' : '') + (open ? ' tr-open' : '')} aria-selected={sel}
      data-fid={p.id} data-testid="blueprint-ledger-row" tabIndex={focus ? 0 : -1}
      onFocus={(e) => { if (e.target === e.currentTarget) onFocus(p.id); }}
      onClick={(e) => { if ((e.target as HTMLElement).closest('input')) return; onOpen(p.id); }}>
      <span role="cell" className="c-sel"><input type="checkbox" tabIndex={-1} checked={sel} onChange={() => { onFocus(p.id); onCheck(p.id); }} aria-label={tx(B.lg_check_item, { id: p.id })} /></span>
      <span role="cell" className="c-lens"><LensTag id={p.lens} /></span>
      <span role="cell" className="c-feat">{fname}<small>{p.id}{x && x.attempt > 1 ? ' · ' + tx(B.lg_attempt, { n: x.attempt, of: x.prev ?? '' }) : ''}</small></span>
      <span role="cell" className="c-title">
        <span>{p.title}</span>
        {note ? <small className={p.status === 'accepted' && !x?.flagged ? 'dn' : undefined}>“{note}”</small>
          : x?.prevNote ? <small>↺ {tx(B.lg_from_attempt, { n: x.attempt - 1, note: x.prevNote })}</small> : null}
      </span>
      <MetricMove cell before={x?.before} after={x?.after} unit={x?.unit} metric={p.metric} />
      <span role="cell" className="c-vd">{x ? <VerdictChip verdict={x.verdict} failed={x.failed} /> : null}</span>
      <span role="cell" className="c-ev"><Evidence p={p} x={x} /></span>
      <span role="cell" className="c-st"><StateMark status={p.status} flagged={!!x?.flagged} pending={pending} /></span>
    </div>
  );
});
