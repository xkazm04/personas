// The feature's record, General's side column (bp page/General.tsx side + sheet/SheetBody.tsx Drawing, BuiltBy,
// FlaggedBy, Parts, Notes): the stylised drawing of its domain, who owns and built it, which lenses flag it, its
// stage, where it lives, the revisions (each date travels the drawing back to it, ui.asOf), its parts and the
// red-pencil notes in the hand face.
import { useSheet } from '../../controller/SheetContext';
import { stageWord } from '../../controller/useBlueprintText';
import type { Feature, Person } from '../../standard/load';
import { Press } from '../Press';
import { illoUrl } from './illo';
import { Sec } from './motion';
import { dayFmt, revLabel } from './values';

const REV_KEY = {
  idea: 'rev_idea', specified: 'rev_specified', 'in-dev': 'rev_in_dev', 'in-review': 'rev_in_review',
  flagged: 'rev_flagged', live: 'rev_live', deprecated: 'rev_deprecated',
} as const;

/** A person's name, else the id as the map wrote it. */
export function usePerson(): (id: string) => Person | { id: string; name: string; kind: 'human' } {
  const people = useSheet().plan.S.people;
  return (id) => people.find((p) => p.id === id) ?? { id, name: id, kind: 'human' };
}

function Drawing({ f }: { f: Feature }) {
  const s = useSheet(), { B, tx } = s.text, T = s.plan.L.TILE[f.id];
  if (!T) return null;
  const d = T.room.d, col = s.engine?.th.ink ?? 'currentColor';
  return (
    <>
      <img src={illoUrl(d.base, col)} alt="" draggable={false} />
      <span className="cap">{tx(B.pg_drawing_cap, { n: T.idx, code: d.code || d.name })}</span>
    </>
  );
}

function Facts({ f }: { f: Feature }) {
  const s = useSheet(), { B, tx, language } = s.text, person = usePerson();
  const bad = f.trouble.filter((x) => x.h === 'bad').map((x) => s.plan.LENS[x.lens]?.name ?? x.lens), watch = f.trouble.length - bad.length;
  return (
    <>
      <div><span className="l">{B.owner}</span>{f.owner ? person(f.owner).name : '—'}</div>
      <div><span className="l">{B.built_by}</span>{f.builtBy.length ? f.builtBy.map((id, i) => { const p = person(id); return <span key={id}>{i ? ', ' : ''}{p.name}{p.kind === 'agent' ? <span className="ag">{B.pg_agent}</span> : null}</span>; }) : '—'}</div>
      <div><span className="l">{B.flagged_by}</span>{bad.length ? <span className="nc">{bad.join(', ')}</span> : watch ? tx(B.pg_flag_watch, { count: watch }) : f.health === 'good' ? B.pg_flag_none : B.pg_flag_unmeasured}</div>
      <div><span className="l">{B.stage}</span>{f.stage ? stageWord(B, f.stage) + (f.stageSince ? ' · ' + tx(B.since, { date: dayFmt(language, f.stageSince) }) : '') : B.pg_unknown}</div>
      <div className="full"><span className="l">{B.lives_in}</span>{f.surfaces.length ? f.surfaces.map((x) => <span key={x} className="ag">{x}</span>) : '—'}</div>
    </>
  );
}

function Revisions({ f }: { f: Feature }) {
  const s = useSheet(), { B, tx, language } = s.text;
  return (
    <table className="revt">
      <thead><tr><th scope="col">{B.rev_col}</th><th scope="col">{B.date_col}</th><th scope="col">{B.desc_col}</th></tr></thead>
      <tbody>
        {f.revs.length ? f.revs.map((r, i) => (
          <tr key={r.date + r.stage + i} className={i === f.revs.length - 1 ? 'now' : ''}>
            <td className="m">{revLabel(i)}</td>
            <td className="m"><Press tone="pg-tt" onClick={() => s.dispatch({ type: 'asOf', date: r.date })} aria-label={tx(B.pg_rev_travel, { date: dayFmt(language, r.date) })}>{dayFmt(language, r.date)}</Press></td>
            <td>{B[REV_KEY[r.stage]]}</td>
          </tr>
        )) : <tr><td colSpan={3}>{B.rev_none}</td></tr>}
      </tbody>
    </table>
  );
}

function Notes({ f }: { f: Feature }) {
  const { B, language } = useSheet().text, person = usePerson();
  return (
    <>
      <h4>{B.pg_notes}</h4>
      <div className="notes">{f.notes.map((n, i) => <div key={i} className="pn">{'“'}{n.text}{'”'}<small>{person(n.by).name}, {dayFmt(language, n.date)}</small></div>)}</div>
    </>
  );
}

/** The side column of General. */
export function RecordColumn({ f }: { f: Feature }) {
  const { B, tx } = useSheet().text, parts = f.parts;
  return (
    <>
      <Sec className="illo" label={B.pg_sec_drawing}><Drawing f={f} /></Sec>
      <Sec className="mtb" label={B.pg_sec_record}><Facts f={f} /></Sec>
      <Sec label={B.pg_sec_revisions}><Revisions f={f} /></Sec>
      {parts ? (
        <Sec label={B.pg_sec_parts}>
          <h4>{tx(B.pg_parts, { done: parts.filter((p) => p.done).length, count: parts.length })}</h4>
          <div className="parts">{parts.map((p) => <span key={p.name} className={p.done ? 'd' : ''}>{p.done ? '✓ ' : '○ '}{p.name}</span>)}</div>
        </Sec>
      ) : null}
      {f.notes.length ? <Sec label={B.pg_notes}><Notes f={f} /></Sec> : null}
    </>
  );
}
