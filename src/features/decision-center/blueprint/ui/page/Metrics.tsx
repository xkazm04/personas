// A lens tab's metric rows (bp page/LensTab.tsx Metrics): on a 4-column grid, the field and its method chip, a 72x18
// sparkline with the target as a dashed amber line, the value (counting, an arrow against the previous reading
// coloured by the manifest's `better`), the target and the previous value; under it the latest reading's evidence
// text (two lines, "more" opens the rest). A dense or standard reader sees every metric field, a simple one only the
// measured ones; on a past date the readings up to that day.
import { useLayoutEffect, useRef, useState } from 'react';
import { useSheet } from '../../controller/SheetContext';
import type { Feature, LensDef } from '../../standard/load';
import { Press } from '../Press';
import { MoveArrow, Spark, useAsOf, Val } from './bits';
import { metricMove, metricRows } from './readings';
import { fmtValue, hotHealth, nfmt } from './values';

/** A reading's evidence text: two lines, and "more" when it runs longer (the toggle shows only then). */
function EvidenceText({ text }: { text: string }) {
  const { B } = useSheet().text;
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false), [long, setLong] = useState(false);
  useLayoutEffect(() => { const el = ref.current; if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1); }, [text, open]);
  return (
    <div className={'evd' + (open ? ' open' : '')}>
      <p ref={ref}>{text}</p>
      {long || open ? <Press aria-expanded={open} onClick={() => setOpen(!open)}>{open ? B.pg_less : B.pg_more}</Press> : null}
    </div>
  );
}

export function Metrics({ f, d }: { f: Feature; d: LensDef }) {
  const s = useSheet(), { B, tx, language } = s.text, { t, now, past } = useAsOf();
  const yn = { yes: B.pg_yes, no: B.pg_no };
  const rows = metricRows(d, f, s.work.series, t, now), fl = f.lens[d.id];
  const shown = d.density !== 'simple' || past ? rows : rows.filter((r) => r.value !== undefined);
  if (!shown.length) return null;
  const measured = shown.filter((r) => r.value !== undefined).length;
  const fromScan = s.data.storeVersion > 0;
  const head = measured === shown.length ? tx(B.pg_measured_all, { count: shown.length }) : tx(B.pg_measured_some, { measured, count: shown.length });
  return (
    <div className="pg-mrs">
      <h4>{head}{fromScan ? ' · ' + B.pg_from_scan : ''}</h4>
      {shown.map((r) => {
        const m = r.field.metric!, { dir, cls } = metricMove(r), hot = hotHealth(fl, r.field.key);
        const tg = [m.target !== undefined ? tx(B.pg_target, { value: nfmt(language, m.target) }) : '', dir && r.prev !== undefined ? tx(B.pg_was, { value: fmtValue(language, r.field, r.prev, yn) }) : ''].filter(Boolean).join(' · ');
        return (
          <div key={r.field.key} className={'mr ' + hot}>
            <span className="nm">{r.field.label}<em className="mth">{r.method}</em></span>
            <span className="sp">{r.pts.length > 1 ? <Spark pts={r.pts} target={m.target} cls={cls} /> : <span className="one">{r.pts.length ? B.pg_one_reading : B.pg_not_measured}</span>}</span>
            <b className={hot}><MoveArrow dir={dir} cls={cls} /><Val k={f.id + ':' + d.id + ':' + r.field.key} field={r.field} v={r.value} unit={r.unit} /></b>
            <span className="tg">{tg}</span>
            {r.evidence ? <EvidenceText text={r.evidence} /> : null}
          </div>
        );
      })}
    </div>
  );
}
