import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSheet } from '../../controller/SheetContext';
import { verdictWord } from '../../controller/useBlueprintText';
import type { LensDef } from '../../standard/load';
import type { Feature } from '../../standard/load';
import { fmtNum } from '../format';

/** A reading's sparkline: a plain polyline over the metric's history. Decorative; the value beside it states the number. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values, 0), hi = Math.max(...values), r = hi - lo || 1, w = 70, h = 22;
  const pts = values.map((v, i) => `${((i * w) / (values.length - 1)).toFixed(1)},${(h - 2 - ((v - lo) / r) * (h - 4)).toFixed(1)}`).join(' ');
  return <svg width={w} height={h} aria-hidden="true" className="bp-spark"><polyline fill="none" stroke="currentColor" strokeWidth="1.4" points={pts} /></svg>;
}

/** The headline of a lens for one feature: its `measures` field, else the first evidence field that has a plain value. */
function headlineOf(l: LensDef, f: Feature): { label: string; value: string | number | boolean | undefined; type: string; key: string } {
  const fl = f.lens[l.id];
  const m = l.measures;
  if (m && fl?.v[m.key] !== undefined) return { label: m.label, value: fl.v[m.key], type: m.type, key: m.key };
  for (const e of l.evidence) { const v = fl?.v[e.key]; if (v !== undefined && typeof v !== 'object') return { label: e.label, value: v, type: e.type, key: e.key }; }
  return { label: m?.label ?? '', value: undefined, type: m?.type ?? 'string', key: m?.key ?? '' };
}

/** One lens card (bp FeatureSheet): short code and name, the verdict word, the headline reading with its history, and why. */
function LensCard({ l, f }: { l: LensDef; f: Feature }) {
  const s = useSheet();
  const { B, language } = s.text;
  const fl = f.lens[l.id];
  const h = fl?.h ?? 'unmeasured';
  const hd = headlineOf(l, f);
  const ser = hd.key ? s.work.series(f.id, l.id, hd.key).map((m) => m.value) : [];
  const shown = typeof hd.value === 'number' ? fmtNum(language, hd.value) + (hd.type === 'percent' ? '%' : '') : hd.value === undefined ? '—' : String(hd.value);
  return (
    <div className={`bp-lc bp-h-${h}`} data-lens={l.id}>
      <div className="bp-r1 typo-body"><span><span className="bp-s typo-code">{l.short}</span> {l.name}</span><span className="bp-vd typo-code">{verdictWord(B, h).toUpperCase()}</span></div>
      <div className="bp-ml typo-body">{hd.label}</div>
      <div className="bp-mv typo-data">{shown}<Spark values={ser} /></div>
      <div className="bp-why typo-body">
        {fl?.why ?? B.card_no_rule}
        {fl?.facet?.measured_at ? <> {'·'} <RelativeTime timestamp={fl.facet.measured_at} showTooltip={false} /></> : null}
      </div>
    </div>
  );
}

export function LensCards({ f, lens }: { f: Feature; lens: string }) {
  const s = useSheet();
  const list = s.plan.lenses.filter((l) => lens === 'general' || l.id === lens);
  return <div className="bp-cards">{list.map((l) => <LensCard key={l.id} l={l} f={f} />)}</div>;
}
