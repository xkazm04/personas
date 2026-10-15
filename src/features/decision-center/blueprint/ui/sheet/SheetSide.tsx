import { useEffect, useRef } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { stageWord } from '../../controller/useBlueprintText';
import { drawKeyPlan } from '../../engine/keyplan';

/** The side of the L4 sheet (bp FeatureSheet): where it stands (a key plan), the owner table, where it lives, its revisions. */
export function SheetSide({ fid }: { fid: string }) {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const cv = useRef<HTMLCanvasElement>(null);
  const T = s.plan.L.TILE[fid];
  useEffect(() => {
    const draw = () => { if (cv.current && s.engine) drawKeyPlan(cv.current, s.plan.L, s.engine.th, null, fid); };
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [s.engine, s.plan, fid]);
  if (!T) return null;
  const f = T.f;
  const flagged = f.trouble.map((t) => s.plan.LENS[t.lens]?.short ?? t.lens);
  const runs = s.work.runs.length;
  const date = (d: string) => (d ? new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(d + 'T00:00:00Z')) : '');
  return (
    <aside className="bp-side-col">
      <div className="bp-kpbox">
        <div className="typo-eyebrow bp-ink">{tx(B.where_it_stands, { n: T.idx })}</div>
        <canvas ref={cv} aria-hidden="true" />
      </div>
      <table className="typo-body">
        <tbody>
          <tr><th scope="col">{B.owner}</th><th scope="col">{B.built_by}</th></tr>
          <tr><td>{T.room.d.name}</td><td>{runs ? tx(B.built_by_scan, { count: runs }) : '—'}</td></tr>
          <tr><th scope="col">{B.flagged_by}</th><th scope="col">{B.stage}</th></tr>
          <tr><td>{flagged.length ? flagged.join(', ') : B.no_lens}</td><td>{f.stage ? stageWord(B, f.stage) : '—'}{f.stageSince ? ` · ${tx(B.since, { date: date(f.stageSince) })}` : ''}</td></tr>
          <tr><th scope="col" colSpan={2}>{B.lives_in}</th></tr>
          <tr><td colSpan={2}>{[...f.surfaces, ...f.contexts.slice(0, 4)].map((x) => <span key={x} className="bp-tag-s typo-code">{x}</span>)}{!f.surfaces.length && !f.contexts.length ? '—' : null}</td></tr>
        </tbody>
      </table>
      <table className="typo-body">
        <thead><tr><th scope="col">{B.rev_col}</th><th scope="col">{B.date_col}</th><th scope="col">{B.desc_col}</th></tr></thead>
        <tbody>
          {f.revs.length ? f.revs.map((r, i) => (
            <tr key={r.date + r.stage}><td className="typo-code">{String.fromCharCode(65 + i)}</td><td className="typo-code">{date(r.date)}</td><td>{B[`rev_${r.stage.replace('-', '_')}` as keyof typeof B] as string}</td></tr>
          )) : <tr><td colSpan={3}>{B.rev_none}</td></tr>}
        </tbody>
      </table>
    </aside>
  );
}
