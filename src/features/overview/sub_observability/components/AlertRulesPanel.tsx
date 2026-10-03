/**
 * Observability (composition kit): alert rules as a Section of ListRows. A rule's Mark is its
 * severity, a disabled rule recedes; its switch, edit and delete sit in the row's figures. The
 * evaluator's last run is the section meta (a Dot in success or error, then how long ago).
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAgentStore } from '@/stores/agentStore';
import type { AlertRule } from '@/lib/bindings/AlertRule';
import { ALERT_METRIC_OPTIONS, ALERT_SEVERITY_OPTIONS, alertLabel, type AlertSeverity } from '@/stores/slices/overview/alertSlice';
import { silentCatch } from '@/lib/silentCatch';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Dot, KitButton, ListRow, Rows, Section, type Glyph, type Tone } from '@/features/shared/components/kit';
import { AlertRuleForm, type RuleFormData } from './AlertRuleForm';

export const SEVERITY_MARK: Record<AlertSeverity, { tone: Tone; glyph: Glyph }> = {
  critical: { tone: 'error', glyph: 'solid' },
  warning: { tone: 'warning', glyph: 'solid' },
  info: { tone: 'info', glyph: 'soft' },
};

const toInput = (d: RuleFormData) => ({
  name: d.name.trim(), metric: d.metric, operator: d.operator, threshold: parseFloat(d.threshold), severity: d.severity, persona_id: d.personaId,
});
const toForm = (r: AlertRule): RuleFormData => ({
  name: r.name, metric: r.metric, operator: r.operator, threshold: String(r.threshold), severity: r.severity, personaId: r.persona_id,
});

export function AlertRulesPanel({ eyebrow }: { eyebrow?: string }) {
  const { t } = useTranslation();
  const hp = t.overview.healing_issues_panel;
  const s = useOverviewStore(useShallow((st) => ({
    alertRules: st.alertRules, addAlertRule: st.addAlertRule, updateAlertRule: st.updateAlertRule,
    deleteAlertRule: st.deleteAlertRule, toggleAlertRule: st.toggleAlertRule, health: st.alertEvalHealth,
    // `alertRulesLoading` has existed in alertSlice since the panel did and was
    // never read here, so a cold open asserted "no rules configured" before the
    // read returned (docs/design/overview-loading.md, Definition of done:
    // "Empty state renders only when !isFetching"). `Rows` already owns the
    // calm delayed ghost; it only ever lacked the flag.
    loading: st.alertRulesLoading,
  })));
  const personas = useAgentStore((st) => st.personas);
  const personaList = personas.map((p) => ({ id: p.id, name: p.name }));
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const add = async (data: RuleFormData) => {
    const input = toInput(data);
    if (!Number.isFinite(input.threshold)) return;
    try { await s.addAlertRule({ ...input, enabled: true }); setAdding(false); } catch (err) { silentCatch('AlertRulesPanel:addAlertRule')(err); }
  };
  const edit = async (id: string, data: RuleFormData) => {
    const input = toInput(data);
    if (!Number.isFinite(input.threshold)) return;
    try { await s.updateAlertRule(id, input); setEditingId(null); } catch (err) { silentCatch('AlertRulesPanel:updateAlertRule')(err); }
  };

  const h = s.health;
  return (
    <Section
      id="s-obs-alert-rules"
      eyebrow={eyebrow}
      title={t.overview.observability.alert_rules}
      count={s.alertRules.length}
      meta={h.lastEvalAt ? (
        <span className="inline-flex items-center gap-2">
          <Dot tone={h.lastError ? 'error' : 'success'} />
          <RelativeTime timestamp={h.lastEvalAt} />
          {h.lastError && <span className="t-error k-toned">{t.common.error}</span>}
        </span>
      ) : undefined}
      actions={<KitButton onClick={() => { setAdding(true); setEditingId(null); }} testId="obs-rule-add">{hp.add_rule}</KitButton>}
    >
      {adding && <AlertRuleForm personas={personaList} onSubmit={add} onCancel={() => setAdding(false)} />}
      <Rows
        count={s.alertRules.length}
        loading={s.loading && s.alertRules.length === 0}
        empty={{ title: hp.no_rules_configured }}
      >
        {s.alertRules.map((rule) => {
          if (editingId === rule.id) {
            return <AlertRuleForm key={rule.id} initial={toForm(rule)} personas={personaList} onSubmit={(d) => edit(rule.id, d)} onCancel={() => setEditingId(null)} />;
          }
          const metric = ALERT_METRIC_OPTIONS.find((m) => m.value === rule.metric);
          const sev = ALERT_SEVERITY_OPTIONS.find((x) => x.value === rule.severity);
          const scope = rule.persona_id ? personaList.find((p) => p.id === rule.persona_id)?.name ?? t.overview.activity.unknown : hp.all_agents_global;
          return (
            <ListRow
              key={rule.id}
              size="m"
              name={rule.name}
              meta={`${metric ? alertLabel(t, metric.labelKey) : rule.metric} ${rule.operator} ${rule.threshold}${metric?.unit ?? ''} · ${scope}`}
              mark={{ ...SEVERITY_MARK[rule.severity], label: sev ? alertLabel(t, sev.labelKey) : rule.severity }}
              state={rule.enabled ? undefined : 'muted'}
              figures={
                <>
                  <AccessibleToggle size="sm" checked={rule.enabled} label={rule.name} onChange={() => { s.toggleAlertRule(rule.id).catch(silentCatch('AlertRulesPanel:toggleAlertRule')); }} />
                  <KitButton quiet onClick={() => { setEditingId(rule.id); setAdding(false); }}>{t.common.edit}</KitButton>
                  <KitButton quiet onClick={() => { s.deleteAlertRule(rule.id).catch(silentCatch('AlertRulesPanel:deleteAlertRule')); }}>{t.common.delete}</KitButton>
                </>
              }
            />
          );
        })}
      </Rows>
    </Section>
  );
}
