import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import type { ComplianceRule } from '@/api/byom';
import { PROVIDER_OPTIONS } from '../libs/byomHelpers';

interface ByomComplianceRulesProps {
  rules: ComplianceRule[];
  onAdd: () => void;
  onUpdate: (index: number, updates: Partial<ComplianceRule>) => void;
  onRemove: (index: number) => void;
}

export function ByomComplianceRules({ rules, onAdd, onUpdate, onRemove }: ByomComplianceRulesProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Compliance-Driven Restrictions
            </h2>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Restrict providers for specific workflow types (e.g., HIPAA, SOC2)
            </p>
          </div>
          <button
            onClick={onAdd}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-xl border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Rule
          </button>
        </div>

        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground/50 text-center py-6">
            No compliance rules configured. Add rules to restrict providers for sensitive workflows.
          </p>
        ) : (
          <div className="space-y-3">
            {rules.map((rule, idx) => (
              <div key={idx} className="p-4 rounded-lg border border-primary/10 bg-secondary/20 space-y-3">
                <div className="flex items-center justify-between">
                  <input
                    value={rule.name}
                    onChange={(e) => onUpdate(idx, { name: e.target.value })}
                    className="text-sm font-medium bg-transparent border-none outline-none text-foreground"
                    placeholder="Rule name (e.g., HIPAA)"
                  />
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
                              isSelected
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
