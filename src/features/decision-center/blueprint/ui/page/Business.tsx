// The Business section (bp sheet/Business.tsx, v3.1): the as-is customer experience, the core every variation shares
// (shared tech and core schema) and the variations that extend it, per customer or segment. All three come from the
// feature in the map; the section is hidden when all are absent. Lens values stay on the core feature.
import { useSheet } from '../../controller/SheetContext';
import { stageWord } from '../../controller/useBlueprintText';
import type { Feature } from '../../standard/load';

const Bullets = ({ xs }: { xs: readonly string[] }) => <ul>{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>;

export const hasBusiness = (f: Feature): boolean =>
  !!f.experience || !!f.core?.tech.length || !!f.core?.schema.length || f.variations.length > 0;

export function BusinessSection({ f }: { f: Feature }) {
  const { B, tx } = useSheet().text;
  const tech = f.core?.tech ?? [], schema = f.core?.schema ?? [], vs = f.variations;
  if (!hasBusiness(f)) return null;
  return (
    <div className="biz">
      <h4>{B.pg_biz}</h4>
      {f.experience ? <><h5>{B.pg_asis}</h5><p className="asis">{f.experience}</p></> : null}
      {tech.length || schema.length ? (
        <>
          <h5>{B.pg_core}</h5>
          <div className="core2">
            {tech.length ? <div><h6>{B.pg_tech}</h6><Bullets xs={tech} /></div> : null}
            {schema.length ? <div><h6>{B.pg_schema}</h6><Bullets xs={schema} /></div> : null}
          </div>
        </>
      ) : null}
      {vs.length ? (
        <>
          <h5>{tx(B.pg_variations, { count: vs.length })}</h5>
          <div className="vart-wrap">
            <table className="vart">
              <thead><tr><th scope="col">{B.pg_var_col}</th><th scope="col">{B.pg_extends_col}</th><th scope="col">{B.pg_params_col}</th><th scope="col">{B.stage}</th></tr></thead>
              <tbody>
                {vs.map((v) => (
                  <tr key={v.slug}>
                    <td><b>{v.name}</b><small>{v.audience}</small></td>
                    <td>{v.extends.length ? <Bullets xs={v.extends} /> : '—'}</td>
                    <td>{v.params.length ? <Bullets xs={v.params} /> : '—'}</td>
                    <td><span className="chip">{v.stage ? stageWord(B, v.stage) : B.pg_unknown}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
