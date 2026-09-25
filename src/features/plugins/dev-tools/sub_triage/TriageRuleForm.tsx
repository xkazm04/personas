// The auto-triage rule composer: a name, AND-ed conditions, and the verdict the
// rule applies. Owns its own draft; the panel only opens and closes it.
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { PrimarySoftButton } from './PrimarySoftButton';

const FIELD_OPTIONS = [
  { value: 'effort', label: 'Effort' },
  { value: 'impact', label: 'Impact' },
  { value: 'risk', label: 'Risk' },
  { value: 'category', label: 'Category' },
  { value: 'scan_type', label: 'Scan Type' },
  // The findings spine — rules can target which SENSOR raised an idea, e.g.
  // "auto-accept passport_gap" (values: standards_finding · passport_gap ·
  // llm_cost · sentry_spike · kpi_offtrack). Never matches a scanner idea.
  { value: 'origin', label: 'Source (sensor)' },
];

const NUMERIC_OP_OPTIONS = [
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'eq', label: '=' },
  { value: 'gte', label: '≥' },
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

const DEFAULT_CONDITION: Condition = { field: 'effort', op: 'lt', value: '4' };
const isNumericField = (field: string) => ['effort', 'impact', 'risk'].includes(field);
// The same geometry as ThemedSelect beside it (px-3 py-2, typo-body, primary/15 rule), on the input radius.
const FIELD_CLASS = 'px-3 py-2 typo-body bg-background/50 border border-primary/15 rounded-input text-foreground focus-ring';

export function TriageRuleForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const createTriageRule = useSystemStore((s) => s.createTriageRule);
  const [ruleName, setRuleName] = useState('');
  const [conditions, setConditions] = useState<Condition[]>([DEFAULT_CONDITION]);
  const [action, setAction] = useState<'accept' | 'reject'>('accept');

  const handleCreate = async () => {
    if (!ruleName.trim() || conditions.length === 0) return;
    const conditionsJson = JSON.stringify(conditions.map(c => ({
      field: c.field,
      op: c.op,
      value: isNumericField(c.field) ? Number(c.value) : c.value,
    })));
    await createTriageRule(ruleName.trim(), conditionsJson, action, projectId);
    onClose();
  };

  const updateCondition = (idx: number, key: keyof Condition, val: string) => {
    setConditions(conditions.map((c, i) => {
      if (i !== idx) return c;
      const updated: Condition = { ...c, [key]: val };
      // Reset op when field type changes
      if (key === 'field') {
        updated.op = isNumericField(val) ? 'lt' : 'eq';
        updated.value = isNumericField(val) ? '4' : '';
      }
      return updated;
    }));
  };

  return (
    <div className="space-y-2 p-2 rounded-card bg-secondary/40 border border-border/20">
      <input
        type="text"
        value={ruleName}
        onChange={e => setRuleName(e.target.value)}
        placeholder={t.plugins.dev_tools.group_name_placeholder}
        className={`w-full ${FIELD_CLASS} placeholder:text-foreground`}
      />
      {conditions.map((cond, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          {idx > 0 && <span className="typo-caption w-8">AND</span>}
          <ThemedSelect value={cond.field} onChange={e => updateCondition(idx, 'field', e.target.value)} wrapperClassName="w-44">
            {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </ThemedSelect>
          <ThemedSelect value={cond.op} onChange={e => updateCondition(idx, 'op', e.target.value)} wrapperClassName="w-20">
            {(isNumericField(cond.field) ? NUMERIC_OP_OPTIONS : STRING_OP_OPTIONS).map(o =>
              <option key={o.value} value={o.value}>{o.label}</option>
            )}
          </ThemedSelect>
          <input value={cond.value} onChange={e => updateCondition(idx, 'value', e.target.value)}
            type={isNumericField(cond.field) ? 'number' : 'text'}
            className={`w-20 ${FIELD_CLASS}`}
          />
          {conditions.length > 1 && (
            <button type="button" aria-label={t.common.delete} onClick={() => setConditions(conditions.filter((_, i) => i !== idx))} className="text-foreground hover:text-status-error">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      <Button variant="link" size="xs" onClick={() => setConditions([...conditions, DEFAULT_CONDITION])} className="typo-caption">
        {t.plugins.dev_triage.add_condition}
      </Button>
      <div className="flex items-center gap-2">
        <span className="typo-caption">{t.plugins.dev_triage.action_label}</span>
        <Button variant={action === 'accept' ? 'accent' : 'ghost'} tone="success" size="xs" aria-pressed={action === 'accept'} onClick={() => setAction('accept')}>Accept</Button>
        <Button variant={action === 'reject' ? 'accent' : 'ghost'} tone="error" size="xs" aria-pressed={action === 'reject'} onClick={() => setAction('reject')}>{t.common.reject}</Button>
      </div>
      <div className="flex gap-2 pt-1">
        <PrimarySoftButton onClick={() => void handleCreate()}>{t.common.save}</PrimarySoftButton>
        <Button variant="ghost" size="sm" onClick={onClose} className="typo-caption">{t.common.cancel}</Button>
      </div>
    </div>
  );
}
