// The rows of the auto-triage rules panel: a saved rule and a rule suggested
// from the user's own accept/reject history. Both end in the action chip, which
// speaks the verdict the rule produces (accept is success, reject is error).
import { Plus, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TriageRule } from '@/lib/bindings/TriageRule';
import type { RuleSuggestion } from './triageRuleSuggestions';
import { ruleActionTone, TONE_CHIP } from './triageTones';
import { PrimarySoftButton } from './PrimarySoftButton';

export function ActionChip({ action }: { action: string }) {
  return (
    <span className={`ml-2 px-1.5 py-0.5 rounded-interactive border typo-label ${TONE_CHIP[ruleActionTone(action)]}`}>
      {action}
    </span>
  );
}

function summarizeConditions(condJson: string): string {
  try {
    const conds = JSON.parse(condJson) as Array<{ field: string; op: string; value: unknown }>;
    return conds.map(c => `${c.field} ${c.op} ${c.value}`).join(' AND ');
  } catch { return condJson; }
}

export function RuleRow({ rule, onToggle, onDelete }: {
  rule: TriageRule;
  onToggle: (rule: TriageRule) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-card bg-secondary/30 typo-caption">
      {/* The switch keeps the theme primary for "on" (identity); AccessibleToggle's on-state is fixed success green. */}
      <button
        type="button"
        role="switch"
        aria-checked={rule.enabled}
        aria-label={rule.name}
        onClick={() => onToggle(rule)}
        className="flex-shrink-0 focus-ring rounded-interactive"
      >
        {rule.enabled
          ? <ToggleRight className="w-4 h-4 text-primary" />
          : <ToggleLeft className="w-4 h-4 text-foreground" />
        }
      </button>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-foreground">{rule.name}</span>
        <span className="text-foreground ml-2">{summarizeConditions(rule.conditions)}</span>
        <ActionChip action={rule.action} />
      </div>
      <span className="tabular-nums">{rule.times_fired}x</span>
      <button
        type="button"
        aria-label={t.common.delete}
        onClick={() => onDelete(rule.id)}
        className="text-foreground hover:text-status-error transition-colors focus-ring rounded-interactive"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

export function SuggestionRow({ suggestion, name, onAdd }: {
  suggestion: RuleSuggestion;
  name: string;
  onAdd: (s: RuleSuggestion) => Promise<void>;
}) {
  const { t, tx } = useTranslation();
  const s = suggestion;
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-card bg-secondary/20 border border-dashed border-primary/15 typo-caption">
      <div className="flex-1 min-w-0">
        <span className="font-medium text-foreground">{name}</span>
        <span className="text-foreground ml-2">
          {s.conditions.map((c) => `${c.field} ${c.op} ${c.value}`).join(' AND ')}
        </span>
        <ActionChip action={s.action} />
      </div>
      <span className="shrink-0 tabular-nums">
        {tx(t.plugins.dev_triage.suggestion_evidence, { matched: s.matched, total: s.total })}
      </span>
      <PrimarySoftButton size="xs" onClick={() => void onAdd(s)} icon={<Plus className="w-3 h-3" />} className="shrink-0">
        {t.plugins.dev_triage.suggestion_add}
      </PrimarySoftButton>
    </div>
  );
}
