import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import {
  createPersonaResponsibility,
  updatePersonaResponsibility,
  type ResponsibilityUpdatePayload,
} from '@/api/agents/responsibilities';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { FormField } from '@/features/shared/components/forms/FormField';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { toastCatch } from '@/lib/silentCatch';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import {
  DOMAIN_GENERAL,
  DOMAIN_SOFTWARE_ENGINEERING,
  draftFromResponsibility,
  emptyDraft,
} from './responsibilityMeta';
import { OutcomesEditor, ObjectivesEditor } from './RespOutcomeObjectiveEditors';
import { RespPolicyFields } from './RespPolicyFields';
import { RespCadenceFields } from './RespCadenceFields';

interface ResponsibilityEditorProps {
  personaId: string;
  /** Charter being edited; `undefined` = create a new one. */
  existing?: PersonaResponsibility;
  onSaved: (saved: PersonaResponsibility) => void;
  onCancel: () => void;
}

/**
 * Create/update form for one standing charter. Saves in one IPC through the
 * operator door (`source = 'operator'`); the backend re-validates the merged
 * charter (rung ceiling, refusal-class libraries).
 */
export function ResponsibilityEditor({
  personaId,
  existing,
  onSaved,
  onCancel,
}: ResponsibilityEditorProps) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const [draft, setDraft] = useState(() =>
    existing ? draftFromResponsibility(existing) : emptyDraft(),
  );
  const patch = (p: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...p }));

  const domainOptions = [
    { value: DOMAIN_GENERAL, label: DOMAIN_GENERAL },
    { value: DOMAIN_SOFTWARE_ENGINEERING, label: DOMAIN_SOFTWARE_ENGINEERING },
    // A charter may carry an open-vocabulary domain ('docs', 'support', …) —
    // keep it selectable instead of silently rewriting it.
    ...(draft.domain !== DOMAIN_GENERAL && draft.domain !== DOMAIN_SOFTWARE_ENGINEERING
      ? [{ value: draft.domain, label: draft.domain }]
      : []),
  ];

  const save = async () => {
    try {
      const common = {
        title: draft.title,
        domain: draft.domain,
        outcomes: draft.outcomes,
        objectives: draft.objectives.filter((o) => o.key && o.label),
        scopeRung: draft.scopeRung,
        refusalClasses: draft.refusalClasses,
        owner: draft.owner,
        cadence: draft.cadence,
      };
      let saved: PersonaResponsibility;
      if (existing) {
        // On this wire, `null` on a regular field means "leave unchanged"
        // (serde Option -> None), NOT a blank-fill: approvalGates and tenure
        // are deliberately not edited by this form. budgetMonthlyUsd is the
        // double-Option exception where explicit null CLEARS the column, which
        // is exactly right when the operator emptied the field. projectId is
        // omitted on purpose: absent = leave unchanged.
        const payload: ResponsibilityUpdatePayload = {
          ...common,
          approvalGates: null,
          tenure: null,
          budgetMonthlyUsd: draft.budgetMonthlyUsd ?? null,
          // Manifest columns (agent-manifest-rebase WP1) — not edited by
          // this form yet (WP5-7); null = leave unchanged.
          connectors: null,
          procedure: null,
          spec: null,
        };
        saved = await updatePersonaResponsibility(existing.id, payload);
      } else {
        saved = await createPersonaResponsibility({
          personaId,
          ...common,
          approvalGates: [],
          budgetMonthlyUsd: draft.budgetMonthlyUsd,
          tenure: { retireCriteria: [] },
          // Manifest columns (WP1): a hand-created charter starts empty.
          connectors: [],
          procedure: '',
          spec: {},
        });
      }
      onSaved(saved);
    } catch (err) {
      toastCatch('life:saveResponsibility', life.save_failed)(err);
    }
  };

  return (
    <SectionCard
      title={existing ? existing.title : life.resp_new}
      titleClassName="text-primary"
    >
      <div className="space-y-5" data-testid="life-resp-editor">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={life.resp_title_label} required>
            {(inputProps) => (
              <input
                {...inputProps}
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                className={INPUT_FIELD}
                data-testid="life-resp-title"
              />
            )}
          </FormField>
          <FormField label={life.resp_domain_label}>
            {() => (
              <ThemedSelect
                filterable
                hideSearch
                options={domainOptions}
                value={draft.domain}
                onValueChange={(v) => patch({ domain: v })}
                aria-label={life.resp_domain_label}
              />
            )}
          </FormField>
        </div>
        <FormField label={life.resp_owner_label}>
          {(inputProps) => (
            <input
              {...inputProps}
              value={draft.owner}
              onChange={(e) => patch({ owner: e.target.value })}
              className={INPUT_FIELD}
              data-testid="life-resp-owner"
            />
          )}
        </FormField>

        <OutcomesEditor outcomes={draft.outcomes} onChange={(outcomes) => patch({ outcomes })} />
        <ObjectivesEditor objectives={draft.objectives} onChange={(objectives) => patch({ objectives })} />
        <RespPolicyFields
          domain={draft.domain}
          scopeRung={draft.scopeRung}
          refusalClasses={draft.refusalClasses}
          onScopeRung={(scopeRung) => patch({ scopeRung })}
          onRefusalClasses={(refusalClasses) => patch({ refusalClasses })}
        />
        <RespCadenceFields
          cadence={draft.cadence}
          budgetMonthlyUsd={draft.budgetMonthlyUsd}
          tenure={existing?.tenure}
          onCadence={(cadence) => patch({ cadence })}
          onBudget={(budgetMonthlyUsd) => patch({ budgetMonthlyUsd })}
        />

        <div className="flex items-center gap-2 pt-1">
          <AsyncButton
            variant="primary"
            onClick={save}
            disabled={!draft.title.trim()}
            data-testid="life-resp-save"
          >
            {existing ? t.common.save : life.resp_create}
          </AsyncButton>
          <Button variant="ghost" onClick={onCancel} data-testid="life-resp-cancel">
            {t.common.cancel}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
