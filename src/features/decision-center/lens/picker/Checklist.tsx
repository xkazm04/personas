/**
 * Checklist - one product's readiness as bp's manage-dialog checklist (bp `components/ProjectsDialog.tsx`
 * Checklist): a grid of rows, each a mark (done or not), a word and, where it has one, a figure. A row that
 * holds reads in full ink; a row that does not reads in the second ink. Never colour alone: the mark and the
 * screen-reader "yes / no" carry it too.
 */
import type { LensScanProduct } from '@/api/lensScan';
import { useTranslation } from '@/i18n/useTranslation';
import { formatRelativeTime } from '@/lib/utils/formatters';

const MARK_OK = '✓';
const MARK_NO = '–';

type CheckRow = { key: string; label: string; ok: boolean; value?: string };

export function Checklist({ p }: { p: LensScanProduct }) {
  const { t, tx, language } = useTranslation();
  const L = t.decisionCenter.lens;
  const n = (v: number) => v.toLocaleString(language);
  const rows: CheckRow[] = [
    {
      key: 'map',
      label: L.check_map,
      ok: p.hasMap,
      value: p.hasMap ? (p.mapVersion ? tx(L.check_map_version, { version: p.mapVersion }) : L.check_map_unknown) : undefined,
    },
    { key: 'store', label: L.check_store, ok: !p.error, value: p.error ? undefined : tx(L.store_version, { version: p.storeVersion }) },
    { key: 'events', label: L.check_events, ok: p.hasEvents },
    { key: 'features', label: L.check_features, ok: p.features > 0, value: n(p.features) },
    { key: 'lenses', label: L.check_lenses, ok: p.lenses > 0, value: n(p.lenses) },
    { key: 'facets', label: L.check_facets, ok: p.measuredFacets > 0, value: n(p.measuredFacets) },
    {
      key: 'last',
      label: L.check_last_scan,
      ok: !!p.lastRunAt,
      value: formatRelativeTime(p.lastRunAt, MARK_NO, { language, dateFallbackDays: 14 }),
    },
  ];
  return (
    <ul className="pj-check" aria-label={L.check_label}>
      {rows.map((r) => (
        <li key={r.key} className={r.ok ? 'ok' : undefined}>
          <span className="mk" aria-hidden="true">{r.ok ? MARK_OK : MARK_NO}</span>
          <span className="k">
            {r.label}
            <span className="sr-only">{`: ${r.ok ? L.check_yes : L.check_no}`}</span>
          </span>
          {r.value !== undefined && <span className="v">{r.value}</span>}
        </li>
      ))}
    </ul>
  );
}
