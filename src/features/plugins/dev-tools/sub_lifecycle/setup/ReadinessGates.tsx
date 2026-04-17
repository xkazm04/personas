import { CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
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
  const { t } = useTranslation();
  return (
    <div className={`rounded-card border p-4 ${
      qualityScore >= 85
        ? 'border-emerald-500/25 bg-emerald-500/5'
        : qualityScore >= 55
        ? 'border-amber-500/25 bg-amber-500/5'
        : 'border-red-500/25 bg-red-500/5'
    }`}>
      <div className="flex items-center gap-3 mb-3">
        <ShieldCheck className={`w-5 h-5 shrink-0 ${
          qualityScore >= 85 ? 'text-emerald-400' :
          qualityScore >= 55 ? 'text-amber-400' : 'text-red-400'
        }`} />
        <div className="flex-1 min-w-0">
          <h3 className="typo-section-title">
            {t.plugins.dev_tools.lifecycle_readiness} {qualityScore}/100
          </h3>
          <p className="typo-body text-foreground mt-0.5">
            {qualityScore >= 85
              ? 'Ready to run. Dev Clone will scan, propose, and build on approval.'
              : qualityScore >= 55
              ? 'Partially configured. Click Auto-Setup to fill the gaps.'
              : 'Not configured yet. Adopt Dev Clone and run Auto-Setup.'}
          </p>
        </div>
        <div className="shrink-0">
          <div className="w-24 h-2 rounded-full bg-background/60 overflow-hidden">
            <div
              className={`h-full transition-all ${
                qualityScore >= 85 ? 'bg-emerald-400' :
                qualityScore >= 55 ? 'bg-amber-400' : 'bg-red-400'
              }`}
              style={{ width: `${qualityScore}%` }}
            />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {gates.map((g) => (
          <div key={g.id} className="flex items-center gap-2">
            {g.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-foreground shrink-0" />
            )}
            <span className="typo-caption text-foreground truncate" title={g.hint}>
              {g.label}
            </span>
            <span className="typo-caption text-foreground shrink-0 ml-auto">
              +{g.weight}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
