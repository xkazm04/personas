import '../../styles/ledger-train.css';
import '../../styles/ledger-compare.css';
import { useMemo, useState } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { Decide } from '../../ledger/Decide';
import { Btn } from '../../ledger/Controls';
import { LensTag, StateMark, stateHint } from '../../ledger/Marks';
import type { CompareView } from '../../ledger/ledgerStore';
import { isFlagged } from '../../model/ledgerRules';
import { comparisonOf, packOrder } from '../../model/triage';
import type { TriageDecisionInput } from '../../source';
import { CompareBody } from './CompareBody';

/** What the findings ledger hands the panel: its page state, its item order (J/K) and its own verbs. */
export interface LedgerCompare {
  view: CompareView;
  wide: boolean;
  order: readonly string[];
  onView(v: CompareView): void;
  onWide(): void;
  onClose(): void;
  onGo(id: string): void;
  onMove(move: TriageDecisionInput): void;
}

/**
 * The compare panel (bp ledger train/compare/ComparePanel): one built item's evidence, docked beside the ledger's In
 * packs table (`ledger`) or in the L4 feature sheet. The head names the item (lens, id, pack and its place, feature)
 * over its title, with previous / next, Wide (the ledger only) and close; the body is CompareBody, keyed by the item;
 * the foot is the item's state over its triage note (or what the state means) and the compact triage strip. In the L4
 * sheet the screens' theme and mode are the panel's own; in the ledger they are the ledger's (they outlive the item).
 */
export function ComparePanel({ id, ledger }: { id: string; ledger?: LedgerCompare }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const [own, setOwn] = useState<CompareView>({ theme: 'light', mode: 'side' });
  const c = useMemo(() => comparisonOf(s.data.scan, s.plan, id), [s.data.scan, s.plan, id]);
  const p = s.work.byId.get(id);
  const order = useMemo(() => ledger?.order ?? packOrder(s.work, s.ui.sheetLens).map((x) => x.id), [ledger?.order, s.work, s.ui.sheetLens]);
  const at = order.indexOf(id), prev = at > 0 ? order[at - 1] : undefined, next = at >= 0 ? order[at + 1] : undefined;
  const go = (to: string | undefined, d: 1 | -1) => (!to ? undefined : ledger ? () => ledger.onGo(to) : () => s.nav.step(d));
  const close = ledger ? ledger.onClose : () => s.nav.compare(null);
  const row = c?.p;
  const mates = row?.pack_id ? order.filter((x) => s.data.scan.proposals.find((q) => q.id === x)?.pack_id === row.pack_id) : [];
  const fname = row ? s.plan.S.features.find((f) => f.slug === row.feature)?.name ?? row.feature : '';
  const move = (m: TriageDecisionInput) => { if (ledger) ledger.onMove(m); else if (p) { s.nav.select(p); s.writes.askTriage(p, m); } };
  const head = (
    <header className="tr-cmp-h">
      <div className="tt">
        <small>{row ? <><LensTag id={row.lens} /><span>{row.id}</span>{row.pack_id ? <span>{tx(B.lg_cmp_place, { pack: row.pack_id, n: mates.indexOf(row.id) + 1, of: mates.length })}</span> : null}<span>{fname}</span></> : <span>{id}</span>}</small>
        <h3 id="bp-cmp-title">{row ? row.title : B.cmp_not_found}</h3>
      </div>
      <div className="nav">
        <Btn size="nav" disabled={!prev} onClick={go(prev, -1)} label={B.cmp_prev} tip={B.lg_cmp_prev_tip} testId="blueprint-cmp-prev">↑</Btn>
        <Btn size="nav" disabled={!next} onClick={go(next, 1)} label={B.cmp_next} tip={B.lg_cmp_next_tip} testId="blueprint-cmp-next">↓</Btn>
        {ledger ? <Btn size="nav" pressed={ledger.wide} onClick={ledger.onWide} tip={B.lg_cmp_wide_tip} testId="blueprint-cmp-wide">{ledger.wide ? B.lg_cmp_narrow : B.lg_cmp_wide}</Btn> : null}
        <Btn size="nav" onClick={close} label={B.cmp_close} tip={B.lg_cmp_close_tip} testId="blueprint-cmp-close">✕</Btn>
      </div>
    </header>
  );
  if (!c || !row) return <aside className={'tr-cmp' + (ledger?.wide ? ' wide' : '')} aria-label={B.cmp_title} data-testid="blueprint-compare">{head}<div className="tr-cmp-b"><p className="tr-dim">{B.cmp_not_found}</p></div></aside>;
  const flagged = row.status === 'accepted' && isFlagged({ status: row.triaged_from ?? row.status }, c.verdict);
  return (
    <aside className={'tr-cmp' + (ledger?.wide ? ' wide' : '')} aria-labelledby="bp-cmp-title" data-testid="blueprint-compare" data-item={row.id} data-status={row.status}>
      {head}
      <CompareBody key={row.id} c={c} fname={fname} view={ledger?.view ?? own} onView={ledger?.onView ?? setOwn} wide={!!ledger?.wide} />
      <footer className="tr-cmp-d">
        <span className="st" data-testid="blueprint-cmp-state">
          <StateMark status={row.status} flagged={flagged} pending={s.ui.busy} />
          <span>{row.triage_note ? '“' + row.triage_note + '”' : stateHint(B, row.status)}{row.release_id ? ' · ' + row.release_id : ''}</span>
        </span>
        <Decide ids={[row.id]} compact onMove={move} />
      </footer>
    </aside>
  );
}
