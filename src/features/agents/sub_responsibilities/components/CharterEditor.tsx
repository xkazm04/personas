import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
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
} from '../libs/charterMeta';
import { saveCharterDraft } from '../libs/charterEditorSave';
import { OutcomesEditor, ObjectivesEditor } from './fields/OutcomeObjectiveEditors';
import { RespPolicyFields } from './fields/PolicyFields';
import { RespCadenceFields } from './fields/CadenceFields';

interface CharterEditorProps {
  personaId: string;
  /** Charter being edited; `undefined` = create a new one. */
  existing?: PersonaResponsibility;
  onSaved: (saved: PersonaResponsibility) => void;
  onCancel: () => void;
}

/**
 * Create/update form for one standing charter's GOVERNANCE fields. Saves in one
 * IPC through the operator door (`source = 'operator'`); the backend
 * re-validates the merged charter (rung ceiling, refusal-class libraries).
 *
 * Runtime fields (procedure, connectors, routing, policies, parameters) are
 * edited per sigil dimension — see `sigil/charterSigilBodies.tsx`.
 *
 * On CREATE the form offers the status: `active` publishes the charter
 * immediately, `draft` parks it on the first rung of the ladder. That is the
 * only door through which `draft` is operator-reachable — the update door
 * refuses `status` by design (see `UpdatePersonaResponsibilityInput`).
 */
export function CharterEditor({
  personaId,
  existing,
  onSaved,
  onCancel,
}: CharterEditorProps) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const [draft, setDraft] = useState(() =>
    existing ? draftFromResponsibility(existing) : emptyDraft(),
  );
  const patch = (p: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...p }));
  const [createStatus, setCreateStatus] = useState<'active' | 'draft'>('active');

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
      onSaved(await saveCharterDraft({ personaId, draft, existing, createStatus }));
    } catch (err) {
      toastCatch('responsibilities:saveCharter', life.save_failed)(err);
    }
  };

  return (
    <SectionCard
      title={existing ? existing.title : life.resp_new}
      titleClassName="text-primary"
    >
      <div className="space-y-5" data-testid="resp-editor">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={life.resp_title_label} required>
            {(inputProps) => (
              <input
                {...inputProps}
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                className={INPUT_FIELD}
                data-testid="resp-title"
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
        {!existing && (
          <FormField label={t.common.status}>
            {() => (
              <ThemedSelect
                filterable
                hideSearch
                options={[
                  { value: 'active', label: t.common.active },
                  { value: 'draft', label: life.resp_status_draft },
                ]}
                value={createStatus}
                onValueChange={(v) => setCreateStatus(v === 'draft' ? 'draft' : 'active')}
                aria-label={t.common.status}
              />
            )}
          </FormField>
        )}
        <FormField label={life.resp_owner_label}>
          {(inputProps) => (
            <input
              {...inputProps}
              value={draft.owner}
              onChange={(e) => patch({ owner: e.target.value })}
              className={INPUT_FIELD}
              data-testid="resp-owner"
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
            data-testid="resp-save"
          >
            {existing ? t.common.save : life.resp_create}
          </AsyncButton>
          <Button variant="ghost" onClick={onCancel} data-testid="resp-cancel">
            {t.common.cancel}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
