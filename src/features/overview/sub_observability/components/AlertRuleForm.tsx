/**
 * Observability (composition kit): the add / edit form for an alert rule, inline on the reading
 * line. Selects are the shared ThemedSelect (themed options, no native popup); the option lists
 * carry keys, resolved here so the labels follow a language switch.
 */
import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { KitButton } from '@/features/shared/components/kit';
import {
  ALERT_METRIC_OPTIONS, ALERT_SEVERITY_OPTIONS, alertLabel,
  type AlertMetric, type AlertOperator, type AlertSeverity,
} from '@/stores/slices/overview/alertSlice';

export interface RuleFormData {
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: string;
  severity: AlertSeverity;
  personaId: string | null;
}

export const DEFAULT_RULE_FORM: RuleFormData = { name: '', metric: 'error_rate', operator: '>', threshold: '10', severity: 'warning', personaId: null };

const OPERATORS: AlertOperator[] = ['>', '<', '>=', '<='];
const OP_LABEL: Record<AlertOperator, string> = { '>': '>', '<': '<', '>=': '≥', '<=': '≤' };
const GLOBAL = '__global__';
const FIELD = 'h-9 px-3 typo-body rounded-input bg-secondary/40 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:border-primary/40';

export function AlertRuleForm({ initial, personas, onSubmit, onCancel }: {
  initial?: RuleFormData;
  personas: { id: string; name: string }[];
  onSubmit: (data: RuleFormData) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const hp = t.overview.healing_issues_panel;
  const [form, setForm] = useState<RuleFormData>(initial ?? DEFAULT_RULE_FORM);
  const unit = ALERT_METRIC_OPTIONS.find((m) => m.value === form.metric)?.unit;
  const valid = form.name.trim() !== '' && form.threshold !== '';

  return (
    <div className="k-in flex flex-col gap-3" style={{ padding: '8px 12px 16px var(--gutter)' }}>
      <input
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder={t.common.name}
        aria-label={t.common.name}
        className={`${FIELD} w-full`}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <ThemedSelect
          filterable hideSearch wrapperClassName="min-w-[180px]"
          value={form.metric}
          onValueChange={(v) => setForm({ ...form, metric: v as AlertMetric })}
          options={ALERT_METRIC_OPTIONS.map((m) => ({ value: m.value, label: alertLabel(t, m.labelKey) }))}
        />
        <ThemedSelect
          filterable hideSearch wrapperClassName="w-20"
          value={form.operator}
          onValueChange={(v) => setForm({ ...form, operator: v as AlertOperator })}
          options={OPERATORS.map((op) => ({ value: op, label: OP_LABEL[op] }))}
        />
        <span className="inline-flex items-center gap-2">
          <input
            type="number" step="any"
            value={form.threshold}
            onChange={(e) => setForm({ ...form, threshold: e.target.value })}
            aria-label={alertLabel(t, ALERT_METRIC_OPTIONS.find((m) => m.value === form.metric)!.labelKey)}
            className={`${FIELD} w-24`}
          />
          {unit && <span className="typo-caption">{unit}</span>}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <ThemedSelect
          filterable hideSearch wrapperClassName="min-w-[140px]"
          value={form.severity}
          onValueChange={(v) => setForm({ ...form, severity: v as AlertSeverity })}
          options={ALERT_SEVERITY_OPTIONS.map((s) => ({ value: s.value, label: alertLabel(t, s.labelKey) }))}
        />
        <ThemedSelect
          filterable hideSearch wrapperClassName="flex-1 min-w-[160px]"
          value={form.personaId ?? GLOBAL}
          onValueChange={(v) => setForm({ ...form, personaId: v === GLOBAL ? null : v })}
          options={[{ value: GLOBAL, label: hp.all_agents_global }, ...personas.map((p) => ({ value: p.id, label: p.name }))]}
        />
      </div>
      <div className="flex items-center gap-2">
        <KitButton onClick={() => { if (valid) onSubmit(form); }} testId="obs-rule-save">{t.common.save}</KitButton>
        <KitButton quiet onClick={onCancel}>{t.common.cancel}</KitButton>
      </div>
    </div>
  );
}
