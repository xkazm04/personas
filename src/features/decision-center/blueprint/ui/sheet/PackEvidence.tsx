import { useSheet } from '../../controller/SheetContext';
import type { WorkItem } from '../../model/work';
import { fmtNum, metricLabel, unitFor } from '../format';

/**
 * A built item's evidence: the metric before the build and after it, with the value, the unit and the judge's own
 * line (the store's `evidence`, verbatim). Read-only here; deciding on it is the compare panel's job (WP4b).
 */
export function PackEvidence({ p }: { p: WorkItem }) {
  const s = useSheet();
  const { B, language } = s.text;
  const rows = s.work.evidence(p.id);
  if (!rows.length) return <p className="bp-empty typo-body">{B.evidence_none}</p>;
  return (
    <table className="bp-ev typo-body" data-testid="blueprint-evidence">
      <thead><tr><th scope="col">{B.evidence_phase}</th><th scope="col">{metricLabel(s.plan, p)}</th><th scope="col">{B.evidence_line}</th></tr></thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id}>
            <td className="typo-code">{(m.phase === 'before' ? B.evidence_before : B.evidence_after).toUpperCase()}</td>
            <td className="bp-num typo-data">{fmtNum(language, m.value)} <span className="bp-u typo-code">{unitFor(m.unit ?? '', m.value)}</span></td>
            <td><div className="bp-evt">{m.evidence ?? m.method ?? ''}</div></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
