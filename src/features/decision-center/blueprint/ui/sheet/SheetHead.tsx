import { useSheet } from '../../controller/SheetContext';
import { stageWord } from '../../controller/useBlueprintText';
import { STAGE_ORDER } from '../../model/aggregates';
import { Keycap } from '../Keycap';
import { Press } from '../Press';

/** The head of the L4 sheet (bp FeatureSheet): crumbs, the detail number, the name and the stage legend. The lens tabs are SheetTabs. */
export function SheetHead({ fid }: { fid: string }) {
  const s = useSheet();
  const { B } = s.text;
  const T = s.plan.L.TILE[fid];
  if (!T) return null;
  const f = T.f;
  return (
    <div className="bp-top">
      <nav className="bp-crumbs typo-code" aria-label={B.crumbs}>
        <span>{B.level_site}</span><span aria-hidden="true">{'›'}</span>
        <span>{T.wing.def.letter} {'·'} {T.wing.def.name}</span><span aria-hidden="true">{'›'}</span>
        {T.room.d.name !== T.wing.def.name && <><span>{T.room.d.name}</span><span aria-hidden="true">{'›'}</span></>}
        <span>{T.bay.cap.code} {T.bay.cap.name}</span><span aria-hidden="true">{'›'}</span>
        <b>{f.name}</b>
        <span className="bp-grow" />
        <Press tone="bp-btn" onClick={s.nav.closeSheet}><span className="typo-body">{B.back_to_plan}</span><Keycap k="Escape" /></Press>
      </nav>
      <div className="bp-ttl">
        <div className="bp-no" aria-hidden="true"><span className="typo-code">{T.idx}</span><em className="typo-code">{T.bay.cap.code}</em></div>
        <div>
          <div className="typo-eyebrow bp-ink">{f.kind}{f.tier ? ` · ${f.tier}` : ''}</div>
          <h2 className="bp-h2 typo-heading-lg" id="bp-sheet-title">{f.name}</h2>
        </div>
        <div className="bp-legend">
          {STAGE_ORDER.map((st) => <span key={st} className={`typo-code${f.stage === st ? ' bp-on' : ''}`}><i />{stageWord(B, st).toUpperCase()}</span>)}
        </div>
      </div>
    </div>
  );
}
