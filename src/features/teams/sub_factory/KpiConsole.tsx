// Shared deepest layer for ALL Factory variants — a single KPI's calibration
// console. This is the "Command Deck content" the user wants as the baseline:
// the live value, a calibration track, the threshold tuners (the steering
// lever), the manual rating, and the measurement process. Rendered full-width
// inside whatever drill-down chrome a variant provides.
import { Activity, Clock, SlidersHorizontal, Gauge } from 'lucide-react';

import { STATUS_COLOR, TRAFFIC_COLOR, CATEGORY_LABEL, kpiStatus, progressPct, type MockKpi, type KpiEdit } from './factoryMock';
import { Sparkline, RatingStars, CalibrationTrack, StatusPill } from './factoryPrimitives';

export function KpiConsole({ kpi, onEdit }: { kpi: MockKpi; onEdit: (patch: KpiEdit) => void }) {
  const st = kpiStatus(kpi);
  const pct = progressPct(kpi);
  return (
    <div className="grid lg:grid-cols-[minmax(300px,380px)_1fr] gap-4" data-testid="factory-kpi-console">
      {/* hero — read the state */}
      <div className="rounded-card border border-primary/15 bg-secondary/10 p-5">
        <div className="flex items-center gap-2 mb-2">
          <StatusPill status={st} />
          <span className="ml-auto typo-caption text-foreground capitalize">{kpi.tier.replace('_', ' ')} · {CATEGORY_LABEL[kpi.category]}</span>
        </div>
        <h2 className="typo-section-title text-foreground leading-tight mb-4">{kpi.name}</h2>
        <div className="flex items-end gap-2 mb-4">
          <span className="text-5xl font-bold tabular-nums leading-none" style={{ color: STATUS_COLOR[st] }}>{kpi.current ?? '—'}</span>
          <span className="typo-body text-foreground mb-1.5">{kpi.unit}</span>
          {pct != null && (
            <span className="ml-auto mb-1 leading-none text-right">
              <span className="typo-data-lg tabular-nums" style={{ color: STATUS_COLOR[st] }}>{pct}%</span>
              <span className="block typo-caption">to target</span>
            </span>
          )}
        </div>
        <CalibrationTrack kpi={kpi} height={38} />
        <div className="flex items-center justify-between mt-3 typo-caption text-foreground">
          <span>Baseline <b className="tabular-nums">{kpi.baseline}{kpi.unit}</b></span>
          <span className="text-foreground/70">{kpi.direction === 'up' ? 'higher is better' : 'lower is better'}</span>
          <span style={{ color: TRAFFIC_COLOR.green }}>Target <b className="tabular-nums">{kpi.target}{kpi.unit}</b></span>
        </div>
      </div>

      {/* controls — steer the development */}
      <div className="space-y-3">
        <div className="rounded-card border border-primary/10 bg-secondary/10 p-4">
          <h3 className="typo-label text-foreground mb-1 flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" /> Calibrate thresholds</h3>
          <p className="typo-caption text-foreground/70 mb-3">When the value crosses a band the autonomous loop escalates — yellow nudges, red derives a goal.</p>
          <Stepper label="Yellow (at risk) at" dot={TRAFFIC_COLOR.yellow} value={kpi.warnAt} unit={kpi.unit} onChange={(v) => onEdit({ warnAt: v })} />
          <Stepper label="Red (off track) at" dot={TRAFFIC_COLOR.red} value={kpi.critAt} unit={kpi.unit} onChange={(v) => onEdit({ critAt: v })} />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-card border border-primary/10 bg-secondary/10 p-4">
            <h3 className="typo-label text-foreground mb-2 flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" /> Manual rating</h3>
            <RatingStars value={kpi.manualRating} onChange={(v) => onEdit({ rating: v })} size={22} />
            <p className="typo-caption text-foreground/70 mt-2">{kpi.manualRating != null ? `${kpi.manualRating}/5 — your confidence in this signal` : 'Rate your confidence in this signal'}</p>
          </div>

          <div className="rounded-card border border-primary/10 bg-secondary/10 p-4">
            <h3 className="typo-label text-foreground mb-2 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> Measurement</h3>
            <dl className="space-y-1 typo-caption text-foreground">
              <div className="flex justify-between"><dt className="text-foreground/70">Method</dt><dd className="font-medium lowercase">{kpi.measureKind}</dd></div>
              <div className="flex justify-between"><dt className="text-foreground/70">Cadence</dt><dd className="font-medium flex items-center gap-1"><Clock className="w-3 h-3" />{kpi.cadence}</dd></div>
              <div className="flex justify-between"><dt className="text-foreground/70">Last reading</dt><dd className="font-medium">{kpi.lastMeasuredAt}</dd></div>
            </dl>
          </div>
        </div>

        <div className="rounded-card border border-primary/10 bg-secondary/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="typo-label text-foreground">Measurement history</h3>
            <button type="button" className="typo-caption rounded-interactive border border-primary/20 bg-primary/10 px-2.5 py-1 text-foreground hover:bg-primary/20 transition-colors">Measure now</button>
          </div>
          <Sparkline series={kpi.series} color={STATUS_COLOR[st]} width={420} height={44} />
        </div>
      </div>
    </div>
  );
}

function Stepper({ label, dot, value, unit, onChange }: { label: string; dot: string; value: number; unit: string; onChange: (v: number) => void }) {
  const step = Math.max(0.1, Math.abs(value) * 0.05);
  const round = (n: number) => Math.round(n * 100) / 100;
  return (
    <div className="flex items-center gap-2 mb-2 last:mb-0">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} />
      <span className="typo-caption text-foreground flex-1">{label}</span>
      <button type="button" onClick={() => onChange(round(value - step))} className="w-6 h-6 rounded-interactive border border-primary/15 bg-secondary/30 text-foreground hover:bg-secondary/50 leading-none">−</button>
      <span className="typo-data tabular-nums text-foreground w-16 text-center">{round(value)}{unit}</span>
      <button type="button" onClick={() => onChange(round(value + step))} className="w-6 h-6 rounded-interactive border border-primary/15 bg-secondary/30 text-foreground hover:bg-secondary/50 leading-none">+</button>
    </div>
  );
}
