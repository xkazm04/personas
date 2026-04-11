import { Plus, Trash2, ToggleLeft, ToggleRight, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import type { ComplianceRule } from '@/api/system/byom';
import { PROVIDER_OPTIONS, type PolicyWarning, type PolicyWarningSeverity } from '../libs/byomHelpers';
import { useTranslation } from '@/i18n/useTranslation';

const SEVERITY_STYLES: Record<PolicyWarningSeverity, { border: string; text: string; icon: typeof AlertTriangle }> = {
  error:   { border: 'border-red-500/30',   text: 'text-red-400/90',   icon: AlertCircle },
  warning: { border: 'border-amber-500/30', text: 'text-amber-400/90', icon: AlertTriangle },
  info:    { border: 'border-blue-500/30',  text: 'text-blue-400/90',  icon: Info },
};

interface ByomComplianceRulesProps {
  rules: ComplianceRule[];
  warnings: Map<number, PolicyWarning[]>;
  onAdd: () => void;
  onUpdate: (index: number, updates: Partial<ComplianceRule>) => void;
  onRemove: (index: number) => void;
}

export function ByomComplianceRules({ rules, warnings, onAdd, onUpdate, onRemove }: ByomComplianceRulesProps) {
  const { t } = useTranslation();
  const s = t.settings.byom;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-4">
        <SectionHeading
          title={s.compliance_title}
          action={
            <button
              onClick={onAdd}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-xl border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {s.add_rule}
            </button>
          }
        />
        <p className="text-sm text-muted-foreground/60 mt-1">
          {s.compliance_hint}
        </p>

        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground/50 text-center py-6">
            {s.compliance_empty}
          </p>
        ) : (
          <div className="space-y-3">
            {rules.map((rule, idx) => {
              const ruleWarnings = warnings.get(idx);
              const worstSeverity = ruleWarnings?.length
                ? (ruleWarnings.some((w) => w.severity === 'error') ? 'error'
                  : ruleWarnings.some((w) => w.severity === 'warning') ? 'warning' : 'info') as PolicyWarningSeverity
                : null;
              const WorstIcon = worstSeverity ? SEVERITY_STYLES[worstSeverity].icon : null;
              // Build set of provider ids with warnings for this rule, keyed by worst severity
              const warnedProviders = new Map<string, PolicyWarningSeverity>();
              if (ruleWarnings) {
                for (const w of ruleWarnings) {
                  for (const prov of PROVIDER_OPTIONS) {
                    if (w.message.includes(`"${prov.label}"`)) {
                      const existing = warnedProviders.get(prov.id);
                      if (!existing || w.severity === 'error' || (w.severity === 'warning' && existing === 'info')) {
                        warnedProviders.set(prov.id, w.severity);
                      }
                    }
                  }
                }
              }
              return (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border bg-secondary/20 space-y-3 ${
                    worstSeverity ? SEVERITY_STYLES[worstSeverity].border : 'border-primary/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {WorstIcon ? (
                        <WorstIcon className={`w-4 h-4 ${SEVERITY_STYLES[worstSeverity!].text} shrink-0`} />
                      ) : null}
                      <input
                        value={rule.name}
                        onChange={(e) => onUpdate(idx, { name: e.target.value })}
                        className="text-sm font-medium bg-transparent border-none outline-none text-foreground"
                        placeholder={s.compliance_name_placeholder}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => onUpdate(idx, { enabled: !rule.enabled })} className="text-sm">
                        {rule.enabled
                          ? <ToggleRight className="w-5 h-5 text-emerald-400" />
                          : <ToggleLeft className="w-5 h-5 text-muted-foreground/50" />
                        }
                      </button>
                      <button
                        onClick={() => onRemove(idx)}
                        className="text-muted-foreground/50 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground/60 mb-1 block">
                        {s.workflow_tags}
                      </label>
                      <input
                        value={rule.workflow_tags.join(', ')}
                        onChange={(e) =>
                          onUpdate(idx, {
                            workflow_tags: e.target.value
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder={s.workflow_tags_placeholder}
                        className="w-full text-sm p-2 rounded-lg border border-primary/15 bg-secondary/40 text-foreground outline-none placeholder:text-muted-foreground/30"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground/60 mb-1 block">
                        {s.allowed_providers_label}
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {PROVIDER_OPTIONS.map((prov) => {
                          const isSelected = rule.allowed_providers.includes(prov.id);
                          const provSeverity = warnedProviders.get(prov.id);
                          return (
                            <button
                              key={prov.id}
                              onClick={() => {
                                const updated = isSelected
                                  ? rule.allowed_providers.filter((id) => id !== prov.id)
                                  : [...rule.allowed_providers, prov.id];
                                onUpdate(idx, { allowed_providers: updated });
                              }}
                              className={`px-2 py-1 text-xs rounded-lg border transition-colors ${
                                isSelected && provSeverity === 'error'
                                  ? 'border-red-500/40 bg-red-500/15 text-red-400'
                                  : isSelected && provSeverity === 'warning'
                                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-400'
                                  : isSelected && provSeverity === 'info'
                                  ? 'border-blue-500/40 bg-blue-500/15 text-blue-400'
                                  : isSelected
                                  ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                                  : 'border-primary/10 text-muted-foreground/50 hover:text-foreground'
                              }`}
                            >
                              {prov.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {ruleWarnings?.length ? (
                    <div className="space-y-1">
                      {ruleWarnings.map((w, wi) => {
                        const style = SEVERITY_STYLES[w.severity];
                        const WarnIcon = style.icon;
                        return (
                          <div key={wi} className={`flex items-start gap-1.5 text-xs ${style.text}`}
                            title={w.severity === 'info' ? w.message : undefined}
                          >
                            <WarnIcon className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>{w.message}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
