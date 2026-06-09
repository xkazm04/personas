import { useTranslation } from '@/i18n/useTranslation';
import { Check, X, Minus, ShieldCheck } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';

/** One scored standards rule, as written by scripts/test/lib/eval/standards.mjs. */
interface StandardsRule {
  id: string;
  status: 'pass' | 'fail' | 'na';
  basis: string;
}
interface StandardsCompliance {
  applicable: boolean;
  pct: number | null;
  rules: StandardsRule[];
}

/** Defensive narrow of the tolerant `JsonValue | null` from the read-model. */
function asCompliance(v: unknown): StandardsCompliance | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.rules)) return null;
  const rules: StandardsRule[] = o.rules
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      id: String(r.id ?? ''),
      status: r.status === 'pass' || r.status === 'fail' ? r.status : 'na',
      basis: String(r.basis ?? ''),
    }));
  return {
    applicable: !!o.applicable,
    pct: typeof o.pct === 'number' ? o.pct : null,
    rules,
  };
}

function RuleRow({ rule }: { rule: StandardsRule }) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  const pass = rule.status === 'pass';
  const fail = rule.status === 'fail';
  const Icon = pass ? Check : fail ? X : Minus;
  const iconColor = pass ? 'text-emerald-400' : fail ? 'text-rose-400' : 'text-zinc-500';
  const statusLabel = pass ? c.gate_pass : fail ? c.gate_fail : c.standards_na;

  return (
    <div className="flex items-center gap-2 py-1.5">
      <Icon className={`w-4 h-4 shrink-0 ${iconColor}`} />
      <span className="typo-caption font-data text-foreground/90 min-w-[10rem]">{rule.id}</span>
      <span className={`typo-caption ${pass ? 'text-emerald-400' : fail ? 'text-rose-400' : 'text-foreground/50'}`}>
        {statusLabel}
      </span>
      {rule.basis && (
        <Tooltip content={rule.basis}>
          <span className="ml-auto typo-caption text-foreground underline decoration-dotted cursor-help truncate max-w-[18rem]">
            {rule.basis}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * §7 Standards & branching compliance — renders the per-rule pre-commit +
 * branching breakdown the harness scores against the bound project's
 * `standards_config` policy. Reads the tolerant `standardsCompliance` value
 * (present only on code-track runs whose project declares a policy).
 */
export function StandardsCard({ compliance }: { compliance: unknown }) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  const data = asCompliance(compliance);
  if (!data || data.rules.length === 0) return null;

  const full = data.pct === 100;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className={`w-4 h-4 ${full ? 'text-emerald-400' : 'text-amber-400'}`} />
        <span className="typo-caption text-foreground">{c.standards_compliance}:</span>
        {data.pct != null ? (
          <span className={`typo-body ${full ? 'text-emerald-400' : 'text-amber-400'}`}>
            <Numeric value={data.pct} unit="percent" />
          </span>
        ) : (
          <span className="typo-caption text-foreground">{c.standards_na}</span>
        )}
      </div>
      <div className="rounded-card border border-primary/10 bg-secondary/20 px-3 py-1.5 divide-y divide-primary/5">
        {data.rules.map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
      </div>
    </div>
  );
}
