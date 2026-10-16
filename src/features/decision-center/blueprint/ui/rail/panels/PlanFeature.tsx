// The Plan workbench's feature detail (PORTED from bp src/components/rail/wide/plan.tsx FeatureDetail): where it is,
// its stage and general health, the work waiting on it, open it or show it on the plan, and every lens's health with
// the rule's reason.
// EDIT (port): bp's "agents on it" and "questions on it" come from its simulated swarm; here the figures are the store's
// work on the feature (waiting, approved), and the open goes to the L4 sheet, where the work is decided.
import { useSheet } from '../../../controller/SheetContext';
import { stageWord, verdictWord } from '../../../controller/useBlueprintText';
import type { Feature } from '../../../standard/load';
import { StageSwatch } from '../../legend/Specimens';
import { LensGlyphIcon } from '../../LensGlyphIcon';
import { Press } from '../../Press';
import { Sec } from './shell';

export function PlanFeature({ f }: { f: Feature }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const T = s.plan.L.TILE[f.id];
  const work = s.work.byFeature.get(f.id) ?? [];
  const waiting = work.filter((p) => p.status === 'proposed').length, approved = work.filter((p) => p.status === 'approved').length;
  const why = new Map(f.trouble.map((t) => [t.lens, t.why]));
  const tone = f.health === 'bad' ? ' t-red' : f.health === 'watch' ? ' t-amber' : '';
  const open = () => { s.dispatch({ type: 'flyout', id: null }); s.nav.openSheet(f.id); };
  const show = () => { s.dispatch({ type: 'flyout', id: null }); s.nav.flyToFeature(f.id); };
  return (
    <>
      <div className="wb-kick">{f.code && <span>{f.code}</span>}<span>{T ? T.wing.def.name + ' · ' + T.room.d.name : f.domain}</span>{T && <span>{T.bay.cap.name}</span>}</div>
      <h3 className="wb-title wb-glyph"><StageSwatch st={f.stage} w={30} h={19} />{f.name}</h3>
      {f.summary && <p className="wb-lede">{f.summary}</p>}
      <div className="wb-figs">
        <div className="wb-fig"><b className="wd">{f.stage ? stageWord(B, f.stage) : B.not_drawn}</b><span>{f.stageSince ? tx(B.plan_stage_since, { date: f.stageSince }) : B.stage}</span></div>
        <div className={'wb-fig' + tone}><b className="wd">{verdictWord(B, f.health)}</b><span>{B.plan_general_health}</span></div>
        <div className={'wb-fig' + (waiting ? ' t-amber' : '')}><b>{waiting}</b><span>{B.plan_f_waiting}</span></div>
        <div className={'wb-fig' + (approved ? ' t-mint' : '')}><b>{approved}</b><span>{B.plan_f_approved}</span></div>
      </div>
      <div className="wb-inline">
        <Press tone="bt go" onClick={open}>{B.plan_open}</Press>
        <Press tone="bt" onClick={show}>{B.plan_show}</Press>
        {f.priority && <span className="wb-meta">{tx(B.plan_priority, { p: f.priority })}</span>}
      </div>
      <Sec head={B.plan_by_lens} aside={B.now}>
        <table className="wb-lt">
          <tbody>
            {s.plan.lenses.map((d) => {
              const fl = f.lens[d.id], h = fl?.h ?? 'unmeasured';
              return (
                <tr key={d.id} className={'h-' + h}>
                  <th scope="row"><LensGlyphIcon glyph={d.glyph} /><b>{d.short}</b>{d.name}</th>
                  <td className="hw">{verdictWord(B, h)}</td>
                  <td className="why">{why.get(d.id) ?? fl?.why ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Sec>
    </>
  );
}
