import { Plus, Trash2, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import type { ComplianceRule } from '@/api/system/byom';
import { PROVIDER_OPTIONS, type PolicyWarning } from '../libs/byomHelpers';

interface ByomComplianceRulesProps {
  rules: ComplianceRule[];
  warnings: Map<number, PolicyWarning[]>;
  onAdd: () => void;
  onUpdate: (index: number, updates: Partial<ComplianceRule>) => void;
  onRemove: (index: number) => void;
}

export function ByomComplianceRules({ rules, warnings, onAdd, onUpdate, onRemove }: ByomComplianceRulesProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-4">
        <SectionHeading
          title="Compliance-Driven Restrictions"
          action={
            <button
              onClick={onAdd}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-xl border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Rule
            </button>
          }
        />
        <p className="text-sm text-muted-foreground/60 mt-1">
          Restrict providers for specific workflow types (e.g., HIPAA, SOC2)
        </p>

        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground/50 text-center py-6">
            No compliance rules configured. Add rules to restrict providers for sensitive workflows.
          </p>
        ) : (
          <div className="space-y-3">
            {rules.map((rule, idx) => {
              const ruleWarnings = warnings.get(idx);
              // Build set of provider ids with warnings for this rule
              const warnedProviders = new Set<string>();
              if (ruleWarnings) {
                for (const w of ruleWarnings) {
                  // Extract provider name from message to highlight the specific pill
                  for (const prov of PROVIDER_OPTIONS) {
                    if (w.message.includes(`"${prov.label}"`)) warnedProviders.add(prov.id);
                  }
                }
              }
              return (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border bg-secondary/20 space-y-3 ${
                    ruleWarnings?.length ? 'border-amber-500/30' : 'border-primary/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {ruleWarnings?.length ? (
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : null}
                      <input
                        value={rule.name}
                        onChange={(e) => onUpdate(idx, { name: e.target.value })}
                        className="text-sm font-medium bg-transparent border-none outline-none text-foreground"
                        placeholder="Rule name (e.g., HIPAA)"
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
                        Workflow Tags (comma-separated)
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
                        placeholder="hipaa, healthcare, pii"
                        className="w-full text-sm p-2 rounded-lg border border-primary/15 bg-secondary/40 text-foreground outline-none placeholder:text-muted-foreground/30"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground/60 mb-1 block">
                        Allowed Providers
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {PROVIDER_OPTIONS.map((prov) => {
                          const isSelected = rule.allowed_providers.includes(prov.id);
                          const isWarned = warnedProviders.has(prov.id);
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
                                isSelected && isWarned
                                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-400'
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
                      {ruleWarnings.map((w, wi) => (
                        <div key={wi} className="flex items-start gap-1.5 text-xs text-amber-400/90">
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                          <span>{w.message}</span>
                        </div>
                      ))}
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
