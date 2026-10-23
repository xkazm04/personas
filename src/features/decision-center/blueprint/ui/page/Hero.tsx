// A lens tab's body (bp page/LensTab.tsx Body): the headline first and big, the health and the matched rule's reason
// big beside it (an override says who holds it and until when), then the evidence fields as cards, then the rest
// (how many follows the reader's density: a simple reader gets a few and the rest folded away, a dense one gets
// everything open). On a past date health has no history: the headline is the scan's reading by then, else nothing.
import { useSheet } from '../../controller/SheetContext';
import { DENSITY_COUNT, reasonOf } from '../../standard/present';
import { fval, type Feature, type LensDef } from '../../standard/load';
import type { LensField } from '../../standard/types';
import { useAsOf, useHealthWord, Val } from './bits';
import { Sec } from './motion';
import { valueView } from './readings';
import { usePerson } from './Record';
import { dayFmt, hotHealth, ownField } from './values';

function Why({ f, d }: { f: Feature; d: LensDef }) {
  const s = useSheet(), { B, tx, language } = s.text, word = useHealthWord(), { t, now, past } = useAsOf();
  const fl = f.lens[d.id], h = past ? 'unmeasured' : fl?.h ?? 'unmeasured';
  const at = d.headline ? valueView(s.work.series, f, d.id, d.headline, t, now) : { at: 'none' as const };
  if (past) return <p className="why">{at.at === 'then' ? tx(B.pg_read_on, { date: dayFmt(language, at.measured) }) : tx(B.pg_nr_tab, { date: dayFmt(language, t) })}</p>;
  if (h === 'na') return <p className="why">{B.pg_hero_na}</p>;
  if (h === 'unmeasured' && !fl?.facet) return <p className="why">{tx(B.pg_hero_none, { lens: d.name })}</p>;
  return <p className="why">{(fl && reasonOf(fl)) ?? tx(B.pg_hero_ok, { health: word(h).toLowerCase() })}</p>;
}

export function Body({ f, d }: { f: Feature; d: LensDef }) {
  const s = useSheet(), { B, tx, language } = s.text, word = useHealthWord(), person = usePerson();
  const { t, now, past } = useAsOf();
  const fl = f.lens[d.id], h = past ? 'unmeasured' : fl?.h ?? 'unmeasured', density = d.density;
  const hf = d.headline && ownField(d.headline) ? d.headline : null;
  const at = hf ? valueView(s.work.series, f, d.id, hf, t, now) : { at: 'none' as const };
  const then = at.at === 'then' ? at : null;
  const val = (k: string) => fval(f, d.id, k), hot = (k: string) => hotHealth(fl, k);
  const ev = past ? [] : d.evidence.filter((x) => ownField(x) && x !== hf), evShown = ev.slice(0, DENSITY_COUNT.page[density]);
  const seen = new Set([hf?.key, ...evShown.map((x) => x.key)]);
  const rest = past ? [] : d.fields.filter((x) => ownField(x) && !x.metric && !seen.has(x.key) && val(x.key) !== undefined);
  const k = (x: LensField) => f.id + ':' + d.id + ':' + x.key;
  const restRows = rest.map((x) => <div key={x.key} className="r"><span>{x.label}{x.source && 'kpi' in x.source ? ' · ' + B.pg_kpi_tag : ''}</span><b className={hot(x.key)}><Val k={k(x)} field={x} v={val(x.key)} /></b></div>);
  return (
    <>
      <Sec className={'pg-hero ' + h} label={B.pg_sec_hero}>
        <div className="hl">
          <span className="lab">{hf ? hf.label : d.name}</span>
          <b className={'big ' + (hf && !past ? hot(hf.key) : '')}>{hf && (past ? then : fl?.h !== 'na') ? <Val k={k(hf)} field={hf} v={then ? then.value : val(hf.key)} /> : '—'}</b>
          {d.description ? <span className="desc">{d.description}</span> : null}
        </div>
        <div className="hh">
          <span className="hw">{past ? B.pg_not_recorded : word(h)}</span>
          <Why f={f} d={d} />
          {!past && fl?.ov ? (
            <p className="ov"><b>{tx(B.pg_held_at, { health: word(fl.ov.health).toUpperCase() })}</b> {tx(B.pg_held_by, { by: person(fl.ov.by).name, until: dayFmt(language, fl.ov.until) })}{fl.why ? ' ' + tx(B.pg_rules_say, { why: fl.why }) : ''}</p>
          ) : null}
        </div>
      </Sec>
      {past ? <Sec label={B.pg_not_recorded}><p className="pg-nr">{tx(B.pg_nr_section, { date: dayFmt(language, t) })}</p></Sec> : null}
      {evShown.length ? (
        <Sec label={B.pg_sec_evidence}>
          <div className="pg-ev">
            {evShown.map((x) => (
              <div key={x.key} className={'ev ' + hot(x.key)}>
                <span className="lab">{x.label}</span>
                <b><Val k={k(x)} field={x} v={val(x.key)} /></b>
                {x.description ? <span className="desc">{x.description}</span> : null}
              </div>
            ))}
          </div>
        </Sec>
      ) : null}
      {restRows.length ? (
        <Sec className="pg-rest" label={B.pg_sec_rest}>
          {density === 'simple'
            ? <details><summary onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); }}>{tx(B.pg_rest_more, { count: restRows.length })}</summary><div className="rows">{restRows}</div></details>
            : <><h4>{tx(B.pg_also, { count: restRows.length })}</h4><div className={'rows' + (density === 'dense' ? ' two' : '')}>{restRows}</div></>}
        </Sec>
      ) : null}
    </>
  );
}
