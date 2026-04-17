import { useState, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { ChevronDown, ChevronRight, Plus, Trash2, Zap, ToggleLeft, ToggleRight } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { TriageRule } from '@/lib/bindings/TriageRule';

const FIELD_OPTIONS = [
  { value: 'effort', label: 'Effort' },
  { value: 'impact', label: 'Impact' },
  { value: 'risk', label: 'Risk' },
  { value: 'category', label: 'Category' },
  { value: 'scan_type', label: 'Scan Type' },
];

const NUMERIC_OP_OPTIONS = [
  { value: 'lt', label: '<' },
  { value: 'lte', label: '\u2264' },
  { value: 'eq', label: '=' },
  { value: 'gte', label: '\u2265' },
  { value: 'gt', label: '>' },
];

const STRING_OP_OPTIONS = [
  { value: 'eq', label: '=' },
  { value: 'in', label: 'in' },
];

interface Condition {
  field: string;
  op: string;
  value: string;
}

interface TriageRulesPanelProps {
  projectId: string;
}

export function TriageRulesPanel({ projectId }: TriageRulesPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [conditions, setConditions] = useState<Condition[]>([{ field: 'effort', op: 'lt', value: '4' }]);
  const [action, setAction] = useState<'accept' | 'reject'>('accept');
  const [runResult, setRunResult] = useState<{ applied: number; ideas_affected: number } | null>(null);

  const rules = useSystemStore((s) => s.triageRules);
  const fetchTriageRules = useSystemStore((s) => s.fetchTriageRules);
  const createTriageRule = useSystemStore((s) => s.createTriageRule);
  const updateTriageRule = useSystemStore((s) => s.updateTriageRule);
  const deleteTriageRule = useSystemStore((s) => s.deleteTriageRule);
  const runTriageRules = useSystemStore((s) => s.runTriageRules);

  useEffect(() => {
    if (projectId) fetchTriageRules(projectId);
  }, [projectId, fetchTriageRules]);

  const isNumericField = (field: string) => ['effort', 'impact', 'risk'].includes(field);

  const handleCreate = async () => {
    if (!ruleName.trim() || conditions.length === 0) return;
    const conditionsJson = JSON.stringify(conditions.map(c => ({
      field: c.field,
      op: c.op,
      value: isNumericField(c.field) ? Number(c.value) : c.value,
    })));
    await createTriageRule(ruleName.trim(), conditionsJson, action, projectId);
    setRuleName('');
    setConditions([{ field: 'effort', op: 'lt', value: '4' }]);
    setAction('accept');
    setCreating(false);
  };

  const handleRun = async () => {
    const result = await runTriageRules(projectId);
    setRunResult(result);
    setTimeout(() => setRunResult(null), 5000);
  };

  const handleToggle = async (rule: TriageRule) => {
    await updateTriageRule(rule.id, { enabled: !rule.enabled });
  };

  const addCondition = () => {
    setConditions([...conditions, { field: 'effort', op: 'lt', value: '4' }]);
  };

  const updateCondition = (idx: number, key: keyof Condition, val: string) => {
    const next = conditions.map((c, i) => {
      if (i !== idx) return c;
      const updated: Condition = { field: c.field, op: c.op, value: c.value };
      updated[key] = val;
      // Reset op when field type changes
      if (key === 'field') {
        updated.op = isNumericField(val) ? 'lt' : 'eq';
        updated.value = isNumericField(val) ? '4' : '';
      }
      return updated;
    });
    setConditions(next);
  };

  const removeCondition = (idx: number) => {
    setConditions(conditions.filter((_, i) => i !== idx));
  };

  const summarizeConditions = (condJson: string): string => {
    try {
      const conds = JSON.parse(condJson) as Array<{ field: string; op: string; value: unknown }>;
      return conds.map(c => `${c.field} ${c.op} ${c.value}`).join(' AND ');
    } catch { return condJson; }
  };

  return (
    <div className="border border-border/20 rounded-modal bg-secondary/20 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 typo-caption font-medium text-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Zap className="w-3 h-3" />
        {t.plugins.dev_triage.auto_triage_rules}
        {rules.length > 0 && (
          <span className="ml-auto text-foreground">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/15 pt-2">
          {/* Existing rules */}
          {rules.map(rule => (
            <div key={rule.id} className="flex items-center gap-2 py-1.5 px-2 rounded-card bg-secondary/30 typo-caption">
              <button onClick={() => handleToggle(rule)} className="flex-shrink-0">
                {rule.enabled
                  ? <ToggleRight className="w-4 h-4 text-primary" />
                  : <ToggleLeft className="w-4 h-4 text-foreground" />
                }
              </button>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-foreground">{rule.name}</span>
                <span className="text-foreground ml-2">{summarizeConditions(rule.conditions)}</span>
                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  rule.action === 'accept' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                }`}>{rule.action}</span>
              </div>
              <span className="text-foreground text-[10px]">{rule.times_fired}x</span>
              <button onClick={() => deleteTriageRule(rule.id)} className="text-foreground hover:text-red-400 transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}

          {/* Create form */}
          {creating ? (
            <div className="space-y-2 p-2 rounded-card bg-secondary/40 border border-border/20">
              <input
                type="text"
                value={ruleName}
                onChange={e => setRuleName(e.target.value)}
                placeholder={t.plugins.dev_tools.group_name_placeholder}
                className="w-full px-2 py-1 typo-caption bg-background/50 border border-border/30 rounded text-foreground placeholder:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              {conditions.map((cond, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  {idx > 0 && <span className="text-[10px] text-foreground w-6">AND</span>}
                  <select value={cond.field} onChange={e => updateCondition(idx, 'field', e.target.value)}
                    className="px-1.5 py-1 typo-caption bg-background/50 border border-border/30 rounded text-foreground">
                    {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  <select value={cond.op} onChange={e => updateCondition(idx, 'op', e.target.value)}
                    className="px-1.5 py-1 typo-caption bg-background/50 border border-border/30 rounded text-foreground">
                    {(isNumericField(cond.field) ? NUMERIC_OP_OPTIONS : STRING_OP_OPTIONS).map(o =>
                      <option key={o.value} value={o.value}>{o.label}</option>
                    )}
                  </select>
                  <input value={cond.value} onChange={e => updateCondition(idx, 'value', e.target.value)}
                    type={isNumericField(cond.field) ? 'number' : 'text'}
                    className="w-16 px-1.5 py-1 typo-caption bg-background/50 border border-border/30 rounded text-foreground"
                  />
                  {conditions.length > 1 && (
                    <button onClick={() => removeCondition(idx)} className="text-foreground hover:text-red-400">
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addCondition} className="text-[10px] text-primary/60 hover:text-primary">{t.plugins.dev_triage.add_condition}</button>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground">{t.plugins.dev_triage.action_label}</span>
                <button onClick={() => setAction('accept')} className={`px-2 py-0.5 text-[10px] rounded ${action === 'accept' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-secondary/40 text-foreground'}`}>Accept</button>
                <button onClick={() => setAction('reject')} className={`px-2 py-0.5 text-[10px] rounded ${action === 'reject' ? 'bg-red-500/20 text-red-400' : 'bg-secondary/40 text-foreground'}`}>Reject</button>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleCreate} className="px-3 py-1 typo-caption font-medium rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors">Save</button>
                <button onClick={() => setCreating(false)} className="px-3 py-1 typo-caption text-foreground hover:text-foreground transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setCreating(true)} className="flex items-center gap-1 px-2.5 py-1 typo-caption font-medium rounded bg-secondary/40 text-foreground hover:text-foreground hover:bg-secondary/60 transition-colors">
                <Plus className="w-3 h-3" /> {t.plugins.dev_triage.new_rule}
              </button>
              {rules.length > 0 && (
                <button onClick={handleRun} className="flex items-center gap-1 px-2.5 py-1 typo-caption font-medium rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                  <Zap className="w-3 h-3" /> {t.plugins.dev_triage.run_rules}
                </button>
              )}
            </div>
          )}

          {/* Run result toast */}
          {runResult && (
            <div className="px-2.5 py-1.5 typo-caption rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
              Applied {runResult.applied} rule{runResult.applied !== 1 ? 's' : ''} -- {runResult.ideas_affected} idea{runResult.ideas_affected !== 1 ? 's' : ''} triaged
            </div>
          )}
        </div>
      )}
    </div>
  );
}
