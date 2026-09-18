// Where we stand — one zero-based bullet bar per KPI in the subject, worst
// first. The bar is MAGNITUDE (it always grows from zero, for 'down' KPIs
// too); the color carries the verdict. A KPI with no reading gets the hatched
// track and no fill: unmeasured is never drawn as zero.
import { useTranslation } from '@/i18n/useTranslation';
import type { DevKpi } from '@/lib/bindings/DevKpi';

import { categoryMeta, paceSentence, TRACK_COLOR } from '../kpiMeta';
import { HATCH_BG } from '../kpiChartTheme';
import { bulletScale, type BulletRow } from './KpiGroupLayer.model';

const TICK = 'absolute top-0 bottom-0 w-[2px] -translate-x-1/2';

export function KpiBulletStrip({ rows, onOpen }: { rows: BulletRow[]; onOpen: (kpiId: string) => void }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-card border border-primary/15 bg-secondary/10 p-4 space-y-3">
      <h3 className="typo-overline text-foreground">{t.kpis.overview.layer_bullet_title}</h3>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.kpi.id}>
            <BulletRowView row={row} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function BulletRowView({ row, onOpen }: { row: BulletRow; onOpen: (kpiId: string) => void }) {
  const { t, tx } = useTranslation();
  const { kpi, track } = row;
  const Icon = categoryMeta(kpi.category).icon;
  const scale = bulletScale(kpi);
  const unmeasured = track === 'unmeasured';
  const color = TRACK_COLOR[track];
  return (
    <div className="space-y-1" data-testid="kpi-layer-bullet-row">
      <div className="flex items-center gap-1.5 min-w-0">
        {/* muted-ok: decorative category glyph beside the name, not body text */}
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
        <button
          type="button"
          onClick={() => onOpen(kpi.id)}
          aria-label={kpi.name}
          className="typo-body text-foreground truncate text-left hover:text-primary focus-ring rounded-interactive"
        >
          {kpi.name}
        </button>
      </div>

      <div
        className="relative w-full h-2.5 rounded-pill overflow-hidden bg-secondary/40"
        style={unmeasured ? { backgroundImage: HATCH_BG } : undefined}
        data-testid="kpi-layer-bullet-bar"
        aria-hidden
      >
        {!unmeasured && scale?.current != null && (
          <span
            className="absolute inset-y-0 left-0 rounded-pill"
            style={{ width: `${scale.current}%`, background: color }}
          />
        )}
        {scale?.baseline != null && (
          <span className={TICK} style={{ left: `${scale.baseline}%`, background: 'var(--muted-foreground)' }} />
        )}
        {scale?.target != null && (
          <span className={TICK} style={{ left: `${scale.target}%`, background: 'var(--foreground)' }} />
        )}
      </div>

      <p className="typo-caption">
        {unmeasured ? t.kpis.pace_unmeasured : `${valuesLine(kpi, t)} · ${paceSentence(kpi, t, tx)}`}
      </p>
    </div>
  );
}

/** "current 42 % · target 90 % · baseline 10 %" — only the parts that exist. */
function valuesLine(kpi: DevKpi, t: ReturnType<typeof useTranslation>['t']): string {
  const o = t.kpis.overview;
  const unit = kpi.unit ? ` ${kpi.unit}` : '';
  const parts: string[] = [];
  if (kpi.current_value != null) parts.push(`${o.current} ${kpi.current_value}${unit}`);
  if (kpi.target_value != null) parts.push(`${o.target} ${kpi.target_value}${unit}`);
  if (kpi.baseline_value != null) parts.push(`${o.baseline} ${kpi.baseline_value}${unit}`);
  return parts.join(' · ');
}

