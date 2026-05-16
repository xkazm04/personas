import { Check, ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface QualityGate {
  id: string;
  label: string;
  ok: boolean;
  weight: number;
  hint?: string;
}

interface ReadinessGatesProps {
  gates: QualityGate[];
  qualityScore: number;
}

export function ReadinessGates({ gates, qualityScore }: ReadinessGatesProps) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;

  const passed = gates.filter((g) => g.ok).length;
  const total = gates.length;

  const tone = qualityScore >= 85
    ? { border: 'border-emerald-500/25', bg: 'bg-emerald-500/5', icon: 'text-emerald-400', bar: 'bg-emerald-400', step: 'border-emerald-400 bg-emerald-400/15' }
    : qualityScore >= 55
    ? { border: 'border-amber-500/25', bg: 'bg-amber-500/5', icon: 'text-amber-400', bar: 'bg-amber-400', step: 'border-amber-400 bg-amber-400/15' }
    : { border: 'border-red-500/25', bg: 'bg-red-500/5', icon: 'text-red-400', bar: 'bg-red-400', step: 'border-red-400 bg-red-400/15' };

  return (
    <div className={`rounded-card border p-4 ${tone.border} ${tone.bg}`}>
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheck className={`w-5 h-5 shrink-0 ${tone.icon}`} />
        <div className="flex-1 min-w-0">
          <h3 className="typo-section-title">
            {t.plugins.dev_tools.lifecycle_readiness} {qualityScore}/100
          </h3>
          <p className="typo-body text-foreground mt-0.5">
            {qualityScore >= 85
              ? dl.readiness_ready
              : qualityScore >= 55
              ? dl.readiness_partial
              : dl.readiness_not_configured}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="typo-caption uppercase tracking-[0.18em] text-foreground/70">
            {dl.readiness_step_counter_label}
          </p>
          <p className="typo-data-lg tabular-nums leading-none mt-0.5">
            {tx(dl.readiness_step_counter_value, { passed, total })}
          </p>
        </div>
      </div>

      {/* Step-stone progress: one node per gate, connected by a line that
          fills up to (but not past) the last passed gate. */}
      <div className="relative pt-2 pb-1">
        {/* Track */}
        <div className="absolute left-3 right-3 top-[18px] h-0.5 bg-primary/10 rounded-full" />
        {/* Filled portion — width = (passed - 1 + 0.5) / (total - 1) * 100 when at least 1 passed; visual hint of completion */}
        {passed > 0 && total > 1 && (
          <div
            className={`absolute left-3 top-[18px] h-0.5 rounded-full transition-all ${tone.bar}`}
            style={{ width: `calc((100% - 1.5rem) * ${Math.max(0, Math.min(1, (passed - 1) / (total - 1)))})` }}
          />
        )}

        <ol className="relative grid gap-1" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
          {gates.map((g, i) => {
            const isCurrent = !g.ok && gates.slice(0, i).every((prev) => prev.ok);
            return (
              <li key={g.id} className="flex flex-col items-center text-center">
                <div
                  title={g.hint ?? g.label}
                  className={[
                    'w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors',
                    g.ok
                      ? tone.step
                      : isCurrent
                      ? 'border-primary/40 bg-background animate-pulse'
                      : 'border-primary/15 bg-background',
                  ].join(' ')}
                >
                  {g.ok ? (
                    <Check className={`w-3 h-3 ${tone.icon}`} />
                  ) : (
                    <span className="typo-caption font-medium text-foreground/60 tabular-nums">{i + 1}</span>
                  )}
                </div>
                <span
                  className={`mt-1.5 typo-caption line-clamp-2 leading-tight ${
                    g.ok ? 'text-foreground' : isCurrent ? 'text-primary font-medium' : 'text-foreground/55'
                  }`}
                  title={g.label}
                >
                  {g.label}
                </span>
                <span className="typo-caption text-foreground/45 tabular-nums">+{g.weight}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
