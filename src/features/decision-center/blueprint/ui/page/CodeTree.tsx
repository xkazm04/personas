// "Lives in code" (bp page/CodeTree.tsx): the contexts a feature belongs to, each with its group, its category and
// the files it covers (six, then "n more"). The contexts come from the map the seam hands over (its code tree); the
// loaded structure keeps only their names. Hidden when the feature names no context.
import { useMemo, useState } from 'react';
import { useSheet } from '../../controller/SheetContext';
import type { Feature } from '../../standard/load';
import type { Context } from '../../standard/types';
import { Press } from '../Press';
import { contextsOf } from './kpis';

const SHOWN = 6;

function Ctx({ name, c }: { name: string; c: Context | undefined }) {
  const { B, tx } = useSheet().text;
  const [all, setAll] = useState(false);
  const paths = c?.file_paths ?? [], shown = all ? paths : paths.slice(0, SHOWN), more = paths.length - shown.length;
  return (
    <div className="pg-ctx">
      <div className="hd2"><b>{name}</b>{c?.group ? <span className="ag">{c.group}</span> : null}{c?.category ? <em>{c.category}</em> : null}</div>
      {paths.length ? (
        <ul>
          {shown.map((p) => <li key={p}>{p}</li>)}
          {more > 0 || (all && paths.length > SHOWN)
            ? <li className="more"><Press tone="btn" aria-expanded={all} onClick={() => setAll(!all)}>{all ? B.pg_code_fewer : tx(B.pg_code_more, { count: more })}</Press></li>
            : null}
        </ul>
      ) : <p className="none">{B.pg_code_no_paths}</p>}
    </div>
  );
}

export function CodeTree({ f }: { f: Feature }) {
  const s = useSheet(), { B, tx } = s.text;
  const by = useMemo(() => contextsOf(s.data.structure), [s.data.structure]);
  if (!f.contexts.length) return null;
  return (
    <>
      <h4 className="pg-h">{tx(B.pg_code_head, { count: f.contexts.length })}</h4>
      <div className="pg-code">{f.contexts.map((n) => <Ctx key={n} name={n} c={by.get(n)} />)}</div>
    </>
  );
}
