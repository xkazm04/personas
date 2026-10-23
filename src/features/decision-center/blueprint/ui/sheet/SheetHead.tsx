import type { ReactNode, Ref } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { capOf } from '../../model/keymap';
import { AsOfBar, StageLadder } from '../page/bits';
import { kindWord } from '../format';
import { Press } from '../Press';

/**
 * The sticky head of the L4 page (bp FeatureSheet Head): the crumbs (each goes back to that level), Back to plan, the
 * 68 px detail bubble (detail number over the feature code), the kicker (priority, kind, milestone), the 34 px name,
 * the stage ladder, the as-of marker on a past date, and the tab strip (SheetPage's, passed in). bp's Blast radius control stays out
 * (operator: outside the brief).
 */
export function SheetHead({ fid, closeRef, tabs }: { fid: string; closeRef?: Ref<HTMLButtonElement>; tabs: ReactNode }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const T = s.plan.L.TILE[fid];
  if (!T) return null;
  const f = T.f;
  const ms = f.milestone ? s.plan.S.milestones.find((m) => m.id === f.milestone) : undefined;
  const kicker = [f.priority, f.kind ? kindWord(B, f.kind) : null, ms ? (ms.code ? ms.code + ' ' : '') + ms.name : null].filter(Boolean).join(' · ') || B.pg_kind_default;
  const crumb = (n: number, label: string) => <span key={n}><i aria-hidden="true">{'›'}</i><Press onClick={() => s.nav.toLevel(n)}>{label}</Press></span>;
  return (
    <header className="pg-head">
      <div className="pg-bar">
        <nav className="pg-crumbs" aria-label={B.crumbs}>
          <Press onClick={() => s.nav.toLevel(0)}>{B.level_site}</Press>
          {crumb(1, tx(B.pg_crumb_wing, { letter: T.wing.def.letter, name: T.wing.def.name }))}
          {T.room.d.name !== T.wing.def.name ? crumb(2, T.room.d.name) : null}
          {crumb(3, T.bay.cap.name)}
          <span><i aria-hidden="true">{'›'}</i><b aria-current="page">{f.name}</b></span>
        </nav>
        <div className="pg-acts">
          <Press tone="btn" ref={closeRef} onClick={s.nav.closeSheet} data-testid="blueprint-page-back">{tx(B.pg_back, { key: capOf('Escape') })}</Press>
        </div>
      </div>
      <div className="pg-title">
        <div className="bubble" aria-hidden="true"><span className="a">{T.idx}</span><span className="b">{f.code || T.bay.cap.code || '—'}</span></div>
        <div className="tt">
          <div className="k">{kicker}</div>
          <h2 id="bp-sheet-title">{f.name}</h2>
        </div>
        <StageLadder f={f} />
      </div>
      <AsOfBar />
      {tabs}
    </header>
  );
}
