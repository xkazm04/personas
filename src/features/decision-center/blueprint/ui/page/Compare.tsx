// PORTED from bp apps/web/src/components/page/Compare.tsx @ 93f30b0: the feature page's "Changed between A and B"
// while the plan compares two dates (A pinned, B the travelled date or now): both values with the day each was read,
// first observations labelled as such, the stage on each date, a replayed health move.
// EDIT (port): the comparison is the sheet's (`sync.comparison`, controller/useSyncModels), not the engine's; the lines
// are WP1's structured compareLines turned into t.* by controller/compareWords. A feature with no entry shows NOTHING
// here (bp says "Nothing recorded changed on this feature"): the WP3 brief keeps the page quiet when nothing changed.
// "Stop comparing" names P, the key that unpins A here (bp: A).
import { useSheet } from '../../controller/SheetContext';
import { compareLineText, endpointText } from '../../controller/compareWords';
import { compareLines, endpoint } from '../../model/compare';
import { Press } from '../Press';

export function CompareSection({ fid }: { fid: string }) {
  const s = useSheet(), text = s.text, { B, tx } = text, c = s.sync.comparison, asOf = s.plan.S.asOf;
  const e = c?.byId.get(fid);
  if (!c || !e) return null;
  const A = endpointText(text, endpoint(c.a, asOf)), Bw = endpointText(text, endpoint(c.b, asOf));
  const head = tx(B.sync_cmp_head, { dateA: A, dateB: Bw });
  return (
    <div className="pg-dcmp" role="group" aria-label={head} data-testid="blueprint-page-compare">
      <h4 className="pg-h">{head}</h4>
      <ul>{compareLines(e, c.a, c.b, asOf).map((l, i) => <li key={i} className={l.kind}>{compareLineText(text, s.plan.LENS, l)}</li>)}</ul>
      <Press tone="btn" onClick={s.sync.unpinA}>{B.sync_cmp_stop}</Press>
    </div>
  );
}
