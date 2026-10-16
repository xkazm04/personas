import { useMemo } from 'react';
import { useSheet } from '../../controller/SheetContext';
import { evidenceOf, readingsBy, type PkgItem, type ReleaseModel } from '../../model/ledgerRelease';
import { releaseWord } from '../words';

/**
 * The Release tab's history (bp History): tagged and failed releases other than the open one, newest first, each its
 * version, tag or status, date and item count, then its items (a flagged one marked: it shipped failed or unmoved).
 * Dates render in the sheet's language.
 */
export function History({ m }: { m: ReleaseModel }) {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const scan = s.data.scan, lenses = s.plan.lenses;
  const items = useMemo(() => {
    const by = readingsBy(scan.measurements), out = new Map<string, PkgItem[]>();
    for (const p of scan.proposals) if (p.release_id && m.history.some((r) => r.id === p.release_id)) {
      let a = out.get(p.release_id); if (!a) out.set(p.release_id, (a = [])); a.push(evidenceOf(p, by, lenses));
    }
    return out;
  }, [scan, lenses, m.history]);
  const when = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return (
    <section className="tr-rel-hist" aria-label={B.lg_rel_history_label}>
      <h3>{tx(B.lg_rel_history, { n: m.history.length })}</h3>
      {m.history.length ? (
        <ul className="hist">
          {m.history.map((r) => {
            const its = items.get(r.id) ?? [];
            return (
              <li key={r.id}>
                <div className="hh"><b>{'v' + r.version}</b><span>{r.tag ?? releaseWord(B, r.status)} · {when.format(new Date(r.updated_at))} · {tx(B.lg_pack_items, { n: its.length })}</span></div>
                {r.status === 'failed' && r.error ? <p className="err">{r.error}</p> : null}
                {its.length ? <ul>{its.map((x) => <li key={x.p.id}>{x.p.title}{x.flagged ? ' ⚑' : ''}</li>)}</ul> : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="tr-rel-none">{B.lg_rel_history_none}</p>}
    </section>
  );
}
