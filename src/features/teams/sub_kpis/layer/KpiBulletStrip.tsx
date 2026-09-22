// Where we stand — a ledger, one row per KPI in the subject, worst first.
//
// It was a stack of three-line blocks (name, a full-width bar, a caption), so
// a group of 131 KPIs was a scroll of 400 lines to answer "which ones are
// behind". It is now the app's canonical table: one row each, the bullet bar
// shrunk into a column, the numbers in their own right-aligned columns so they
// can be compared down the page, and the pace sentence last.
//
// The bar keeps its rules: it is MAGNITUDE (it grows from zero, for 'down'
// KPIs too), the colour carries the verdict, and a KPI with no reading gets the
// hatched track and no fill — unmeasured is never drawn as zero.
import { useMemo } from 'react';

import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { TruncateWithTooltip } from '@/features/shared/components/display/TruncateWithTooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { categoryMeta, paceSentence, TRACK_COLOR } from '../kpiMeta';
import { HATCH_BG } from '../kpiChartTheme';
import { bulletScale, type BulletRow } from './KpiGroupLayer.model';
import { KT } from '../estate/kpiType';

const TICK = 'absolute top-0 bottom-0 w-[2px] -translate-x-1/2';

export function KpiBulletStrip({ rows, onOpen }: { rows: BulletRow[]; onOpen: (kpiId: string) => void }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;

  const columns = useMemo<TableColumn<BulletRow>[]>(
    () => [
      {
        key: 'name',
        label: o.layer_col_kpi,
        width: 'minmax(220px,2.2fr)',
        sortable: true,
        sortFn: (a, b) => a.kpi.name.localeCompare(b.kpi.name),
        render: (row) => {
          const Icon = categoryMeta(row.kpi.category).icon;
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              {/* muted-ok: decorative category glyph beside the name, not body text */}
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate typo-body text-foreground">{row.kpi.name}</span>
            </span>
          );
        },
      },
      {
        key: 'bar',
        label: o.layer_bullet_title,
        width: 'minmax(140px,1.2fr)',
        render: (row) => <BulletBar row={row} />,
      },
      {
        key: 'current',
        label: o.current,
        width: '120px',
        align: 'right',
        sortable: true,
        sortFn: (a, b) => (a.kpi.current_value ?? -Infinity) - (b.kpi.current_value ?? -Infinity),
        render: (row) => <Value value={row.kpi.current_value} unit={row.kpi.unit} strong />,
      },
      {
        key: 'target',
        label: o.target,
        width: '120px',
        align: 'right',
        render: (row) => <Value value={row.kpi.target_value} unit={row.kpi.unit} />,
      },
      {
        key: 'baseline',
        label: o.baseline,
        width: '120px',
        align: 'right',
        hideOnMobile: true,
        render: (row) => <Value value={row.kpi.baseline_value} unit={row.kpi.unit} />,
      },
      {
        key: 'pace',
        label: o.layer_col_pace,
        width: 'minmax(200px,2fr)',
        hideOnMobile: true,
        // The sentence is often longer than the column; the full text rides on
        // a tooltip rather than wrapping the row to two lines.
        render: (row) => (
          <span className="block typo-caption">
            <TruncateWithTooltip
              text={row.track === 'unmeasured' ? t.kpis.pace_unmeasured : paceSentence(row.kpi, t, tx)}
            />
          </span>
        ),
      },
    ],
    [o, t, tx],
  );

  return (
    <section className="space-y-2" data-testid="kpi-layer-bullets">
      <h3 className={KT.eyebrow}>{o.layer_bullet_title}</h3>
      <UnifiedTable
        columns={columns}
        data={rows}
        getRowKey={(row) => row.kpi.id}
        onRowClick={(row) => onOpen(row.kpi.id)}
        rowAccent={(row) => TRACK_COLOR[row.track]}
        density="compact"
        // A group can hold 131 KPIs, so the table windows its rows: the
        // compact row height switches UnifiedTable onto its virtual branch
        // (golden path: long-list-rendering.md).
        rowHeight={36}
        ariaLabel={o.layer_bullet_title}
        rowReveal
      />
    </section>
  );
}

function BulletBar({ row }: { row: BulletRow }) {
  const scale = bulletScale(row.kpi);
  const unmeasured = row.track === 'unmeasured';
  return (
    <div
      className="relative h-2 w-full overflow-hidden rounded-pill bg-secondary/40"
      style={unmeasured ? { backgroundImage: HATCH_BG } : undefined}
      data-testid="kpi-layer-bullet-bar"
      aria-hidden
    >
      {!unmeasured && scale?.current != null && (
        <span
          className="absolute inset-y-0 left-0 rounded-pill"
          style={{ width: `${scale.current}%`, background: TRACK_COLOR[row.track] }}
        />
      )}
      {scale?.baseline != null && (
        <span className={TICK} style={{ left: `${scale.baseline}%`, background: 'var(--muted-foreground)' }} />
      )}
      {scale?.target != null && (
        <span className={TICK} style={{ left: `${scale.target}%`, background: 'var(--foreground)' }} />
      )}
    </div>
  );
}

/** A number with its unit, or an explicit "not set" dash — a missing target is
 *  not a target of zero. */
function Value({ value, unit, strong = false }: { value: number | null; unit: string | null; strong?: boolean }) {
  if (value == null) {
    return <span className="typo-data text-foreground">-</span>;
  }
  return (
    // One line, always: a unit like "obligations" wrapped under its figure and
    // doubled the row height. The unit truncates before the number ever does.
    <span className="flex min-w-0 items-baseline justify-end gap-1 whitespace-nowrap">
      <span className={`typo-data tabular-nums ${strong ? 'font-semibold text-foreground' : 'text-foreground'}`}>
        {value}
      </span>
      {unit ? <span className="min-w-0 truncate typo-caption">{unit}</span> : null}
    </span>
  );
}
