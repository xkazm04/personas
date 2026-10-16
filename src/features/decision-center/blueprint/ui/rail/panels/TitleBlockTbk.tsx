// The drawing's title block (PORTED from bp src/components/rail/panels.tsx TitleBlock, `.tbk`): the project, the sheet
// number and its place in the set, the date drawn and the sheet's title, and the schedule: how many features stand in
// each stage on that date, how many are in trouble now and how many changed in the View's window.
// EDIT (port): bp's "rev n/27" and its sample-data disclaimer are not brought (the live revision count is the
// timeline's, and nothing here is simulated).
import { useMemo } from 'react';
import { useSheet } from '../../../controller/SheetContext';
import { countsAt, deltaWin, stageOfAt } from '../../../engine/travel';
import type { Stage } from '../../../standard/load';
import { HealthSpecimen, StageSwatch } from '../../legend/Specimens';
import { sheetNumber } from '../../header/ProjLine';
import { DeltaMark } from '../../legend/Symbols';

export function TitleBlockTbk() {
  const s = useSheet();
  const { B, tx } = s.text;
  const S = s.plan.S, day = s.ui.asOf ?? S.asOf, now = day >= S.asOf;
  const L = s.ui.lens === 'general' ? null : s.plan.LENS[s.ui.lens] ?? null;
  const sheets = 1 + s.plan.lenses.length, at = L ? 2 + s.plan.lenses.indexOf(L) : 1;
  const { c, bad, chg } = useMemo(() => {
    const c = countsAt(S.features, (f) => stageOfAt(f, s.ui.asOf, S.asOf));
    return { c, bad: S.features.filter((f) => f.health === 'bad').length, chg: S.features.filter((f) => deltaWin(f, day, s.ui.viewDays)).length };
  }, [S, s.ui.asOf, s.ui.viewDays, day]);
  const row = (st: Stage, label: string, n: number) => <tr><td className="sy"><StageSwatch st={st} w={18} h={11} /></td><td>{label}</td><td className="n">{s.words.num(n)}</td></tr>;
  return (
    <div className="tbk" data-testid="blueprint-tbk">
      <div className="proj"><div className="v">{s.data.product.name.toUpperCase()}</div><span className="lab">{B.tbk_project}</span></div>
      <div className="sheet"><span className="lab">{B.sheet}</span><span className="no">{sheetNumber(L ? L.short : null)}</span><span className="of">{tx(B.tbk_of, { n: at, of: sheets })}</span></div>
      <div className="ttl"><span className="lab">{day}</span><div className="v">{L ? L.name : B.general_arrangement}</div></div>
      <div className="schedT"><span className="lab">{tx(B.tbk_schedule, { count: S.features.length - c.none })}</span>
        <table><tbody>
          {row('live', B.tbk_live, c.live)}
          {row('flagged', B.tbk_flagged, c.flagged)}
          {row('in-dev', B.tbk_build, c.build)}
          {row('specified', B.tbk_paper, c.paper)}
          {c.dep ? row('deprecated', B.tbk_retired, c.dep) : null}
          <tr className="tr"><td className="sy"><HealthSpecimen k="cloud" /></td><td>{B.tbk_trouble}</td><td className="n">{now ? s.words.num(bad) : '-'}</td></tr>
          <tr><td className="sy"><DeltaMark /></td><td>{tx(B.tbk_changed, { days: s.ui.viewDays })}</td><td className="n">{s.words.num(chg)}</td></tr>
        </tbody></table></div>
    </div>
  );
}
