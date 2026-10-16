import type { Proposal } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import { byLens, isConflict, moveOf, type PkgItem, type ReleaseModel } from '../../model/ledgerRelease';
import { Btn, Callout, Lnk } from '../Controls';
import { LensTag, verdictWord } from '../Marks';
import { setLedger, setTab } from '../ledgerStore';
import type { BpOpen } from '../useBpOpen';

/** Open an item's evidence in the triage table's compare panel. */
const compare = (id: string) => { setLedger((u) => ({ ...u, open: id, focus: id, scope: 'packs' })); setTab('triage'); };

function PkgRow({ x, bp }: { x: PkgItem; bp: BpOpen }) {
  const { B, tx } = useSheet().text;
  const p = x.p, why = p.triaged_from === 'failed' ? B.lg_failed_word : verdictWord(B, x.verdict);
  const flag = x.flagged ? ' · ⚑ ' + tx(B.lg_accepted_why, { why }) + (p.triage_note ? ': “' + p.triage_note + '”' : '') : '';
  return (
    <li data-fid={p.id}>
      <span className="sha">{p.commit_sha ? p.commit_sha.slice(0, 7) : B.lg_no_sha}</span>
      <span className="t">{p.title}<small className={x.flagged ? 'fl' : undefined}>{p.feature} · {p.metric ? p.metric + ' ' : ''}{moveOf(x) ?? B.lg_vd_unmeasured}{flag}</small></span>
      <Btn size="row" onClick={() => compare(p.id)}>{B.lg_compare}</Btn>
      <Btn size="row" tip={B.lg_undo_in_bp} onClick={bp.openRelease} disabled={!bp.releaseUrl}>{B.verb_reopen + ' ↗'}</Btn>
    </li>
  );
}

function NoteRow({ p, struck, bp }: { p: Proposal; struck?: boolean; bp: BpOpen }) {
  const { B } = useSheet().text;
  const note = p.triage_note ?? '';
  return (
    <li data-fid={p.id}>
      <span><LensTag id={p.lens} /></span>
      <span className="t">{struck ? <s>{p.title}</s> : p.title}
        <small className={isConflict(p) ? 'warn' : undefined}>{isConflict(p) ? '⚠ ' : ''}{note ? '“' + note + '”' : B.lg_no_note}</small>
      </span>
      <span />
      <Btn size="row" tip={B.lg_undo_in_bp} onClick={bp.openRelease} disabled={!bp.releaseUrl}>{B.verb_reopen + ' ↗'}</Btn>
    </li>
  );
}

/**
 * The Release tab's package (bp Package): the accepted items with no release (or the open release's items) grouped by
 * lens, each its commit, title, feature and before -> after (a flagged one with its note); then the rework queue and
 * the descoped with their notes. Compare opens the item in the triage table; Undo opens bp, where releases are driven.
 */
export function Package({ m, bp }: { m: ReleaseModel; bp: BpOpen }) {
  const { B, tx } = useSheet().text;
  return (
    <div className="tr-rel-pkg" data-testid="blueprint-ledger-package">
      {m.items.length ? (
        <ul className="tr-pl">
          {byLens(m.items).map(([lens, xs]) => [
            <li key={'g:' + lens} className="lgrp"><LensTag id={lens} full /> · {xs.length}</li>,
            ...xs.map((x) => <PkgRow key={x.p.id} x={x} bp={bp} />),
          ])}
        </ul>
      ) : (
        <Callout tone="empty">{m.rel ? B.lg_rel_left : B.lg_rel_nothing} <Lnk onClick={() => { setLedger((u) => ({ ...u, scope: 'packs' })); setTab('triage'); }}>{B.lg_rel_to_triage}</Lnk></Callout>
      )}
      {m.rel && m.free ? <p className="tr-rel-hint">{tx(B.lg_rel_wait_next, { n: m.free, v: m.rel.version })}</p> : null}
      <h3>{tx(B.lg_rel_rework, { n: m.rework.length })}</h3>
      {m.rework.length ? <ul className="tr-pl">{m.rework.map((p) => <NoteRow key={p.id} p={p} bp={bp} />)}</ul> : <p className="tr-rel-none">{B.lg_rel_rework_none}</p>}
      <h3>{tx(B.lg_rel_descoped, { n: m.descoped.length })}</h3>
      {m.descoped.length ? <ul className="tr-pl">{m.descoped.map((p) => <NoteRow key={p.id} p={p} struck bp={bp} />)}</ul> : <p className="tr-rel-none">{B.lg_rel_descoped_none}</p>}
    </div>
  );
}
