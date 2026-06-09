import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { DeterministicDims } from '@/lib/bindings/DeterministicDims';

function barColor(value: number | null): string {
  if (value == null) return 'bg-zinc-500/60';
  if (value >= 80) return 'bg-emerald-500';
  if (value >= 60) return 'bg-amber-500';
  return 'bg-rose-500';
}

function DimBar({ label, value }: { label: string; value: number | null }) {
  // Bars can exceed 100 (e.g. cascade_completion=120 when extra roles fire);
  // clamp the visual width but show the true number.
  const pct = value == null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between typo-caption text-foreground">
        <span>{label}</span>
        {value == null ? (
          <span className="text-foreground">—</span>
        ) : (
          <Numeric value={value} unit="plain" className="text-foreground/90" />
        )}
      </div>
      <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
        <div className={`h-full rounded-full ${barColor(value)}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The 5 deterministic scoring dimensions as labeled progress bars. */
export function DimensionBars({ dims }: { dims: DeterministicDims }) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      <DimBar label={c.dim_cascade} value={dims.cascadeCompletion} />
      <DimBar label={c.dim_density} value={dims.workDensity} />
      <DimBar label={c.dim_handoff} value={dims.handoffHealth} />
      <DimBar label={c.dim_learning} value={dims.learningLoop} />
      <DimBar label={c.dim_grounding} value={dims.groundingPct} />
    </div>
  );
}
