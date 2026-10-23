// What a feature leans on and what leans on it, and its recent activity (bp sheet/SheetBody.tsx FeatureLinks, Activity;
// page/General.tsx Dependencies). A linked feature opens its own page. bp's blast radius stays out (operator: outside
// the brief), so the Used-by list carries no blast count and no plan overlay.
import { useMemo } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { stageWord } from '../../controller/useBlueprintText';
import type { Feature } from '../../standard/load';
import { Press } from '../Press';
import { usePerson } from './Record';
import { dayFmt } from './values';

function FeatureLinks({ ids, empty }: { ids: readonly string[]; empty: string }) {
  const s = useSheet(), { B } = s.text;
  const shown = ids.filter((id) => s.plan.L.TILE[id]);
  if (!shown.length) return <p className="none">{empty}</p>;
  return (
    <>
      {shown.map((id) => {
        const g = s.plan.L.TILE[id]!.f;
        return <Press key={id} onClick={() => s.nav.openSheet(id)}><span>{g.name}</span><span className="w">{g.stage ? stageWord(B, g.stage) : B.pg_unknown}</span></Press>;
      })}
    </>
  );
}

export function Dependencies({ f }: { f: Feature }) {
  const { B, tx } = useSheet().text;
  return (
    <>
      <div className="dl"><h4>{tx(B.pg_depends_on, { count: f.dependsOn.length })}</h4><FeatureLinks ids={f.dependsOn} empty={B.pg_stands_alone} /></div>
      <div className="dl"><h4>{tx(B.pg_used_by, { count: f.usedBy.length })}</h4><FeatureLinks ids={f.usedBy} empty={B.pg_no_dependents} /></div>
    </>
  );
}

/** The latest activity on it (at most 8 events, newest first); the heading states the window really shown. */
export function Activity({ f }: { f: Feature }) {
  const s = useSheet(), { B, tx, language } = s.text, person = usePerson();
  const all = useMemo(() => s.plan.S.activity.filter((a) => a.feature === f.id).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)), [s.plan, f.id]);
  const acts = all.slice(0, 8), last = acts[acts.length - 1];
  const time = (at: string) => { const t = Date.parse(at); return Number.isNaN(t) ? at : new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(t); };
  const head = !last ? tx(B.pg_activity_n, { count: 0 })
    : all.length > acts.length ? tx(B.pg_activity_some, { shown: acts.length, count: all.length, date: dayFmt(language, last.at) })
    : tx(B.pg_activity_all, { count: all.length, date: dayFmt(language, last.at) });
  return (
    <>
      <h4>{head}</h4>
      {acts.length ? (
        <ul className="acts">
          {acts.map((a, i) => (
            <li key={a.at + i} className={a.type === 'incident' ? 'inc' : ''}>
              <span className="m">{time(a.at)}</span>
              <span>{person(a.actor).name}</span>
              <span>{a.text}{a.severity ? ' · ' + a.severity : ''}</span>
            </li>
          ))}
        </ul>
      ) : <p className="none">{B.pg_quiet}</p>}
    </>
  );
}
