// One lens's tab on the feature page (bp page/LensTab.tsx): that lens only, laid out for its reader, from the manifest.
// The hero (headline, health, reason), the evidence cards and the rest (Hero.tsx), the metric rows (Metrics.tsx), the
// KPIs bound to it, the work under this lens (the Personas proposals with their controls, in bp's "questions and
// orders" place), the Screens strip for a lens that measures through the harness, and Business for a lens whose
// reader is business. Blocks are chosen by data, never by lens id.
import { useSheet } from '../../controller/SheetContext';
import type { Feature } from '../../standard/load';
import { useAsOf } from './bits';
import { BusinessSection, hasBusiness } from './Business';
import { Body } from './Hero';
import { KpiRows } from './KpiRows';
import { Metrics } from './Metrics';
import { Sec, Stagger } from './motion';
import { ScreensStrip, Unscreenable } from './Screens';
import { WorkSection } from './Work';

export function LensTab({ lens, f }: { lens: string; f: Feature }) {
  const s = useSheet(), { B } = s.text, { past } = useAsOf();
  const d = s.plan.LENS[lens];
  if (!d) return null;
  const shots = d.fields.some((x) => x.metric?.method === 'harness');
  const biz = d.role === 'business' && hasBusiness(f);
  return (
    <Stagger className={'pg-lens d-' + d.density}>
      <Body f={f} d={d} />
      <Sec label={B.pg_sec_metrics}><Metrics f={f} d={d} /></Sec>
      {past ? null : <Sec label={B.pg_sec_kpis}><KpiRows f={f} d={d} /></Sec>}
      <Sec label={B.pg_sec_work}><WorkSection fid={f.id} lens={lens} /></Sec>
      {shots ? <Sec label={B.pg_sec_screens}><ScreensStrip fid={f.id} name={f.name} /><Unscreenable fid={f.id} lens={lens} /></Sec> : null}
      {biz ? <Sec label={B.pg_sec_business}><BusinessSection f={f} /></Sec> : null}
    </Stagger>
  );
}
