import { useTranslation } from '@/i18n/useTranslation';
import type { BuilderComponent } from '../steps/builder/types';
import { computeCredentialCoverage } from '../steps/builder/builderReducer';

// -- Credential Coverage Bar --------------------------------------------------

export function CredentialCoverageBar({ components }: { components: BuilderComponent[] }) {
  const { t, tx } = useTranslation();
  const coverage = computeCredentialCoverage(components);
  if (coverage.total === 0) return null;

  const pct = Math.round((coverage.matched / coverage.total) * 100);
  const barColor = coverage.status === 'full' ? 'bg-emerald-400' : coverage.status === 'partial' ? 'bg-amber-400' : 'bg-zinc-500';
  const textColor = coverage.status === 'full' ? 'text-emerald-400' : coverage.status === 'partial' ? 'text-amber-400' : 'text-muted-foreground/60';

  return (
    <div className="flex items-center gap-2.5 mb-2">
      <div className="flex-1 h-1 rounded-full bg-secondary/40 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm font-medium ${textColor} shrink-0`}>
        {tx(t.agents.credential_coverage, { matched: coverage.matched, total: coverage.total })}
      </span>
    </div>
  );
}
