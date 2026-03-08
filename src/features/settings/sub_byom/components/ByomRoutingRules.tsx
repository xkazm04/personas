import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import type { RoutingRule, TaskComplexity } from '@/api/byom';
import { PROVIDER_OPTIONS, COMPLEXITY_OPTIONS } from '../libs/byomHelpers';

interface ByomRoutingRulesProps {
  rules: RoutingRule[];
  onAdd: () => void;
  onUpdate: (index: number, updates: Partial<RoutingRule>) => void;
  onRemove: (index: number) => void;
}

export function ByomRoutingRules({ rules, onAdd, onUpdate, onRemove }: ByomRoutingRulesProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/10 bg-card-bg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Cost-Optimized Routing Rules
            </h2>
            <p className="text-sm text-muted-foreground/60 mt-1">
              Route tasks to specific providers/models based on complexity level
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
            No routing rules configured. Add rules to optimize cost by task complexity.
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
                    placeholder="Rule name"
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

                <div className="grid grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-6 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground/60 mb-1 block">Complexity</label>
                    <select
                      value={rule.task_complexity}
                      onChange={(e) => onUpdate(idx, { task_complexity: e.target.value as TaskComplexity })}
                      className="w-full text-sm p-2 rounded-lg border border-primary/15 bg-secondary/40 text-foreground outline-none"
                    >
                      {COMPLEXITY_OPTIONS.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground/60 mb-1 block">Provider</label>
                    <select
                      value={rule.provider}
                      onChange={(e) => onUpdate(idx, { provider: e.target.value })}
                      className="w-full text-sm p-2 rounded-lg border border-primary/15 bg-secondary/40 text-foreground outline-none"
                    >
                      {PROVIDER_OPTIONS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground/60 mb-1 block">Model (optional)</label>
                    <input
                      value={rule.model || ''}
                      onChange={(e) => onUpdate(idx, { model: e.target.value || null })}
                      placeholder="e.g. claude-haiku-4-5-20251001"
                      className="w-full text-sm p-2 rounded-lg border border-primary/15 bg-secondary/40 text-foreground outline-none placeholder:text-muted-foreground/30"
                    />
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
