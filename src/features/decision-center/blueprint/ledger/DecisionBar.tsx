import { useMemo } from 'react';
import { useSheet } from '../controller/SheetContext';
import { isFlagged, isWaiting } from '../model/ledgerRules';
import { releaseModel } from '../model/ledgerRelease';
import { Btn } from './Controls';
import { Decide } from './Decide';
import { KeyLine } from './KeyLine';
import { LensTag } from './Marks';
import { setTab } from './ledgerStore';
import type { Ledger } from './useLedger';
import type { LedgerActs } from './useLedgerActs';
import { releaseWord } from './words';

/**
 * The decision bar under the In packs table (bp DecisionBar): what a decision acts on (the checked rows, else the
 * open item, else the focused one), its lenses, how many need a note to accept and how many are locked in a release
 * past draft, Clear (Esc), the decision controls (Decide), and the release package pill "Package v<version> · <n>"
 * whose Release opens the Release tab. With nothing to act on it shows the key reminders instead.
 */
export function DecisionBar({ L, acts }: { L: Ledger; acts: LedgerActs }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const scan = s.data.scan, n = L.selected.filter((id) => L.itemIds.has(id)).length, t = L.targets;
  const ps = useMemo(() => t.map((id) => L.byId.get(id)).filter((f) => f !== undefined), [t, L.byId]);
  const lenses = [...new Set(ps.map((f) => f.p.lens))];
  const flagged = ps.filter((f) => isWaiting(f.p) && isFlagged(f.p, L.facts.get(f.p.id)?.verdict ?? 'unmeasured')).length;
  const locked = ps.filter((f) => { const r = f.p.release_id ? scan.releases.find((x) => x.id === f.p.release_id) : undefined; return !!r && r.status !== 'draft'; }).length;
  const m = useMemo(() => releaseModel(scan, s.plan.lenses), [scan, s.plan.lenses]);
  const ver = m.rel?.version ?? m.suggestion.version;
  const first = t[0];
  const label = n ? tx(B.lg_n_selected, { n }) : first ? tx(L.ui.focus === first || L.ui.open !== first ? B.lg_one_focused : B.lg_one_open, { id: first }) : B.lg_nothing_selected;
  return (
    <div className="lg-bar tr-bar" role="region" aria-label={B.lg_decide} data-testid="blueprint-ledger-bar">
      <span className="lg-bar-n" aria-live="polite">{label}</span>
      {lenses.length ? (
        <span className="lg-bar-l">
          {lenses.map((id) => <LensTag key={id} id={id} />)}
          {flagged ? <span className="tr-warn">⚑ {tx(B.lg_need_note, { n: flagged })}</span> : null}
          {locked ? <span>{tx(B.lg_locked, { n: locked })}</span> : null}
        </span>
      ) : <span className="lg-bar-l"><KeyLine scope="packs" /></span>}
      <span className="lg-sp" />
      <Btn kbd="Esc" disabled={!n} onClick={() => s.dispatch({ type: 'selectClear' })} testId="blueprint-ledger-clear">{B.lg_clear}</Btn>
      <Decide ids={t} onMove={(move) => acts.triage(move)} />
      <span className="tr-pkg">
        <span>{B.lg_package}</span><b>{'v' + ver + ' · ' + m.items.length}</b>
        <Btn tip={B.lg_release_tip} onClick={() => setTab('release')}>{(m.rel && m.rel.status !== 'draft' ? releaseWord(B, m.rel.status) : B.lg_release) + ' →'}</Btn>
      </span>
    </div>
  );
}
