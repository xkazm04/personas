import { useSheet } from '../../controller/SheetContext';
import { rangeScale, type PerfFigures } from '../../model/perf';
import { fmtNum } from '../format';

/**
 * One performance row's range strip (bp PerfRange): the noise band around the baseline median, a dot per baseline run,
 * the after as a marker, and the target and warn lines, on one 0..max scale (perf.ts rangeScale). Positions are
 * percentages on absolutely placed spans: no layout read, no canvas. Decorative beside the table's own figures; its
 * accessible name states the same numbers.
 */
export function PerfRange({ f, unit, target, warn }: { f: PerfFigures; unit: string; target?: number; warn?: number }) {
  const { B, tx, language } = useSheet().text;
  const n = (v: number) => fmtNum(language, v);
  const s = rangeScale(f, target, warn), lo = Math.max(0, f.median - f.noise), hi = Math.min(s.max, f.median + f.noise);
  const label = tx(B.cmp_pt_range, { runs: f.runs.map(n).join(', '), after: f.after !== undefined ? n(f.after) : '–', unit });
  return (
    <div className="tr-pr" role="img" aria-label={label}>
      <span className="tr-pr-band" style={{ left: s.x(lo), width: `calc(${s.x(hi)} - ${s.x(lo)})` }} />
      {target !== undefined ? <span className="tr-pr-t" style={{ left: s.x(target) }}><b>{B.cmp_pt_target}</b></span> : null}
      {warn !== undefined ? <span className="tr-pr-t warn" style={{ left: s.x(warn) }}><b>{B.cmp_pt_warn}</b></span> : null}
      {f.runs.map((v, i) => <span key={i} className="tr-pr-run" style={{ left: s.x(v) }} />)}
      {f.after !== undefined ? <span className="tr-pr-after" style={{ left: s.x(f.after) }} /> : null}
    </div>
  );
}
